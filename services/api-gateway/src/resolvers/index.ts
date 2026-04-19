import { Pool } from 'pg';
import { withFilter } from 'graphql-subscriptions';
import { GraphQLJSON, GraphQLDateTime, GraphQLBigInt, GraphQLUUID } from 'graphql-scalars';
import { requireAuth, requireRole, requireClearance } from '../middleware/auth.js';
import { SUBSCRIPTION_EVENTS } from '../subscriptions/pubsub.js';
import { createLogger } from '../middleware/logger.js';
import type { SentinelContext } from '../middleware/context.js';

const logger = createLogger('resolvers');

const pgPool = new Pool({
  host: process.env.PG_HOST,
  port: parseInt(process.env.PG_PORT || '5432', 10),
  database: process.env.PG_DATABASE,
  user: process.env.PG_USER || 'sentinel_admin',
  password: process.env.PG_PASSWORD,
  max: 30,
  idleTimeoutMillis: 30000,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : undefined,
});

async function queryWithContext(sql: string, params: any[], ctx: SentinelContext) {
  const client = await pgPool.connect();
  try {
    if (ctx.user) {
      await client.query(`SET LOCAL app.current_user_id = '${ctx.user.id}'`);
    }
    const result = await client.query(sql, params);
    return result.rows;
  } finally {
    client.release();
  }
}

function buildCursorPagination(
  baseQuery: string,
  params: any[],
  pagination: { first?: number; after?: string; last?: number; before?: string } | null,
  orderColumn = 'created_at',
  orderDir = 'DESC',
) {
  let query = baseQuery;
  const limit = pagination?.first || pagination?.last || 25;

  if (pagination?.after) {
    const cursor = Buffer.from(pagination.after, 'base64').toString('utf-8');
    params.push(cursor);
    query += ` AND ${orderColumn} ${orderDir === 'DESC' ? '<' : '>'} $${params.length}`;
  }
  if (pagination?.before) {
    const cursor = Buffer.from(pagination.before, 'base64').toString('utf-8');
    params.push(cursor);
    query += ` AND ${orderColumn} ${orderDir === 'DESC' ? '>' : '<'} $${params.length}`;
  }

  params.push(limit + 1);
  query += ` ORDER BY ${orderColumn} ${orderDir} LIMIT $${params.length}`;

  return { query, limit };
}

function formatConnection(rows: any[], limit: number, orderColumn = 'created_at') {
  const hasMore = rows.length > limit;
  const nodes = hasMore ? rows.slice(0, limit) : rows;

  return {
    edges: nodes.map((node: any) => ({
      cursor: Buffer.from(String(node[orderColumn])).toString('base64'),
      node,
    })),
    pageInfo: {
      hasNextPage: hasMore,
      hasPreviousPage: false,
      startCursor: nodes.length > 0
        ? Buffer.from(String(nodes[0][orderColumn])).toString('base64')
        : null,
      endCursor: nodes.length > 0
        ? Buffer.from(String(nodes[nodes.length - 1][orderColumn])).toString('base64')
        : null,
      totalCount: nodes.length,
    },
  };
}

function snakeToCamel(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(snakeToCamel);
  if (typeof obj !== 'object') return obj;

  const result: any = {};
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    result[camelKey] = value;
  }
  return result;
}

