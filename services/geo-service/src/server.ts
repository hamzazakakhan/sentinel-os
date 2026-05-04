// ──────────────────────────────────────────────────────────────
// sentinel-os/services/geo-service/src/server.ts
// Geo-service — geospatial intelligence microservice (port 4007)
// Connectors: Sentinel Hub, NASA GIBS, OpenWeatherMap, USGS, GeoNames
// ──────────────────────────────────────────────────────────────

import Fastify from 'fastify';
import WebSocket from 'ws';
import { pino } from 'pino';
import { SentinelHubConnector } from './connectors/sentinel-hub';
import { NasaGibsConnector } from './connectors/nasa-gibs';
import { OpenWeatherMapConnector } from './connectors/openweathermap';
import { UsgsEarthquakesConnector } from './connectors/usgs-earthquakes';
import { GeoNamesConnector } from './connectors/geonames';

const logger = pino({ name: 'geo-service' });
const PORT = parseInt(process.env.GEO_SERVICE_PORT || '4007', 10);

const app = Fastify({ logger: false });

const sentinelHub = new SentinelHubConnector();
const nasaGibs = new NasaGibsConnector();
const openWeather = new OpenWeatherMapConnector();
const usgs = new UsgsEarthquakesConnector();
const geoNames = new GeoNamesConnector();

// ── Health ──
app.get('/health', async () => ({
  status: 'ok',
  service: 'geo-service',
  connectors: {
    sentinelHub: sentinelHub.isAvailable(),
    openWeather: openWeather.isAvailable(),
    geoNames: geoNames.isAvailable(),
    nasaGibs: true,
    usgs: true,
  },
}));

// ── Weather ──
app.get('/api/weather/current', async (req: any) => {
  const { lat, lon } = req.query;
  if (!lat || !lon) return { error: 'lat and lon required' };
  return openWeather.getCurrentWeather(parseFloat(lat), parseFloat(lon));
});

app.get('/api/weather/forecast', async (req: any) => {
  const { lat, lon } = req.query;
  if (!lat || !lon) return { error: 'lat and lon required' };
  return openWeather.getForecast(parseFloat(lat), parseFloat(lon));
});

app.get('/api/weather/alerts', async (req: any) => {
  const { lat, lon } = req.query;
  if (!lat || !lon) return { error: 'lat and lon required' };
  return openWeather.getAlerts(parseFloat(lat), parseFloat(lon));
});

// ── Earthquakes ──
app.get('/api/earthquakes', async (req: any) => {
  const { period = 'day' } = req.query;
  return usgs.getSignificant(period);
});

app.get('/api/earthquakes/region', async (req: any) => {
  const { minLat, maxLat, minLon, maxLon, minMag } = req.query;
  if (!minLat || !maxLat || !minLon || !maxLon) return { error: 'bounds required' };
  return usgs.getByRegion(
    parseFloat(minLat), parseFloat(maxLat),
    parseFloat(minLon), parseFloat(maxLon),
    minMag ? parseFloat(minMag) : 2.5,
  );
});

// ── Satellite ──
app.get('/api/satellite/tiles', async (req: any) => {
  const { minLon, minLat, maxLon, maxLat, from, to, maxCloud } = req.query;
  if (!minLon || !minLat || !maxLon || !maxLat || !from || !to) {
    return { error: 'bbox and date range required' };
  }
  return sentinelHub.searchTiles(
    [parseFloat(minLon), parseFloat(minLat), parseFloat(maxLon), parseFloat(maxLat)],
    from, to, maxCloud ? parseInt(maxCloud) : 30,
  );
});

app.get('/api/satellite/fire', async (req: any) => {
  const { minLon, minLat, maxLon, maxLat, date } = req.query;
  if (!minLon || !minLat || !maxLon || !maxLat || !date) {
    return { error: 'bbox and date required' };
  }
  return { url: await nasaGibs.getFireData(
    [parseFloat(minLon), parseFloat(minLat), parseFloat(maxLon), parseFloat(maxLat)],
    date,
  )};
});

// ── Places ──
app.get('/api/places/search', async (req: any) => {
  const { q, country, maxRows } = req.query;
  if (!q) return { error: 'q required' };
  return geoNames.search(q, maxRows ? parseInt(maxRows) : 10, country);
});

app.get('/api/places/nearby', async (req: any) => {
  const { lat, lon, radius, maxRows } = req.query;
  if (!lat || !lon) return { error: 'lat and lon required' };
  return geoNames.getNearby(
    parseFloat(lat), parseFloat(lon),
    radius ? parseInt(radius) : 50,
    maxRows ? parseInt(maxRows) : 10,
  );
});

// ── Start ──
app.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
  if (err) { logger.error(err); process.exit(1); }
  logger.info(`Geo-service listening on :${PORT}`);
});
