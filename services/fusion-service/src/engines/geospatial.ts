// ──────────────────────────────────────────────────────────────
// sentinel-os/services/fusion-service/src/engines/geospatial.ts
// Geospatial proximity correlation using PostGIS
// ──────────────────────────────────────────────────────────────

import { Pool } from 'pg';
import { pino } from 'pino';

const logger = pino({ name: 'geospatial-engine' });

export interface GeoEntity {
  id: string;
  type: string;
  latitude: number;
  longitude: number;
  label: string;
  timestamp: string;
  properties: Record<string, any>;
}

export interface ProximityResult {
  entity_a: GeoEntity;
  entity_b: GeoEntity;
  distance_meters: number;
  correlation_type: string;
  confidence: number;
}

export class GeospatialEngine {
  private pg: Pool;

  constructor(pg: Pool) {
    this.pg = pg;
  }

  async findProximity(
    lat: number, lon: number, radiusKm: number,
    entityTypes?: string[], limit: number = 50,
  ): Promise<GeoEntity[]> {
    const typeFilter = entityTypes?.length
      ? `AND e.entity_type IN (${entityTypes.map((_, i) => `$${i + 4}`).join(',')})`
      : '';

    const result = await this.pg.query(
      `SELECT id, entity_type, label, latitude, longitude, timestamp, properties,
              ST_Distance(location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) as distance_m
       FROM fusion_geo_entities
       WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $3)
       ${typeFilter}
       ORDER BY distance_m ASC
       LIMIT $${entityTypes?.length ? entityTypes.length + 4 : 4}`,
      [lat, lon, radiusKm * 1000, limit, ...(entityTypes || [])],
    );

    return result.rows.map(r => ({
      id: r.id, type: r.entity_type, latitude: r.latitude,
      longitude: r.longitude, label: r.label, timestamp: r.timestamp,
      properties: r.properties || {},
    }));
  }

  async findCoLocated(
    entityA: GeoEntity, entityB: GeoEntity,
    timeWindowMin: number = 30, radiusKm: number = 1,
  ): Promise<ProximityResult[]> {
    const result = await this.pg.query(
      `SELECT a.id as a_id, a.entity_type as a_type, a.latitude as a_lat, a.longitude as a_lon,
              a.label as a_label, a.timestamp as a_ts, a.properties as a_props,
              b.id as b_id, b.entity_type as b_type, b.latitude as b_lat, b.longitude as b_lon,
              b.label as b_label, b.timestamp as b_ts, b.properties as b_props,
              ST_Distance(a.location, b.location) as distance_m
       FROM fusion_geo_entities a, fusion_geo_entities b
       WHERE a.id = $1 AND b.id = $2
         AND ST_DWithin(a.location, b.location, $3)
         AND ABS(EXTRACT(EPOCH FROM (a.timestamp - b.timestamp))) < $4 * 60`,
      [entityA.id, entityB.id, radiusKm * 1000, timeWindowMin],
    );

    return result.rows.map(r => ({
      entity_a: { id: r.a_id, type: r.a_type, latitude: r.a_lat, longitude: r.a_lon, label: r.a_label, timestamp: r.a_ts, properties: r.a_props || {} },
      entity_b: { id: r.b_id, type: r.b_type, latitude: r.b_lat, longitude: r.b_lon, label: r.b_label, timestamp: r.b_ts, properties: r.b_props || {} },
      distance_meters: r.distance_m,
      correlation_type: 'geospatial_proximity',
      confidence: Math.max(0, 1 - r.distance_m / (radiusKm * 1000)),
    }));
  }

  async upsertGeoEntity(entity: GeoEntity): Promise<void> {
    await this.pg.query(
      `INSERT INTO fusion_geo_entities (id, entity_type, label, latitude, longitude, timestamp, properties, location)
       VALUES ($1, $2, $3, $4, $5, $6, $7, ST_SetSRID(ST_MakePoint($5, $4), 4326))
       ON CONFLICT (id) DO UPDATE SET
         latitude = $4, longitude = $5, timestamp = $6, properties = $7,
         location = ST_SetSRID(ST_MakePoint($5, $4), 4326)`,
      [entity.id, entity.type, entity.label, entity.latitude, entity.longitude, entity.timestamp, JSON.stringify(entity.properties)],
    );
  }

  async getBoundingBox(entityType?: string): Promise<{ minLat: number; maxLat: number; minLon: number; maxLon: number }> {
    const typeFilter = entityType ? `WHERE entity_type = '${entityType}'` : '';
    const result = await this.pg.query(
      `SELECT MIN(latitude) as min_lat, MAX(latitude) as max_lat,
              MIN(longitude) as min_lon, MAX(longitude) as max_lon
       FROM fusion_geo_entities ${typeFilter}`,
    );
    const r = result.rows[0];
    return { minLat: r.min_lat || 0, maxLat: r.max_lat || 0, minLon: r.min_lon || 0, maxLon: r.max_lon || 0 };
  }
}
