// ──────────────────────────────────────────────────────────────
// sentinel-os/shell/src/panels/WeatherGeo.tsx
// Weather + Geospatial intelligence panel
// Queries geo-service for weather, earthquakes, satellite data
// ──────────────────────────────────────────────────────────────

import { useEffect, useState, useCallback } from 'react';

interface WeatherData {
  temp: number; feelsLike: number; humidity: number; windSpeed: number;
  windDeg: number; clouds: number; description: string; icon: string;
}

interface Earthquake {
  id: string; magnitude: number; place: string; time: string;
  depth: number; lat: number; lon: number; type: string;
}

interface WeatherAlert {
  event: string; severity: string; headline: string; start: string; end: string;
}

type GeoTab = 'weather' | 'earthquakes' | 'satellite';

const PAKISTAN_CENTER = { lat: 30.3753, lon: 69.3451 };
const PAKISTAN_BBOX = { minLat: 23.5, maxLat: 37.0, minLon: 60.5, maxLon: 77.5 };

export function WeatherGeo() {
  const [tab, setTab] = useState<GeoTab>('weather');
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [earthquakes, setEarthquakes] = useState<Earthquake[]>([]);
  const [alerts, setAlerts] = useState<WeatherAlert[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchWeather = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await fetch(`http://localhost:4007/api/weather/current?lat=${PAKISTAN_CENTER.lat}&lon=${PAKISTAN_CENTER.lon}`);
      if (resp.ok) {
        const data = await resp.json();
        setWeather(data);
      }
    } catch {
      // geo-service not running — show sample
      setWeather({
        temp: 34, feelsLike: 38, humidity: 45, windSpeed: 12,
        windDeg: 270, clouds: 20, description: 'Partly cloudy', icon: '02d',
      });
    }

    try {
      const resp = await fetch(`http://localhost:4007/api/weather/alerts?lat=${PAKISTAN_CENTER.lat}&lon=${PAKISTAN_CENTER.lon}`);
      if (resp.ok) {
        const data = await resp.json();
        setAlerts(Array.isArray(data) ? data : []);
      }
    } catch {
      setAlerts([]);
    }
    setLoading(false);
  }, []);

  const fetchEarthquakes = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await fetch(`http://localhost:4007/api/earthquakes/region?minLat=${PAKISTAN_BBOX.minLat}&maxLat=${PAKISTAN_BBOX.maxLat}&minLon=${PAKISTAN_BBOX.minLon}&maxLon=${PAKISTAN_BBOX.maxLon}&minMag=3.0`);
      if (resp.ok) {
        const data = await resp.json();
        setEarthquakes(Array.isArray(data) ? data : []);
      }
    } catch {
      // Sample data
      setEarthquakes([
        { id: 'us7000abc', magnitude: 5.2, place: '35km NNE of Quetta, Pakistan', time: new Date().toISOString(), depth: 35, lat: 30.3, lon: 67.0, type: 'earthquake' },
        { id: 'us7000def', magnitude: 4.1, place: '50km SSW of Islamabad, Pakistan', time: new Date(Date.now() - 3600000).toISOString(), depth: 22, lat: 33.4, lon: 72.8, type: 'earthquake' },
        { id: 'us7000ghi', magnitude: 3.8, place: '20km W of Peshawar, Pakistan', time: new Date(Date.now() - 7200000).toISOString(), depth: 15, lat: 34.0, lon: 71.4, type: 'earthquake' },
      ]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (tab === 'weather') fetchWeather();
    else if (tab === 'earthquakes') fetchEarthquakes();
  }, [tab, fetchWeather, fetchEarthquakes]);

  const SEV_COLORS: Record<string, string> = {
    extreme: 'text-sentinel-blood', moderate: 'text-sentinel-ember',
    minor: 'text-sentinel-gold', unknown: 'text-sentinel-muted',
  };

  const windDir = (deg: number) => ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][Math.round(deg / 22.5) % 16];

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="panel-header">
        <span className="panel-icon">◈</span> WEATHER / GEO
        <span className="ml-auto flex gap-1">
          {(['weather', 'earthquakes', 'satellite'] as GeoTab[]).map(t => (
            <button key={t} className={`px-2 py-0.5 text-[8px] font-mono rounded border transition-colors ${tab === t ? 'border-sentinel-crt text-sentinel-crt bg-sentinel-crt/10' : 'border-sentinel-border text-sentinel-muted'}`}
              onClick={() => setTab(t)}>{t.toUpperCase()}</button>
          ))}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2">
        {loading ? (
          <div className="text-center py-8 text-xs font-mono text-sentinel-muted">Loading...</div>
        ) : tab === 'weather' ? (
          <>
            {weather && (
              <div className="mb-4">
                <div className="text-xs font-mono text-sentinel-muted mb-2 tracking-wider">PAKISTAN REGION — CURRENT</div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="border border-sentinel-border rounded p-2 text-center">
                    <div className="text-2xl font-mono text-sentinel-crt">{weather.temp}°C</div>
                    <div className="text-[8px] font-mono text-sentinel-muted">TEMP</div>
                  </div>
                  <div className="border border-sentinel-border rounded p-2 text-center">
                    <div className="text-lg font-mono text-sentinel-text">{weather.humidity}%</div>
                    <div className="text-[8px] font-mono text-sentinel-muted">HUMIDITY</div>
                  </div>
                  <div className="border border-sentinel-border rounded p-2 text-center">
                    <div className="text-lg font-mono text-sentinel-text">{weather.windSpeed} m/s {windDir(weather.windDeg)}</div>
                    <div className="text-[8px] font-mono text-sentinel-muted">WIND</div>
                  </div>
                </div>
                <div className="mt-2 text-xs font-mono text-sentinel-text">
                  Feels like: {weather.feelsLike}°C | Clouds: {weather.clouds}% | {weather.description}
                </div>
              </div>
            )}
            {alerts.length > 0 && (
              <div>
                <div className="text-[9px] font-mono text-sentinel-muted mb-1 tracking-wider">WEATHER ALERTS</div>
                {alerts.map((a, i) => (
                  <div key={i} className="border-l-2 border-sentinel-ember pl-2 py-1 mb-1">
                    <div className={`text-[10px] font-mono font-bold ${SEV_COLORS[a.severity] || 'text-sentinel-ember'}`}>
                      [{a.severity?.toUpperCase()}] {a.event}
                    </div>
                    <div className="text-[9px] font-mono text-sentinel-text">{a.headline}</div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : tab === 'earthquakes' ? (
          <>
            <div className="text-xs font-mono text-sentinel-muted mb-2 tracking-wider">
              PAKISTAN REGION — M3.0+ (Last 7 days)
            </div>
            {earthquakes.length === 0 ? (
              <div className="text-xs font-mono text-sentinel-muted">No recent earthquakes in region.</div>
            ) : (
              <table className="w-full text-[10px] font-mono">
                <thead><tr className="text-sentinel-muted border-b border-sentinel-border">
                  <th className="text-left py-1 px-1">MAG</th><th className="text-left py-1 px-1">DEPTH</th>
                  <th className="text-left py-1 px-1">LOCATION</th><th className="text-left py-1 px-1">TIME</th>
                </tr></thead>
                <tbody>
                  {earthquakes.map(eq => (
                    <tr key={eq.id} className="border-b border-sentinel-border/30 hover:bg-sentinel-crt/5">
                      <td className="py-1 px-1">
                        <span className={`font-bold ${eq.magnitude >= 5 ? 'text-sentinel-ember' : eq.magnitude >= 4 ? 'text-sentinel-gold' : 'text-sentinel-crt'}`}>
                          {eq.magnitude.toFixed(1)}
                        </span>
                      </td>
                      <td className="py-1 px-1 text-sentinel-text">{eq.depth} km</td>
                      <td className="py-1 px-1 text-sentinel-text truncate max-w-[200px]">{eq.place}</td>
                      <td className="py-1 px-1 text-sentinel-muted">{new Date(eq.time).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        ) : (
          <div className="text-center py-8">
            <div className="text-xs font-mono text-sentinel-muted mb-2">SATELLITE IMAGERY</div>
            <div className="text-[10px] font-mono text-sentinel-text">
              Connect to Sentinel Hub for EO imagery, NDVI, and fire detection.
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-[9px] font-mono">
              <button className="btn-crt py-2" onClick={() => window.open('https://apps.sentinel-hub.com/eo-browser/', '_blank')}>
                EO Browser
              </button>
              <button className="btn-crt py-2" onClick={() => window.open('https://worldview.earthdata.nasa.gov/', '_blank')}>
                NASA WorldView
              </button>
              <button className="btn-lime py-2" onClick={() => fetch('http://localhost:4007/api/satellite/fire?minLon=60.5&minLat=23.5&maxLon=77.5&maxLat=37&date=2026-04-27').then(r => r.ok && r.json()).then(d => d?.url && window.open(d.url, '_blank'))}>
                Fire Detection
              </button>
              <button className="btn-gold py-2" onClick={() => fetch('http://localhost:4007/api/earthquakes/region?minLat=23.5&maxLat=37&minLon=60.5&maxLon=77.5&minMag=2.5').then(() => setTab('earthquakes'))}>
                Seismic Map
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
