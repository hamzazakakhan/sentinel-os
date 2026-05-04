// ──────────────────────────────────────────────────────────────
// sentinel-os/services/simulation-service/src/digital-twin/state.ts
// Digital twin — mirrors real infrastructure state for simulation
// ──────────────────────────────────────────────────────────────

import { Pool } from 'pg';
import { pino } from 'pino';

const logger = pino({ name: 'digital-twin' });

export interface TwinAsset {
  id: string;
  type: 'server' | 'workstation' | 'network_device' | 'firewall' | 'ids' | 'sensor' | 'container';
  name: string;
  ip_address: string;
  os: string;
  services: string[];
  vulnerabilities: string[];
  zone: string;
  criticality: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  is_compromised: boolean;
  last_synced: string;
}

export interface TwinNetwork {
  id: string;
  name: string;
  cidr: string;
  zone: string;
  assets: string[];
  firewall_rules: { source: string; dest: string; port: number; protocol: string; action: 'ALLOW' | 'DENY' }[];
}

export class DigitalTwin {
  private pg: Pool;

  constructor(pg: Pool) { this.pg = pg; }

  async syncFromRealInfrastructure(): Promise<{ assets: number; networks: number }> {
    // In production, this would query the real CMDB / asset inventory
    const assetCount = await this.pg.query('SELECT count(*) FROM simulation_twin_assets');
    const netCount = await this.pg.query('SELECT count(*) FROM simulation_twin_networks');
    logger.info({ assets: assetCount.rows[0]?.count, networks: netCount.rows[0]?.count }, 'Digital twin synced');
    return { assets: Number(assetCount.rows[0]?.count || 0), networks: Number(netCount.rows[0]?.count || 0) };
  }

  async addAsset(asset: TwinAsset): Promise<string> {
    const result = await this.pg.query(
      `INSERT INTO simulation_twin_assets (id, type, name, ip_address, os, services, vulnerabilities, zone, criticality, is_compromised, last_synced)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
       ON CONFLICT (id) DO UPDATE SET type = $2, name = $3, ip_address = $4, os = $5, services = $6, vulnerabilities = $7, zone = $8, criticality = $9, is_compromised = $10, last_synced = NOW()
       RETURNING id`,
      [asset.id, asset.type, asset.name, asset.ip_address, asset.os,
       JSON.stringify(asset.services), JSON.stringify(asset.vulnerabilities),
       asset.zone, asset.criticality, asset.is_compromised],
    );
    return result.rows[0]?.id;
  }

  async addNetwork(network: TwinNetwork): Promise<string> {
    const result = await this.pg.query(
      `INSERT INTO simulation_twin_networks (id, name, cidr, zone, assets, firewall_rules)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET name = $2, cidr = $3, zone = $4, assets = $5, firewall_rules = $6
       RETURNING id`,
      [network.id, network.name, network.cidr, network.zone,
       JSON.stringify(network.assets), JSON.stringify(network.firewall_rules)],
    );
    return result.rows[0]?.id;
  }

  async getAttackSurface(zone?: string): Promise<{ asset: TwinAsset; exposed_services: number; open_vulns: number }[]> {
    const zoneFilter = zone ? `WHERE zone = '${zone}'` : '';
    const result = await this.pg.query(
      `SELECT * FROM simulation_twin_assets ${zoneFilter} ORDER BY criticality DESC`,
    );
    return result.rows.map((r: any) => ({
      asset: r as TwinAsset,
      exposed_services: (r.services || []).length,
      open_vulns: (r.vulnerabilities || []).length,
    }));
  }

  async markCompromised(assetId: string): Promise<void> {
    await this.pg.query('UPDATE simulation_twin_assets SET is_compromised = true WHERE id = $1', [assetId]);
    logger.warn({ asset: assetId }, 'Asset marked as compromised in digital twin');
  }

  async resetState(): Promise<void> {
    await this.pg.query('UPDATE simulation_twin_assets SET is_compromised = false');
    logger.info('Digital twin state reset');
  }

  async getState(): Promise<{ assets: TwinAsset[]; compromised: number; by_zone: Record<string, number> }> {
    const result = await this.pg.query('SELECT * FROM simulation_twin_assets ORDER BY zone, criticality DESC');
    const assets = result.rows as TwinAsset[];
    const compromised = assets.filter(a => a.is_compromised).length;
    const by_zone: Record<string, number> = {};
    for (const a of assets) { by_zone[a.zone] = (by_zone[a.zone] || 0) + 1; }
    return { assets, compromised, by_zone };
  }
}
