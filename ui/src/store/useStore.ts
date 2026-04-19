import { create } from 'zustand';

interface SentinelState {
  sidebarOpen: boolean;
  selectedDomains: string[];
  timeRange: { start: string; end: string } | null;
  classification: string;
  activeAlertCount: number;
  connectedSensors: number;
  systemHealth: 'healthy' | 'degraded' | 'critical';

  toggleSidebar: () => void;
  setSelectedDomains: (domains: string[]) => void;
  setTimeRange: (range: { start: string; end: string } | null) => void;
  setClassification: (level: string) => void;
  setActiveAlertCount: (count: number) => void;
  setConnectedSensors: (count: number) => void;
  setSystemHealth: (health: 'healthy' | 'degraded' | 'critical') => void;
}

export const useStore = create<SentinelState>((set) => ({
  sidebarOpen: true,
  selectedDomains: ['LAND', 'AIR', 'SEA', 'CYBER', 'SPACE'],
  timeRange: null,
  classification: 'UNCLASSIFIED',
  activeAlertCount: 0,
  connectedSensors: 0,
  systemHealth: 'healthy',

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSelectedDomains: (domains) => set({ selectedDomains: domains }),
  setTimeRange: (range) => set({ timeRange: range }),
  setClassification: (level) => set({ classification: level }),
  setActiveAlertCount: (count) => set({ activeAlertCount: count }),
  setConnectedSensors: (count) => set({ connectedSensors: count }),
  setSystemHealth: (health) => set({ systemHealth: health }),
}));
