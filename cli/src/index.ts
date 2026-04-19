#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import axios, { AxiosInstance } from 'axios';
import Table from 'cli-table3';

const VERSION = '1.0.0';
const DEFAULT_API = process.env.SENTINEL_API_URL || 'http://localhost:4000';

function createClient(baseURL: string, token?: string): AxiosInstance {
  return axios.create({
    baseURL,
    timeout: 30000,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

const program = new Command();

program
  .name('sentinel')
  .description(chalk.bold('Sentinel OS — Defense & Intelligence CLI'))
  .version(VERSION)
  .option('-u, --url <url>', 'API Gateway URL', DEFAULT_API)
  .option('-t, --token <token>', 'JWT auth token');

// ── Alerts ──────────────────────────────────────────────────────────────────

const alertsCmd = program.command('alerts').description('Manage alerts');

alertsCmd
  .command('list')
  .description('List alerts')
  .option('-s, --severity <severity>', 'Filter by severity (CRITICAL|HIGH|MEDIUM|LOW)')
  .option('-d, --domain <domain>', 'Filter by domain')
  .option('-l, --limit <n>', 'Max results', '20')
  .action(async (opts) => {
    const spinner = ora('Fetching alerts...').start();
    try {
      const client = createClient(program.opts().url, program.opts().token);
      const params: Record<string, string> = { limit: opts.limit };
      if (opts.severity) params.severity = opts.severity;
      if (opts.domain) params.domain = opts.domain;
      const { data } = await client.get('/api/v1/alerts', { params });
      spinner.stop();

      const table = new Table({
        head: ['ID', 'Severity', 'Domain', 'Title', 'Status', 'Created'].map(h => chalk.cyan(h)),
        colWidths: [12, 10, 8, 40, 14, 22],
      });
      for (const a of data.alerts || []) {
        const sevColor = a.severity === 'CRITICAL' ? chalk.red : a.severity === 'HIGH' ? chalk.yellow : chalk.green;
        table.push([a.id?.slice(0, 10), sevColor(a.severity), a.domain, a.title?.slice(0, 38), a.status, new Date(a.createdAt).toLocaleString()]);
      }
      console.log(table.toString());
      console.log(chalk.gray(`Total: ${data.total || data.alerts?.length || 0}`));
    } catch (err: any) {
      spinner.fail(chalk.red(`Failed: ${err.message}`));
    }
  });

alertsCmd
  .command('acknowledge <alertId>')
  .description('Acknowledge an alert')
  .action(async (alertId) => {
    const spinner = ora('Acknowledging...').start();
    try {
      const client = createClient(program.opts().url, program.opts().token);
      await client.post(`/api/v1/alerts/${alertId}/acknowledge`);
      spinner.succeed(chalk.green(`Alert ${alertId} acknowledged`));
    } catch (err: any) {
      spinner.fail(chalk.red(`Failed: ${err.message}`));
    }
  });

// ── Sensors ─────────────────────────────────────────────────────────────────

const sensorsCmd = program.command('sensors').description('Manage sensors');

sensorsCmd
  .command('list')
  .description('List connected sensors')
  .option('-t, --type <type>', 'Filter by type')
  .action(async (opts) => {
    const spinner = ora('Fetching sensors...').start();
    try {
      const client = createClient(program.opts().url, program.opts().token);
      const params: Record<string, string> = {};
      if (opts.type) params.type = opts.type;
      const { data } = await client.get('/api/v1/sensors', { params });
      spinner.stop();

      const table = new Table({
        head: ['ID', 'Name', 'Type', 'Status', 'Domain', 'Last Heartbeat'].map(h => chalk.cyan(h)),
      });
      for (const s of data.sensors || []) {
        const statusColor = s.status === 'ONLINE' ? chalk.green : s.status === 'DEGRADED' ? chalk.yellow : chalk.red;
        table.push([s.id?.slice(0, 10), s.name, s.type, statusColor(s.status), s.domain, s.lastHeartbeat || '-']);
      }
      console.log(table.toString());
    } catch (err: any) {
      spinner.fail(chalk.red(`Failed: ${err.message}`));
    }
  });

sensorsCmd
  .command('status <sensorId>')
  .description('Get sensor status')
  .action(async (sensorId) => {
    const spinner = ora('Fetching...').start();
    try {
      const client = createClient(program.opts().url, program.opts().token);
      const { data } = await client.get(`/api/v1/sensors/${sensorId}`);
      spinner.stop();
      console.log(chalk.bold('Sensor Details:'));
      for (const [k, v] of Object.entries(data)) {
        console.log(`  ${chalk.gray(k)}: ${chalk.white(String(v))}`);
      }
    } catch (err: any) {
      spinner.fail(chalk.red(`Failed: ${err.message}`));
    }
  });

// ── Cyber ───────────────────────────────────────────────────────────────────

const cyberCmd = program.command('cyber').description('Cyber operations');

cyberCmd
  .command('events')
  .description('List recent cyber events')
  .option('-l, --limit <n>', 'Max results', '20')
  .action(async (opts) => {
    const spinner = ora('Fetching cyber events...').start();
    try {
      const client = createClient(program.opts().url, program.opts().token);
      const { data } = await client.get('/api/v1/cyber/events', { params: { limit: opts.limit } });
      spinner.stop();

      const table = new Table({
        head: ['ID', 'Type', 'Severity', 'Source IP', 'Timestamp'].map(h => chalk.cyan(h)),
      });
      for (const e of data.events || []) {
        table.push([e.id?.slice(0, 10), e.eventType, e.severity, e.sourceIp || '-', new Date(e.timestamp).toLocaleString()]);
      }
      console.log(table.toString());
    } catch (err: any) {
      spinner.fail(chalk.red(`Failed: ${err.message}`));
    }
  });

cyberCmd
  .command('indicators')
  .description('List threat indicators')
  .option('-t, --type <type>', 'IOC type (ip|domain|hash|url)')
  .option('-l, --limit <n>', 'Max results', '20')
  .action(async (opts) => {
    const spinner = ora('Fetching indicators...').start();
    try {
      const client = createClient(program.opts().url, program.opts().token);
      const params: Record<string, string> = { limit: opts.limit };
      if (opts.type) params.type = opts.type;
      const { data } = await client.get('/api/v1/cyber/indicators', { params });
      spinner.stop();

      const table = new Table({
        head: ['Value', 'Type', 'Severity', 'Source', 'First Seen'].map(h => chalk.cyan(h)),
      });
      for (const i of data.indicators || []) {
        table.push([i.value, i.indicatorType, i.severity, i.source, new Date(i.firstSeen).toLocaleDateString()]);
      }
      console.log(table.toString());
    } catch (err: any) {
      spinner.fail(chalk.red(`Failed: ${err.message}`));
    }
  });

// ── Response ────────────────────────────────────────────────────────────────

const responseCmd = program.command('response').description('Response engine');

responseCmd
  .command('rules')
  .description('List response rules')
  .action(async () => {
    const spinner = ora('Fetching rules...').start();
    try {
      const client = createClient(program.opts().url, program.opts().token);
      const { data } = await client.get('/api/v1/response/rules');
      spinner.stop();

      const table = new Table({
        head: ['ID', 'Name', 'Severity', 'Approval', 'Active'].map(h => chalk.cyan(h)),
      });
      for (const r of data.rules || []) {
        table.push([r.id?.slice(0, 10), r.name, r.severityThreshold, r.requiresApproval ? 'Yes' : 'Auto', r.isActive ? chalk.green('Yes') : chalk.red('No')]);
      }
      console.log(table.toString());
    } catch (err: any) {
      spinner.fail(chalk.red(`Failed: ${err.message}`));
    }
  });

responseCmd
  .command('pending')
  .description('List pending approvals')
  .action(async () => {
    const spinner = ora('Fetching pending approvals...').start();
    try {
      const client = createClient(program.opts().url, program.opts().token);
      const { data } = await client.get('/api/v1/response/pending-approvals');
      spinner.stop();

      if (!data.approvals?.length) {
        console.log(chalk.green('No pending approvals'));
        return;
      }

      const table = new Table({
        head: ['Execution ID', 'Rule', 'Expires At'].map(h => chalk.cyan(h)),
      });
      for (const a of data.approvals) {
        table.push([a.execution_id?.slice(0, 10), a.rule_name, new Date(a.expires_at).toLocaleString()]);
      }
      console.log(table.toString());
    } catch (err: any) {
      spinner.fail(chalk.red(`Failed: ${err.message}`));
    }
  });

responseCmd
  .command('approve <executionId>')
  .description('Approve a pending execution')
  .option('-n, --notes <notes>', 'Approval notes')
  .action(async (executionId, opts) => {
    const spinner = ora('Approving...').start();
    try {
      const client = createClient(program.opts().url, program.opts().token);
      await client.post(`/api/v1/response/executions/${executionId}/approve`, { notes: opts.notes });
      spinner.succeed(chalk.green(`Execution ${executionId} approved`));
    } catch (err: any) {
      spinner.fail(chalk.red(`Failed: ${err.message}`));
    }
  });

responseCmd
  .command('reject <executionId>')
  .description('Reject a pending execution')
  .option('-n, --notes <notes>', 'Rejection notes')
  .action(async (executionId, opts) => {
    const spinner = ora('Rejecting...').start();
    try {
      const client = createClient(program.opts().url, program.opts().token);
      await client.post(`/api/v1/response/executions/${executionId}/reject`, { notes: opts.notes });
      spinner.succeed(chalk.yellow(`Execution ${executionId} rejected`));
    } catch (err: any) {
      spinner.fail(chalk.red(`Failed: ${err.message}`));
    }
  });

// ── Simulation ──────────────────────────────────────────────────────────────

const simCmd = program.command('sim').description('Simulation engine');

simCmd
  .command('list')
  .description('List simulations')
  .action(async () => {
    const spinner = ora('Fetching simulations...').start();
    try {
      const client = createClient(program.opts().url, program.opts().token);
      const { data } = await client.get('/api/v1/simulations');
      spinner.stop();

      const table = new Table({
        head: ['ID', 'Name', 'Type', 'Status', 'Created'].map(h => chalk.cyan(h)),
      });
      for (const s of data.simulations || []) {
        table.push([s.id?.slice(0, 10), s.name, s.scenario_type, s.status, new Date(s.created_at).toLocaleString()]);
      }
      console.log(table.toString());
    } catch (err: any) {
      spinner.fail(chalk.red(`Failed: ${err.message}`));
    }
  });

simCmd
  .command('start <simId>')
  .description('Start a simulation')
  .action(async (simId) => {
    const spinner = ora('Starting simulation...').start();
    try {
      const client = createClient(program.opts().url, program.opts().token);
      const { data } = await client.post(`/api/v1/simulations/${simId}/start`);
      spinner.succeed(chalk.green(`Simulation started — ${data.totalEvents} events queued`));
    } catch (err: any) {
      spinner.fail(chalk.red(`Failed: ${err.message}`));
    }
  });

simCmd
  .command('stop <simId>')
  .description('Stop a running simulation')
  .action(async (simId) => {
    const spinner = ora('Stopping simulation...').start();
    try {
      const client = createClient(program.opts().url, program.opts().token);
      await client.post(`/api/v1/simulations/${simId}/stop`);
      spinner.succeed(chalk.yellow(`Simulation ${simId} stopped`));
    } catch (err: any) {
      spinner.fail(chalk.red(`Failed: ${err.message}`));
    }
  });

// ── Health ───────────────────────────────────────────────────────────────────

program
  .command('health')
  .description('Check system health')
  .action(async () => {
    const spinner = ora('Checking system health...').start();
    const services = [
      { name: 'API Gateway', port: 4000 },
      { name: 'Auth', port: 4001 },
      { name: 'Ingestion', port: 4002 },
      { name: 'AI', port: 4003 },
      { name: 'OSINT', port: 4004 },
      { name: 'Fusion', port: 4005 },
      { name: 'Cyber', port: 4006 },
      { name: 'Response', port: 4007 },
      { name: 'Simulation', port: 4008 },
      { name: 'Governance', port: 4009 },
    ];

    spinner.stop();
    const table = new Table({
      head: ['Service', 'Port', 'Status', 'Details'].map(h => chalk.cyan(h)),
    });

    for (const svc of services) {
      try {
        const { data } = await axios.get(`http://localhost:${svc.port}/health`, { timeout: 3000 });
        table.push([svc.name, svc.port.toString(), chalk.green('HEALTHY'), data.status || 'OK']);
      } catch {
        table.push([svc.name, svc.port.toString(), chalk.red('UNREACHABLE'), '-']);
      }
    }
    console.log(table.toString());
  });

// ── OSINT ───────────────────────────────────────────────────────────────────

const osintCmd = program.command('osint').description('OSINT operations');

osintCmd
  .command('search <query>')
  .description('Search OSINT items')
  .option('-l, --limit <n>', 'Max results', '10')
  .action(async (query, opts) => {
    const spinner = ora('Searching OSINT...').start();
    try {
      const client = createClient(program.opts().url, program.opts().token);
      const { data } = await client.get('/api/v1/osint/search', { params: { q: query, limit: opts.limit } });
      spinner.stop();

      for (const item of data.items || []) {
        console.log(chalk.bold(item.title));
        console.log(chalk.gray(`  Feed: ${item.feedName} | IOCs: ${item.indicatorCount || 0} | ${new Date(item.publishedAt).toLocaleString()}`));
        if (item.summary) console.log(chalk.white(`  ${item.summary.slice(0, 120)}`));
        console.log();
      }
    } catch (err: any) {
      spinner.fail(chalk.red(`Failed: ${err.message}`));
    }
  });

// ── Governance ──────────────────────────────────────────────────────────────

const govCmd = program.command('governance').description('Governance & compliance');

govCmd
  .command('compliance')
  .description('Run compliance report')
  .action(async () => {
    const spinner = ora('Running compliance checks...').start();
    try {
      const client = createClient(program.opts().url, program.opts().token);
      const { data } = await client.get('/api/v1/governance/compliance/report');
      spinner.stop();

      console.log(chalk.bold(`Overall: ${data.overallStatus === 'COMPLIANT' ? chalk.green('COMPLIANT') : chalk.red('NON_COMPLIANT')}`));
      console.log();

      const table = new Table({
        head: ['Check', 'Category', 'Status'].map(h => chalk.cyan(h)),
      });
      for (const c of data.checks || []) {
        table.push([c.name, c.category, c.passed ? chalk.green('PASS') : chalk.red('FAIL')]);
      }
      console.log(table.toString());
    } catch (err: any) {
      spinner.fail(chalk.red(`Failed: ${err.message}`));
    }
  });

govCmd
  .command('audit')
  .description('View recent audit logs')
  .option('-l, --limit <n>', 'Max results', '20')
  .action(async (opts) => {
    const spinner = ora('Fetching audit logs...').start();
    try {
      const client = createClient(program.opts().url, program.opts().token);
      const { data } = await client.get('/api/v1/governance/audit-logs', { params: { limit: opts.limit } });
      spinner.stop();

      const table = new Table({
        head: ['Time', 'User', 'Action', 'Resource'].map(h => chalk.cyan(h)),
      });
      for (const l of data.logs || []) {
        table.push([new Date(l.created_at).toLocaleString(), l.user_id?.slice(0, 8) || '-', l.action, `${l.resource_type}/${l.resource_id?.slice(0, 8) || '-'}`]);
      }
      console.log(table.toString());
    } catch (err: any) {
      spinner.fail(chalk.red(`Failed: ${err.message}`));
    }
  });

// ── Banner ──────────────────────────────────────────────────────────────────

program.addHelpText('beforeAll', `
${chalk.bold.blue('╔═══════════════════════════════════════╗')}
${chalk.bold.blue('║')}  ${chalk.bold.white('SENTINEL OS')} ${chalk.gray('— Command Center CLI')}   ${chalk.bold.blue('║')}
${chalk.bold.blue('║')}  ${chalk.gray(`v${VERSION} | Defense & Intelligence OS`)} ${chalk.bold.blue('║')}
${chalk.bold.blue('╚═══════════════════════════════════════╝')}
`);

program.parse();
