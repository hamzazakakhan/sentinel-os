import { useMemo } from 'react';
import { useQuery } from '@apollo/client';
import { Radio, Wifi, WifiOff, Activity } from 'lucide-react';
import { GET_SENSORS } from '../graphql/queries';

const seedSensors = [
  { id: 'sen-cam-001', name: 'Perimeter Camera North Gate', sensorType: 'CCTV', domain: 'LAND', status: 'ONLINE', lastHeartbeat: new Date(Date.now() - 30000).toISOString() },
  { id: 'sen-cam-002', name: 'Perimeter Camera East Fence', sensorType: 'CCTV', domain: 'LAND', status: 'ONLINE', lastHeartbeat: new Date(Date.now() - 45000).toISOString() },
  { id: 'sen-cam-003', name: 'Watchtower Camera South', sensorType: 'CCTV', domain: 'LAND', status: 'DEGRADED', lastHeartbeat: new Date(Date.now() - 120000).toISOString() },
  { id: 'sen-rad-001', name: 'Primary Surveillance Radar', sensorType: 'RADAR', domain: 'AIR', status: 'ONLINE', lastHeartbeat: new Date(Date.now() - 10000).toISOString() },
  { id: 'sen-rad-002', name: 'Secondary Surveillance Radar', sensorType: 'RADAR', domain: 'AIR', status: 'ONLINE', lastHeartbeat: new Date(Date.now() - 15000).toISOString() },
  { id: 'sen-rad-003', name: 'Coastal Radar Station', sensorType: 'RADAR', domain: 'SEA', status: 'ONLINE', lastHeartbeat: new Date(Date.now() - 8000).toISOString() },
  { id: 'sen-iot-001', name: 'Seismic Sensor Array Alpha', sensorType: 'IOT', domain: 'LAND', status: 'ONLINE', lastHeartbeat: new Date(Date.now() - 60000).toISOString() },
  { id: 'sen-iot-002', name: 'Weather Station Bravo', sensorType: 'IOT', domain: 'LAND', status: 'ONLINE', lastHeartbeat: new Date(Date.now() - 90000).toISOString() },
  { id: 'sen-iot-003', name: 'Acoustic Sensor Fence Line', sensorType: 'IOT', domain: 'LAND', status: 'ONLINE', lastHeartbeat: new Date(Date.now() - 55000).toISOString() },
  { id: 'sen-drn-001', name: 'Patrol Drone Alpha-1', sensorType: 'DRONE', domain: 'AIR', status: 'ONLINE', lastHeartbeat: new Date(Date.now() - 5000).toISOString() },
  { id: 'sen-drn-002', name: 'Patrol Drone Alpha-2', sensorType: 'DRONE', domain: 'AIR', status: 'OFFLINE', lastHeartbeat: new Date(Date.now() - 900000).toISOString() },
  { id: 'sen-drn-003', name: 'Recon Drone Bravo-1', sensorType: 'DRONE', domain: 'AIR', status: 'ONLINE', lastHeartbeat: new Date(Date.now() - 12000).toISOString() },
  { id: 'sen-sonar-001', name: 'Harbor Sonar Array', sensorType: 'SONAR', domain: 'SEA', status: 'ONLINE', lastHeartbeat: new Date(Date.now() - 20000).toISOString() },
  { id: 'sen-net-001', name: 'Network TAP Core Switch', sensorType: 'NETWORK', domain: 'CYBER', status: 'ONLINE', lastHeartbeat: new Date(Date.now() - 3000).toISOString() },
  { id: 'sen-net-002', name: 'Suricata IDS Node 1', sensorType: 'IDS', domain: 'CYBER', status: 'ONLINE', lastHeartbeat: new Date(Date.now() - 2000).toISOString() },
  { id: 'sen-net-003', name: 'Honeypot Cluster Alpha', sensorType: 'HONEYPOT', domain: 'CYBER', status: 'ONLINE', lastHeartbeat: new Date(Date.now() - 7000).toISOString() },
];

const STATUS_COLORS: Record<string, string> = {
  ONLINE: 'text-green-400',
  DEGRADED: 'text-yellow-400',
  OFFLINE: 'text-red-400',
};

export function SensorsPage() {
  const { data } = useQuery(GET_SENSORS, { variables: { pagination: { first: 100 } }, pollInterval: 15000, errorPolicy: 'all' });
  const sensors = useMemo(() => {
    const edges = data?.sensors?.edges || [];
    const apiSensors = edges.map((e: any) => e.node);
    return apiSensors.length > 0 ? apiSensors : seedSensors;
  }, [data]);

  const online = sensors.filter((s: any) => s.status === 'ONLINE').length;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Radio className="w-6 h-6 text-sentinel-400" />
          Sensors
          <span className="text-sm font-normal text-gray-500 ml-2">
            {online}/{sensors.length} online
          </span>
        </h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {sensors.map((sensor: any) => (
          <div key={sensor.id} className="glass-panel p-4 hover:border-gray-700 transition-colors">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                {sensor.status === 'ONLINE' ? (
                  <Wifi className={`w-4 h-4 ${STATUS_COLORS[sensor.status]}`} />
                ) : sensor.status === 'OFFLINE' ? (
                  <WifiOff className="w-4 h-4 text-red-400" />
                ) : (
                  <Activity className="w-4 h-4 text-yellow-400" />
                )}
                <span className={`text-xs font-medium ${STATUS_COLORS[sensor.status]}`}>
                  {sensor.status}
                </span>
              </div>
              <span className="domain-badge bg-gray-800 text-gray-400 text-[10px]">{sensor.domain}</span>
            </div>
            <h3 className="text-sm font-medium text-white">{sensor.name}</h3>
            <p className="text-xs text-gray-500 font-mono mt-1">{sensor.id}</p>
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <div>
                <span className="text-gray-600 block">Type</span>
                <span className="text-gray-300">{sensor.sensorType || sensor.type}</span>
              </div>
              <div>
                <span className="text-gray-600 block">Heartbeat</span>
                <span className="text-gray-300">{sensor.lastHeartbeat ? new Date(sensor.lastHeartbeat).toLocaleTimeString() : '-'}</span>
              </div>
              <div>
                <span className="text-gray-600 block">Domain</span>
                <span className="text-gray-300">{sensor.domain}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
