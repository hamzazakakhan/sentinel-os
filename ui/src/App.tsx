import { Routes, Route } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { Dashboard } from './pages/Dashboard';
import { AlertsPage } from './pages/AlertsPage';
import { MapPage } from './pages/MapPage';
import { SensorsPage } from './pages/SensorsPage';
import { CyberPage } from './pages/CyberPage';
import { FusionPage } from './pages/FusionPage';
import { OsintPage } from './pages/OsintPage';
import { ResponsePage } from './pages/ResponsePage';

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/alerts" element={<AlertsPage />} />
        <Route path="/map" element={<MapPage />} />
        <Route path="/sensors" element={<SensorsPage />} />
        <Route path="/cyber" element={<CyberPage />} />
        <Route path="/fusion" element={<FusionPage />} />
        <Route path="/osint" element={<OsintPage />} />
        <Route path="/response" element={<ResponsePage />} />
      </Routes>
    </AppShell>
  );
}