export const resolvers = {
  JSON: GraphQLJSON,
  DateTime: GraphQLDateTime,
  BigInt: GraphQLBigInt,
  UUID: GraphQLUUID,

  Query: {
    me: async (_: any, __: any, ctx: SentinelContext) => {
      const user = requireAuth(ctx.user);
      const rows = await queryWithContext('SELECT * FROM users WHERE id = $1', [user.id], ctx);
      return snakeToCamel(rows[0]);
    },

    user: async (_: any, args: { id: string }, ctx: SentinelContext) => {
      requireAuth(ctx.user);
      return snakeToCamel(await ctx.dataloaders.userLoader.load(args.id));
    },

    users: async (_: any, args: any, ctx: SentinelContext) => {
      requireAuth(ctx.user);
      requireRole(ctx.user!, 'SYSTEM_ADMIN', 'SECURITY_ADMIN', 'COMMANDER');
      const params: any[] = [];
      let where = 'WHERE 1=1';
      if (args.role) {
        params.push(args.role);
        where += ` AND role = $${params.length}`;
      }
      if (args.orgId) {
        params.push(args.orgId);
        where += ` AND organization_id = $${params.length}`;
      }
      const { query, limit } = buildCursorPagination(
        `SELECT * FROM users ${where}`, params, args.pagination,
      );
      const rows = await queryWithContext(query, params, ctx);
      return formatConnection(rows.map(snakeToCamel), limit);
    },

    organization: async (_: any, args: { id: string }, ctx: SentinelContext) => {
      requireAuth(ctx.user);
      return snakeToCamel(await ctx.dataloaders.organizationLoader.load(args.id));
    },

    organizations: async (_: any, __: any, ctx: SentinelContext) => {
      requireAuth(ctx.user);
      const rows = await queryWithContext(
        'SELECT * FROM organizations WHERE is_active = true ORDER BY name', [], ctx,
      );
      return rows.map(snakeToCamel);
    },

    alert: async (_: any, args: { id: string }, ctx: SentinelContext) => {
      requireAuth(ctx.user);
      return snakeToCamel(await ctx.dataloaders.alertLoader.load(args.id));
    },

    alerts: async (_: any, args: any, ctx: SentinelContext) => {
      requireAuth(ctx.user);
      const params: any[] = [ctx.user!.organizationId];
      let where = 'WHERE organization_id = $1';
      const filter = args.filter || {};

      if (filter.severities?.length) {
        params.push(filter.severities);
        where += ` AND severity = ANY($${params.length}::threat_severity[])`;
      }
      if (filter.statuses?.length) {
        params.push(filter.statuses);
        where += ` AND status = ANY($${params.length}::alert_status[])`;
      }
      if (filter.domains?.length) {
        params.push(filter.domains);
        where += ` AND domain = ANY($${params.length}::domain_type[])`;
      }
      if (filter.minConfidence) {
        params.push(filter.minConfidence);
        where += ` AND confidence >= $${params.length}`;
      }
      if (filter.timeRange) {
        params.push(filter.timeRange.start, filter.timeRange.end);
        where += ` AND created_at BETWEEN $${params.length - 1} AND $${params.length}`;
      }
      if (filter.searchText) {
        params.push(`%${filter.searchText}%`);
        where += ` AND (title ILIKE $${params.length} OR description ILIKE $${params.length})`;
      }
      if (filter.tags?.length) {
        params.push(filter.tags);
        where += ` AND tags && $${params.length}::text[]`;
      }
      if (filter.assignedTo) {
        params.push(filter.assignedTo);
        where += ` AND assigned_to = $${params.length}`;
      }

      const sortBy = filter.sortBy || 'created_at';
      const sortDir = filter.sortDirection || 'DESC';
      const { query, limit } = buildCursorPagination(
        `SELECT * FROM alerts ${where}`, params, args.pagination, sortBy, sortDir,
      );
      const rows = await queryWithContext(query, params, ctx);
      return formatConnection(rows.map(snakeToCamel), limit, sortBy);
    },

    alertAggregations: async (_: any, args: any, ctx: SentinelContext) => {
      requireAuth(ctx.user);
      const params: any[] = [ctx.user!.organizationId];
      let timeWhere = '';
      if (args.filter?.timeRange) {
        params.push(args.filter.timeRange.start, args.filter.timeRange.end);
        timeWhere = ` AND created_at BETWEEN $${params.length - 1} AND $${params.length}`;
      }

      const [bySev, byStat, byDom, byHour, totals] = await Promise.all([
        queryWithContext(
          `SELECT severity, COUNT(*)::int as count FROM alerts WHERE organization_id = $1${timeWhere} GROUP BY severity`,
          params, ctx,
        ),
        queryWithContext(
          `SELECT status, COUNT(*)::int as count FROM alerts WHERE organization_id = $1${timeWhere} GROUP BY status`,
          params, ctx,
        ),
        queryWithContext(
          `SELECT domain, COUNT(*)::int as count FROM alerts WHERE organization_id = $1${timeWhere} GROUP BY domain`,
          params, ctx,
        ),
        queryWithContext(
          `SELECT date_trunc('hour', created_at) as timestamp, COUNT(*)::float as value FROM alerts WHERE organization_id = $1${timeWhere} GROUP BY 1 ORDER BY 1`,
          params, ctx,
        ),
        queryWithContext(
          `SELECT COUNT(*)::int as total,
            AVG(EXTRACT(EPOCH FROM (acknowledged_at - created_at)))::float as mtta,
            AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)))::float as mttr
           FROM alerts WHERE organization_id = $1${timeWhere}`,
          params, ctx,
        ),
      ]);

      return {
        bySeverity: bySev,
        byStatus: byStat,
        byDomain: byDom,
        byHour: byHour,
        total: totals[0]?.total || 0,
        meanTimeToAcknowledge: totals[0]?.mtta,
        meanTimeToResolve: totals[0]?.mttr,
      };
    },

    sensor: async (_: any, args: { id: string }, ctx: SentinelContext) => {
      requireAuth(ctx.user);
      return snakeToCamel(await ctx.dataloaders.sensorLoader.load(args.id));
    },

    sensors: async (_: any, args: any, ctx: SentinelContext) => {
      requireAuth(ctx.user);
      const params: any[] = [ctx.user!.organizationId];
      let where = 'WHERE organization_id = $1';
      if (args.types?.length) {
        params.push(args.types);
        where += ` AND sensor_type = ANY($${params.length}::sensor_type[])`;
      }
      if (args.statuses?.length) {
        params.push(args.statuses);
        where += ` AND status = ANY($${params.length}::sensor_status[])`;
      }
      if (args.domain) {
        params.push(args.domain);
        where += ` AND domain = $${params.length}`;
      }
      const { query, limit } = buildCursorPagination(
        `SELECT * FROM sensors ${where}`, params, args.pagination,
      );
      const rows = await queryWithContext(query, params, ctx);
      return formatConnection(rows.map(snakeToCamel), limit);
    },

    sensorsByArea: async (_: any, args: any, ctx: SentinelContext) => {
      requireAuth(ctx.user);
      const coords = args.area.coordinates.map((c: number[]) => `${c[0]} ${c[1]}`).join(',');
      const rows = await queryWithContext(
        `SELECT * FROM sensors WHERE organization_id = $1 AND ST_Within(location, ST_GeomFromText('POLYGON((${coords}))', 4326))`,
        [ctx.user!.organizationId], ctx,
      );
      return rows.map(snakeToCamel);
    },

    track: async (_: any, args: { id: string }, ctx: SentinelContext) => {
      requireAuth(ctx.user);
      return snakeToCamel(await ctx.dataloaders.trackLoader.load(args.id));
    },

    tracks: async (_: any, args: any, ctx: SentinelContext) => {
      requireAuth(ctx.user);
      const params: any[] = [ctx.user!.organizationId];
      let where = 'WHERE organization_id = $1';
      const filter = args.filter || {};
      if (filter.domains?.length) {
        params.push(filter.domains);
        where += ` AND domain = ANY($${params.length}::domain_type[])`;
      }
      if (filter.isActive !== undefined) {
        params.push(filter.isActive);
        where += ` AND is_active = $${params.length}`;
      }
      const { query, limit } = buildCursorPagination(
        `SELECT * FROM tracks ${where}`, params, args.pagination,
      );
      const rows = await queryWithContext(query, params, ctx);
      return formatConnection(rows.map(snakeToCamel), limit);
    },

    activeTracks: async (_: any, args: any, ctx: SentinelContext) => {
      requireAuth(ctx.user);
      let sql = 'SELECT * FROM tracks WHERE organization_id = $1 AND is_active = true';
      const params: any[] = [ctx.user!.organizationId];
      if (args.geoWithin) {
        const coords = args.geoWithin.coordinates.map((c: number[]) => `${c[0]} ${c[1]}`).join(',');
        sql += ` AND ST_Within(current_location, ST_GeomFromText('POLYGON((${coords}))', 4326))`;
      }
      const rows = await queryWithContext(sql, params, ctx);
      return rows.map(snakeToCamel);
    },

    mission: async (_: any, args: { id: string }, ctx: SentinelContext) => {
      requireAuth(ctx.user);
      return snakeToCamel(await ctx.dataloaders.missionLoader.load(args.id));
    },

    missions: async (_: any, args: any, ctx: SentinelContext) => {
      requireAuth(ctx.user);
      const params: any[] = [ctx.user!.organizationId];
      let where = 'WHERE organization_id = $1';
      if (args.status) {
        params.push(args.status);
        where += ` AND status = $${params.length}`;
      }
      const rows = await queryWithContext(
        `SELECT * FROM missions ${where} ORDER BY created_at DESC LIMIT 50`, params, ctx,
      );
      return rows.map(snakeToCamel);
    },

    task: async (_: any, args: { id: string }, ctx: SentinelContext) => {
      requireAuth(ctx.user);
      const rows = await queryWithContext('SELECT * FROM tasks WHERE id = $1', [args.id], ctx);
      return snakeToCamel(rows[0]);
    },

    tasks: async (_: any, args: any, ctx: SentinelContext) => {
      requireAuth(ctx.user);
      const params: any[] = [ctx.user!.organizationId];
      let where = 'WHERE organization_id = $1';
      if (args.missionId) { params.push(args.missionId); where += ` AND mission_id = $${params.length}`; }
      if (args.status) { params.push(args.status); where += ` AND status = $${params.length}`; }
      if (args.assignedTo) { params.push(args.assignedTo); where += ` AND assigned_to = $${params.length}`; }
      const rows = await queryWithContext(`SELECT * FROM tasks ${where} ORDER BY priority, created_at`, params, ctx);
      return rows.map(snakeToCamel);
    },

    cyberEvents: async (_: any, args: any, ctx: SentinelContext) => {
      requireAuth(ctx.user);
      const params: any[] = [ctx.user!.organizationId];
      let where = 'WHERE organization_id = $1';
      const filter = args.filter || {};
      if (filter.eventTypes?.length) { params.push(filter.eventTypes); where += ` AND event_type = ANY($${params.length}::text[])`; }
      if (filter.severities?.length) { params.push(filter.severities); where += ` AND severity = ANY($${params.length}::threat_severity[])`; }
      if (filter.timeRange) {
        params.push(filter.timeRange.start, filter.timeRange.end);
        where += ` AND detected_at BETWEEN $${params.length - 1} AND $${params.length}`;
      }
      const { query, limit } = buildCursorPagination(
        `SELECT * FROM cyber_events ${where}`, params, args.pagination, 'detected_at',
      );
      const rows = await queryWithContext(query, params, ctx);
      return formatConnection(rows.map(snakeToCamel), limit, 'detected_at');
    },

    responseRules: async (_: any, args: any, ctx: SentinelContext) => {
      requireAuth(ctx.user);
      const params: any[] = [ctx.user!.organizationId];
      let where = 'WHERE organization_id = $1';
      if (args.isActive !== undefined) { params.push(args.isActive); where += ` AND is_active = $${params.length}`; }
      const rows = await queryWithContext(
        `SELECT * FROM response_rules ${where} ORDER BY priority`, params, ctx,
      );
      return rows.map(snakeToCamel);
    },

    pendingApprovals: async (_: any, __: any, ctx: SentinelContext) => {
      const user = requireAuth(ctx.user);
      const rows = await queryWithContext(
        `SELECT * FROM approval_requests WHERE status = 'PENDING' AND (approver_id = $1 OR approver_role = $2) AND expires_at > NOW() ORDER BY created_at`,
        [user.id, user.role], ctx,
      );
      return rows.map(snakeToCamel);
    },

    aiModels: async (_: any, args: any, ctx: SentinelContext) => {
      requireAuth(ctx.user);
      const params: any[] = [];
      let where = 'WHERE 1=1';
      if (args.status) { params.push(args.status); where += ` AND status = $${params.length}`; }
      const rows = await queryWithContext(`SELECT * FROM ai_models ${where} ORDER BY created_at DESC`, params, ctx);
      return rows.map(snakeToCamel);
    },

    systemHealth: async (_: any, __: any, ctx: SentinelContext) => {
      requireAuth(ctx.user);
      return {
        status: 'operational',
        uptime: process.uptime(),
        services: [],
        kafka: { brokers: 3, topics: 0, consumerGroups: 0, totalLag: 0 },
        databases: [],
        timestamp: new Date().toISOString(),
      };
    },

    honeypots: async (_: any, __: any, ctx: SentinelContext) => {
      requireAuth(ctx.user);
      requireRole(ctx.user!, 'SYSTEM_ADMIN', 'SECURITY_ADMIN', 'CYBER_OPERATOR');
      const rows = await queryWithContext(
        'SELECT * FROM honeypots WHERE organization_id = $1 ORDER BY created_at DESC',
        [ctx.user!.organizationId], ctx,
      );
      return rows.map(snakeToCamel);
    },

    adversaryProfiles: async (_: any, _args: any, ctx: SentinelContext) => {
      requireAuth(ctx.user);
      requireRole(ctx.user!, 'SYSTEM_ADMIN', 'INTELLIGENCE_OFFICER', 'ANALYST', 'CYBER_OPERATOR');
      requireClearance(ctx.user!, 'SECRET');
      const rows = await queryWithContext(
        'SELECT * FROM adversary_profiles WHERE organization_id = $1 ORDER BY last_observed_at DESC NULLS LAST',
        [ctx.user!.organizationId], ctx,
      );
      return rows.map(snakeToCamel);
    },

    // ── Dashboard Stats ──────────────────────────────────────────
    alertStats: async (_: any, __: any, ctx: SentinelContext) => {
      requireAuth(ctx.user);
      const orgId = ctx.user!.organizationId;
      const [sevRows, statusRows, domainRows] = await Promise.all([
        queryWithContext(
          `SELECT severity, COUNT(*)::int as count FROM alerts WHERE organization_id = $1 GROUP BY severity`, [orgId], ctx,
        ),
        queryWithContext(
          `SELECT status, COUNT(*)::int as count FROM alerts WHERE organization_id = $1 GROUP BY status`, [orgId], ctx,
        ),
        queryWithContext(
          `SELECT domain, COUNT(*)::int as count FROM alerts WHERE organization_id = $1 GROUP BY domain`, [orgId], ctx,
        ),
      ]);
      const bySev: Record<string, number> = {};
      sevRows.forEach((r: any) => { bySev[r.severity] = r.count; });
      const byStat: Record<string, number> = {};
      statusRows.forEach((r: any) => { byStat[r.status] = r.count; });
      return {
        total: Object.values(bySev).reduce((a: number, b: number) => a + b, 0),
        critical: bySev['CRITICAL'] || 0,
        high: bySev['HIGH'] || 0,
        medium: bySev['MEDIUM'] || 0,
        low: bySev['LOW'] || 0,
        open: (byStat['NEW'] || 0) + (byStat['ACKNOWLEDGED'] || 0),
        investigating: byStat['INVESTIGATING'] || 0,
        resolved: (byStat['RESOLVED'] || 0) + (byStat['CLOSED'] || 0),
        byDomain: domainRows.map((r: any) => ({ domain: r.domain, count: r.count })),
      };
    },

    sensorStats: async (_: any, __: any, ctx: SentinelContext) => {
      requireAuth(ctx.user);
      const rows = await queryWithContext(
        `SELECT status, COUNT(*)::int as count FROM sensors WHERE organization_id = $1 GROUP BY status`,
        [ctx.user!.organizationId], ctx,
      );
      const byStatus: Record<string, number> = {};
      rows.forEach((r: any) => { byStatus[r.status] = r.count; });
      const total = Object.values(byStatus).reduce((a: number, b: number) => a + b, 0);
      return {
        total,
        online: byStatus['ONLINE'] || 0,
        degraded: byStatus['DEGRADED'] || 0,
        offline: (byStatus['OFFLINE'] || 0) + (byStatus['DECOMMISSIONED'] || 0) + (byStatus['MAINTENANCE'] || 0),
      };
    },

    cyberStats: async (_: any, __: any, ctx: SentinelContext) => {
      requireAuth(ctx.user);
      const orgId = ctx.user!.organizationId;
      const rows = await queryWithContext(
        `SELECT
           COUNT(*)::int as total_events,
           COUNT(*) FILTER (WHERE severity IN ('HIGH','CRITICAL'))::int as ids_alerts,
           0 as ioc_matches,
           0 as blocked
         FROM cyber_events
         WHERE organization_id = $1 AND detected_at > NOW() - INTERVAL '24 hours'`,
        [orgId], ctx,
      );
      const r = rows[0] || {};
      return {
        totalEvents24h: r.total_events || 0,
        idsAlerts: r.ids_alerts || 0,
        iocMatches: r.ioc_matches || 0,
        blocked: r.blocked || 0,
      };
    },

    responseStats: async (_: any, __: any, ctx: SentinelContext) => {
      requireAuth(ctx.user);
      const orgId = ctx.user!.organizationId;
      const [ruleRows, approvalRows, execRows] = await Promise.all([
        queryWithContext(
          `SELECT COUNT(*) FILTER (WHERE is_active = true)::int as active FROM response_rules WHERE organization_id = $1`, [orgId], ctx,
        ),
        queryWithContext(
          `SELECT COUNT(*)::int as pending FROM approval_requests WHERE status = 'PENDING' AND expires_at > NOW()`, [], ctx,
        ),
        queryWithContext(
          `SELECT
             COUNT(*)::int as executed,
             COUNT(*) FILTER (WHERE approval_status = 'REJECTED')::int as rejected
           FROM response_executions
           WHERE created_at > NOW() - INTERVAL '24 hours'`, [], ctx,
        ),
      ]);
      return {
        activeRules: ruleRows[0]?.active || 0,
        pendingApprovals: approvalRows[0]?.pending || 0,
        executed24h: execRows[0]?.executed || 0,
        rejected24h: execRows[0]?.rejected || 0,
      };
    },

    fusionStats: async (_: any, __: any, ctx: SentinelContext) => {
      requireAuth(ctx.user);
      // Neo4j stats would be fetched via the fusion-service; for now use PG correlation table
      const rows = await queryWithContext(
        `SELECT
           (SELECT COUNT(*)::int FROM alerts) as total_entities,
           0 as total_relationships,
           (SELECT COUNT(*)::int FROM alerts WHERE created_at > NOW() - INTERVAL '24 hours') as correlations_24h`,
        [], ctx,
      );
      const r = rows[0] || {};
      return {
        totalEntities: r.total_entities || 0,
        totalRelationships: r.total_relationships || 0,
        correlations24h: r.correlations_24h || 0,
        topEntityTypes: [],
      };
    },

    correlations: async (_: any, args: any, ctx: SentinelContext) => {
      requireAuth(ctx.user);
      const limit = args.limit || 20;
      // Cross-domain correlation: find alerts that share similar timestamps or source IPs
      const rows = await queryWithContext(
        `SELECT
           a1.id as id,
           a1.id::text as source_alert_id,
           a2.id::text as target_alert_id,
           'TEMPORAL' as correlation_type,
           0.85 as confidence,
           CONCAT('Alerts ', a1.title, ' and ', a2.title, ' occurred within same time window') as hypothesis,
           a1.created_at
         FROM alerts a1
         JOIN alerts a2 ON a1.id < a2.id
           AND a1.organization_id = a2.organization_id
           AND ABS(EXTRACT(EPOCH FROM (a1.created_at - a2.created_at))) < 1800
         WHERE a1.organization_id = $1
         ORDER BY a1.created_at DESC
         LIMIT $2`,
        [ctx.user!.organizationId, limit], ctx,
      );
      return rows.map(snakeToCamel);
    },

    osintFeeds: async (_: any, __: any, ctx: SentinelContext) => {
      requireAuth(ctx.user);
      // OSINT feeds are managed by osint-service; expose from a feeds table if exists, else return empty
      try {
        const rows = await queryWithContext(
          `SELECT * FROM osint_feeds WHERE organization_id = $1 ORDER BY name`,
          [ctx.user!.organizationId], ctx,
        );
        return rows.map(snakeToCamel);
      } catch {
        return [];
      }
    },
  },

  Mutation: {
    createAlert: async (_: any, args: any, ctx: SentinelContext) => {
      const user = requireAuth(ctx.user);
      requireRole(user, 'SYSTEM_ADMIN', 'ANALYST', 'OPERATOR', 'COMMANDER', 'INTELLIGENCE_OFFICER', 'API_SERVICE');
      const input = args.input;
      const rows = await queryWithContext(
        `INSERT INTO alerts (organization_id, title, description, severity, domain, source_type, source_id, confidence, tags, classification, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 0.5, $8, $9, $10)
         RETURNING *`,
        [user.organizationId, input.title, input.description, input.severity, input.domain,
         input.sourceType, input.sourceId, input.tags || [], input.classification, input.metadata || {}],
        ctx,
      );
      const alert = snakeToCamel(rows[0]);
      await ctx.pubsub.publish(SUBSCRIPTION_EVENTS.ALERT_CREATED, { alertCreated: alert });
      return alert;
    },

    updateAlert: async (_: any, args: any, ctx: SentinelContext) => {
      const user = requireAuth(ctx.user);
      const setClauses: string[] = [];
      const params: any[] = [args.id];
      const input = args.input;

      if (input.status) { params.push(input.status); setClauses.push(`status = $${params.length}`); }
      if (input.severity) { params.push(input.severity); setClauses.push(`severity = $${params.length}`); }
      if (input.assignedTo) { params.push(input.assignedTo); setClauses.push(`assigned_to = $${params.length}`); }
      if (input.resolutionNotes) { params.push(input.resolutionNotes); setClauses.push(`resolution_notes = $${params.length}`); }
      if (input.tags) { params.push(input.tags); setClauses.push(`tags = $${params.length}`); }

      if (setClauses.length === 0) {
        const existing = await ctx.dataloaders.alertLoader.load(args.id);
        return snakeToCamel(existing);
      }

      const rows = await queryWithContext(
        `UPDATE alerts SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`, params, ctx,
      );
      const alert = snakeToCamel(rows[0]);
      await ctx.pubsub.publish(SUBSCRIPTION_EVENTS.ALERT_UPDATED, { alertUpdated: alert });
      return alert;
    },

    acknowledgeAlert: async (_: any, args: { id: string }, ctx: SentinelContext) => {
      const user = requireAuth(ctx.user);
      const rows = await queryWithContext(
        `UPDATE alerts SET status = 'ACKNOWLEDGED', acknowledged_by = $2, acknowledged_at = NOW() WHERE id = $1 RETURNING *`,
        [args.id, user.id], ctx,
      );
      return snakeToCamel(rows[0]);
    },

    resolveAlert: async (_: any, args: { id: string; notes: string }, ctx: SentinelContext) => {
      const user = requireAuth(ctx.user);
      const rows = await queryWithContext(
        `UPDATE alerts SET status = 'RESOLVED', resolved_by = $2, resolved_at = NOW(), resolution_notes = $3 WHERE id = $1 RETURNING *`,
        [args.id, user.id, args.notes], ctx,
      );
      return snakeToCamel(rows[0]);
    },

    createSensor: async (_: any, args: any, ctx: SentinelContext) => {
      const user = requireAuth(ctx.user);
      requireRole(user, 'SYSTEM_ADMIN', 'OPERATOR');
      const input = args.input;
      const locationSql = input.location
        ? `ST_SetSRID(ST_MakePoint($7, $8), 4326)` : 'NULL';
      const params: any[] = [
        user.organizationId, input.name, input.sensorType, input.domain,
        input.connectionUri, input.classification,
      ];
      if (input.location) {
        params.push(input.location.longitude, input.location.latitude);
      }
      const rows = await queryWithContext(
        `INSERT INTO sensors (organization_id, name, sensor_type, domain, connection_uri, classification, location)
         VALUES ($1, $2, $3, $4, $5, $6, ${locationSql}) RETURNING *`,
        params, ctx,
      );
      return snakeToCamel(rows[0]);
    },

    createMission: async (_: any, args: any, ctx: SentinelContext) => {
      const user = requireAuth(ctx.user);
      requireRole(user, 'SYSTEM_ADMIN', 'COMMANDER');
      const input = args.input;
      const rows = await queryWithContext(
        `INSERT INTO missions (organization_id, name, description, commander_id, classification, start_time, end_time, objectives, rules_of_engagement)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [user.organizationId, input.name, input.description, input.commanderId || user.id,
         input.classification, input.startTime, input.endTime, input.objectives || '[]', input.rulesOfEngagement],
        ctx,
      );
      return snakeToCamel(rows[0]);
    },

    createTask: async (_: any, args: any, ctx: SentinelContext) => {
      const user = requireAuth(ctx.user);
      const input = args.input;
      const rows = await queryWithContext(
        `INSERT INTO tasks (organization_id, mission_id, title, description, priority, assigned_to, assigned_unit, parent_task_id, due_at, classification)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [user.organizationId, input.missionId, input.title, input.description, input.priority,
         input.assignedTo, input.assignedUnit, input.parentTaskId, input.dueAt, input.classification],
        ctx,
      );
      return snakeToCamel(rows[0]);
    },

    createResponseRule: async (_: any, args: any, ctx: SentinelContext) => {
      const user = requireAuth(ctx.user);
      requireRole(user, 'SYSTEM_ADMIN', 'SECURITY_ADMIN');
      const input = args.input;
      const rows = await queryWithContext(
        `INSERT INTO response_rules (organization_id, name, description, conditions, actions, action_type, severity_threshold, requires_approval, approval_timeout_min, cooldown_minutes, max_executions_per_hour, priority, created_by, classification)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
        [user.organizationId, input.name, input.description, JSON.stringify(input.conditions),
         JSON.stringify(input.actions), input.actionType, input.severityThreshold, input.requiresApproval,
         input.approvalTimeoutMin || 15, input.cooldownMinutes || 5, input.maxExecutionsPerHour || 10,
         input.priority || 100, user.id, input.classification],
        ctx,
      );
      return snakeToCamel(rows[0]);
    },

    approveExecution: async (_: any, args: any, ctx: SentinelContext) => {
      const user = requireAuth(ctx.user);
      requireRole(user, 'SYSTEM_ADMIN', 'COMMANDER', 'SECURITY_ADMIN');
      await queryWithContext(
        `UPDATE approval_requests SET status = 'APPROVED', approver_id = $2, decided_at = NOW(), decision_notes = $3 WHERE execution_id = $1 AND status = 'PENDING'`,
        [args.executionId, user.id, args.notes], ctx,
      );
      const rows = await queryWithContext(
        `UPDATE response_executions SET approval_status = 'APPROVED', approved_by = $2, approved_at = NOW() WHERE id = $1 RETURNING *`,
        [args.executionId, user.id], ctx,
      );
      return snakeToCamel(rows[0]);
    },

    rejectExecution: async (_: any, args: any, ctx: SentinelContext) => {
      const user = requireAuth(ctx.user);
      await queryWithContext(
        `UPDATE approval_requests SET status = 'REJECTED', approver_id = $2, decided_at = NOW(), decision_notes = $3 WHERE execution_id = $1 AND status = 'PENDING'`,
        [args.executionId, user.id, args.notes], ctx,
      );
      const rows = await queryWithContext(
        `UPDATE response_executions SET approval_status = 'REJECTED' WHERE id = $1 RETURNING *`,
        [args.executionId], ctx,
      );
      return snakeToCamel(rows[0]);
    },

    login: async (_: any, args: any, ctx: SentinelContext) => {
      logger.info({ username: args.username, org: args.orgShortCode }, 'Login attempt');
      throw new Error('Login delegated to auth-service');
    },

    refreshToken: async (_: any, _args: any) => {
      throw new Error('Token refresh delegated to auth-service');
    },

    logout: async (_: any, __: any, ctx: SentinelContext) => {
      requireAuth(ctx.user);
      return true;
    },

    queryOllama: async (_: any, args: any, ctx: SentinelContext) => {
      requireAuth(ctx.user);
      throw new Error('Ollama queries delegated to ai-service');
    },

    classifyData: async (_: any, args: any, ctx: SentinelContext) => {
      const user = requireAuth(ctx.user);
      requireRole(user, 'SYSTEM_ADMIN', 'SECURITY_ADMIN', 'INTELLIGENCE_OFFICER');
      requireClearance(user, args.classification);
      const rows = await queryWithContext(
        `INSERT INTO data_classifications (resource_type, resource_id, classification, caveats, releasable_to, classified_by, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (resource_type, resource_id) DO UPDATE SET classification = $3, caveats = $4, releasable_to = $5, classified_by = $6, reason = $7
         RETURNING *`,
        [args.resourceType, args.resourceId, args.classification, args.caveats || [], args.releasableTo || [], user.id, args.reason],
        ctx,
      );
      return snakeToCamel(rows[0]);
    },
  },

  Subscription: {
    alertCreated: {
      subscribe: (_: any, args: any, ctx: SentinelContext) => {
        requireAuth(ctx.user);
        return ctx.pubsub.asyncIterator([SUBSCRIPTION_EVENTS.ALERT_CREATED]);
      },
    },
    alertUpdated: {
      subscribe: (_: any, args: any, ctx: SentinelContext) => {
        requireAuth(ctx.user);
        if (args.id) {
          return withFilter(
            () => ctx.pubsub.asyncIterator([SUBSCRIPTION_EVENTS.ALERT_UPDATED]),
            (payload) => payload.alertUpdated.id === args.id,
          )(_, args, ctx, {} as any);
        }
        return ctx.pubsub.asyncIterator([SUBSCRIPTION_EVENTS.ALERT_UPDATED]);
      },
    },
    detectionCreated: {
      subscribe: (_: any, _args: any, ctx: SentinelContext) => {
        requireAuth(ctx.user);
        return ctx.pubsub.asyncIterator([SUBSCRIPTION_EVENTS.DETECTION_CREATED]);
      },
    },
    trackUpdated: {
      subscribe: (_: any, _args: any, ctx: SentinelContext) => {
        requireAuth(ctx.user);
        return ctx.pubsub.asyncIterator([SUBSCRIPTION_EVENTS.TRACK_UPDATED]);
      },
    },
    cyberEventCreated: {
      subscribe: (_: any, _args: any, ctx: SentinelContext) => {
        requireAuth(ctx.user);
        return ctx.pubsub.asyncIterator([SUBSCRIPTION_EVENTS.CYBER_EVENT_CREATED]);
      },
    },
    sensorStatusChanged: {
      subscribe: (_: any, _args: any, ctx: SentinelContext) => {
        requireAuth(ctx.user);
        return ctx.pubsub.asyncIterator([SUBSCRIPTION_EVENTS.SENSOR_STATUS_CHANGED]);
      },
    },
    approvalRequired: {
      subscribe: (_: any, _args: any, ctx: SentinelContext) => {
        requireAuth(ctx.user);
        return ctx.pubsub.asyncIterator([SUBSCRIPTION_EVENTS.APPROVAL_REQUIRED]);
      },
    },
    systemHealthChanged: {
      subscribe: (_: any, _args: any, ctx: SentinelContext) => {
        requireAuth(ctx.user);
        return ctx.pubsub.asyncIterator([SUBSCRIPTION_EVENTS.SYSTEM_HEALTH_CHANGED]);
      },
    },
  },

  Alert: {
    organization: (parent: any, _: any, ctx: SentinelContext) =>
      ctx.dataloaders.organizationLoader.load(parent.organizationId),
    assignedTo: (parent: any, _: any, ctx: SentinelContext) =>
      parent.assignedTo ? ctx.dataloaders.userLoader.load(parent.assignedTo) : null,
    acknowledgedBy: (parent: any, _: any, ctx: SentinelContext) =>
      parent.acknowledgedBy ? ctx.dataloaders.userLoader.load(parent.acknowledgedBy) : null,
    resolvedBy: (parent: any, _: any, ctx: SentinelContext) =>
      parent.resolvedBy ? ctx.dataloaders.userLoader.load(parent.resolvedBy) : null,
  },

  Sensor: {
    organization: (parent: any, _: any, ctx: SentinelContext) =>
      ctx.dataloaders.organizationLoader.load(parent.organizationId),
  },

  Mission: {
    organization: (parent: any, _: any, ctx: SentinelContext) =>
      ctx.dataloaders.organizationLoader.load(parent.organizationId),
    commander: (parent: any, _: any, ctx: SentinelContext) =>
      parent.commanderId ? ctx.dataloaders.userLoader.load(parent.commanderId) : null,
  },

  Task: {
    mission: (parent: any, _: any, ctx: SentinelContext) =>
      parent.missionId ? ctx.dataloaders.missionLoader.load(parent.missionId) : null,
    assignedTo: (parent: any, _: any, ctx: SentinelContext) =>
      parent.assignedTo ? ctx.dataloaders.userLoader.load(parent.assignedTo) : null,
    organization: (parent: any, _: any, ctx: SentinelContext) =>
      ctx.dataloaders.organizationLoader.load(parent.organizationId),
  },

  User: {
    organization: (parent: any, _: any, ctx: SentinelContext) =>
      ctx.dataloaders.organizationLoader.load(parent.organizationId),
  },

  Track: {
    organization: (parent: any, _: any, ctx: SentinelContext) =>
      ctx.dataloaders.organizationLoader.load(parent.organizationId),
  },
};
