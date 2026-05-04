// ──────────────────────────────────────────────────────────────
// sentinel-os/services/geo-service/src/connectors/nasa-gibs.ts
// NASA GIBS — Global Imagery Browse Services (MODIS, VIIRS, Landsat)
// ──────────────────────────────────────────────────────────────

import axios from 'axios';
import { pino } from 'pino';

const logger = pino({ name: 'nasa-gibs' });

export class NasaGibsConnector {
  private readonly baseUrl = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi';

  async getTileUrl(layer: string, date: string, bbox: [number, number, number, number], width = 512, height = 512): Promise<string> {
    const [minLon, minLat, maxLon, maxLat] = bbox;
    const params = new URLSearchParams({
      SERVICE: 'WMS',
      VERSION: '1.1.1',
      REQUEST: 'GetMap',
      LAYERS: layer,
      SRS: 'EPSG:4326',
      WIDTH: String(width),
      HEIGHT: String(height),
      BBOX: `${minLon},${minLat},${maxLon},${maxLat}`,
      TIME: date,
      FORMAT: 'image/png',
      TRANSPARENT: 'true',
    });
    return `${this.baseUrl}?${params.toString()}`;
  }

  async getCapabilities(): Promise<any> {
    try {
      const { data } = await axios.get(this.baseUrl, {
        params: {
          SERVICE: 'WMS',
          VERSION: '1.1.1',
          REQUEST: 'GetCapabilities',
        },
        timeout: 15000,
      });
      return data;
    } catch (err: any) {
      logger.warn({ err: err.message }, 'NASA GIBS capabilities fetch failed');
      return null;
    }
  }

  async getFireData(bbox: [number, number, number, number], date: string): Promise<string> {
    return this.getTileUrl('VIIRS_SNPP_Thermal_Anomalies_375m_All', date, bbox);
  }

  async getModisTrueColor(bbox: [number, number, number, number], date: string): Promise<string> {
    return this.getTileUrl('MODIS_Terra_CorrectedReflectance_TrueColor', date, bbox);
  }

  async getNightLights(bbox: [number, number, number, number], date: string): Promise<string> {
    return this.getTileUrl('VIIRS_SNPP_DayNightBand_At_Sensor_Radiance', date, bbox);
  }
}
