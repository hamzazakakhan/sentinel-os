// ──────────────────────────────────────────────────────────────
// sentinel-os/shell/src/panels/TacticalMap.tsx
// Real MapLibre GL tactical map with alert overlays, clustering
// ──────────────────────────────────────────────────────────────

import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useQuery, gql } from '@apollo/client';
import { apolloClient } from '../lib/graphql';

const GET_MAP_ALERTS = gql`
  query GetMapAlerts($limit: Int) {
    alerts(limit: $limit) {
      id title severity domain latitude longitude createdAt
    }
  }
`;

const SEV_COLOR: Record<string, string> = {
  CRITICAL: '#d50000', HIGH: '#ff6f00', MEDIUM: '#ffd600', LOW: '#76ff03', INFO: '#00e5ff',
};

interface Alert { id: string; title: string; severity: string; domain: string; latitude: number | null; longitude: number | null; createdAt: string; }

export function TacticalMap() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapObj = useRef<maplibregl.Map | null>(null);

  const { data } = useQuery(GET_MAP_ALERTS, { variables: { limit: 200 }, client: apolloClient, pollInterval: 15000 });
  const alerts: Alert[] = (data?.alerts ?? []).filter((a: Alert) => a.latitude != null && a.longitude != null);

  useEffect(() => {
    if (!mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapRef.current,
      style: {
        version: 8,
        sources: { osm: { type: 'raster', tiles: ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png'], tileSize: 256 } },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      },
      center: [0, 20], zoom: 2, attributionControl: false,
    });
    map.addControl(new maplibregl.NavigationControl(), 'bottom-right');
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 100 }), 'bottom-left');
    map.on('load', () => {
      map.addSource('alerts', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, cluster: true, clusterMaxZoom: 14, clusterRadius: 50 });
      map.addLayer({ id: 'clusters', type: 'circle', source: 'alerts', filter: ['has', 'point_count'], paint: { 'circle-color': '#00e5ff', 'circle-radius': ['step', ['get', 'point_count'], 12, 10, 18, 50, 24], 'circle-opacity': 0.6, 'circle-stroke-width': 1, 'circle-stroke-color': '#00e5ff' } });
      map.addLayer({ id: 'cluster-label', type: 'symbol', source: 'alerts', filter: ['has', 'point_count'], layout: { 'text-field': '{point_count_abbreviated}', 'text-size': 11 }, paint: { 'text-color': '#b2ebf2' } });
      map.addLayer({ id: 'alert-point', type: 'circle', source: 'alerts', filter: ['!', ['has', 'point_count']], paint: { 'circle-color': ['get', 'color'], 'circle-radius': 6, 'circle-stroke-width': 2, 'circle-stroke-color': ['get', 'color'], 'circle-opacity': 0.85 } });
      map.on('click', 'alert-point', (e) => {
        const p = e.features?.[0]?.properties; if (!p) return;
        new maplibregl.Popup({ className: 'sentinel-popup' }).setLngLat(e.lngLat).setHTML(`<div style="font-family:Space Mono;font-size:11px;color:#b2ebf2;background:#061525;padding:8px;border:1px solid #0e2a44;"><div style="color:${SEV_COLOR[p.severity]||'#00e5ff'};font-weight:bold">[${p.severity}] ${p.title}</div><div style="color:#2e6e87">${p.domain} · ${new Date(p.ts).toLocaleTimeString()}</div></div>`).addTo(map);
      });
      mapObj.current = map;
    });
    return () => map.remove();
  }, []);

  useEffect(() => {
    const src = mapObj.current?.getSource('alerts') as maplibregl.GeoJSONSource | undefined;
    if (!src || !alerts.length) return;
    src.setData({ type: 'FeatureCollection', features: alerts.map((a: Alert) => ({ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [a.longitude!, a.latitude!] as [number, number] }, properties: { id: a.id, title: a.title, severity: a.severity, color: SEV_COLOR[a.severity] || '#00e5ff', domain: a.domain, ts: a.createdAt } })) });
  }, [alerts]);

  return (
    <div className="flex flex-col flex-1">
      <div className="panel-header"><span className="panel-icon">◈</span> TACTICAL MAP<span className="ml-auto text-[9px]" style={{ color: 'var(--text2)' }}>{alerts.length} threats</span></div>
      <div ref={mapRef} className="flex-1" style={{ minHeight: 0 }} />
    </div>
  );
}
