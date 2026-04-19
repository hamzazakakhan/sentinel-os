import { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useStore } from '../../store/useStore';
import {
  LayoutDashboard, Bell, Map, Radio, Shield, GitBranch,
  Globe, Zap, Menu, ChevronLeft, Activity,
} from 'lucide-react';

const NAV_ITEMS = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/alerts', icon: Bell, label: 'Alerts' },
  { to: '/map', icon: Map, label: 'Map View' },
  { to: '/sensors', icon: Radio, label: 'Sensors' },
  { to: '/cyber', icon: Shield, label: 'Cyber' },
  { to: '/fusion', icon: GitBranch, label: 'Fusion' },
  { to: '/osint', icon: Globe, label: 'OSINT' },
  { to: '/response', icon: Zap, label: 'Response' },
];

const HEALTH_COLORS = {
  healthy: 'bg-green-500',
  degraded: 'bg-yellow-500',
  critical: 'bg-red-500',
};

export function AppShell({ children }: { children: ReactNode }) {
  const { sidebarOpen, toggleSidebar, activeAlertCount, systemHealth, classification } = useStore();

  return (
    <div className="flex h-screen overflow-hidden bg-gray-950">
      {/* Classification Banner */}
      <div className="fixed top-0 left-0 right-0 z-50 h-6 flex items-center justify-center text-[10px] font-bold tracking-widest uppercase bg-green-700 text-white">
        {classification}
      </div>

      {/* Sidebar */}
      <aside
        className={`fixed top-6 left-0 bottom-0 z-40 flex flex-col bg-gray-900 border-r border-gray-800 transition-all duration-200 ${
          sidebarOpen ? 'w-56' : 'w-16'
        }`}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 h-14 border-b border-gray-800">
          <div className="w-8 h-8 rounded-lg bg-sentinel-600 flex items-center justify-center flex-shrink-0">
            <Activity className="w-5 h-5 text-white" />
          </div>
          {sidebarOpen && (
            <span className="text-sm font-semibold text-white tracking-tight">Sentinel OS</span>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-3 px-2 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-sentinel-600/20 text-sentinel-400'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                }`
              }
            >
              <item.icon className="w-5 h-5 flex-shrink-0" />
              {sidebarOpen && <span>{item.label}</span>}
              {item.to === '/alerts' && activeAlertCount > 0 && (
                <span className="ml-auto bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                  {activeAlertCount > 99 ? '99+' : activeAlertCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-3 py-3 border-t border-gray-800 space-y-2">
          <div className="flex items-center gap-2 px-2">
            <div className={`w-2 h-2 rounded-full ${HEALTH_COLORS[systemHealth]} animate-pulse`} />
            {sidebarOpen && (
              <span className="text-xs text-gray-500 capitalize">{systemHealth}</span>
            )}
          </div>
          <button
            onClick={toggleSidebar}
            className="w-full flex items-center justify-center p-2 rounded-lg text-gray-500 hover:bg-gray-800 hover:text-gray-300 transition-colors"
          >
            {sidebarOpen ? <ChevronLeft className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main
        className={`flex-1 overflow-y-auto pt-6 transition-all duration-200 ${
          sidebarOpen ? 'ml-56' : 'ml-16'
        }`}
      >
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
