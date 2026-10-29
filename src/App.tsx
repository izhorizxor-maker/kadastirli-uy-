import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Bell,
  ClipboardList,
  FileSpreadsheet,
  History,
  LayoutDashboard,
  List,
  LogOut,
  Map as MapIcon,
  Menu,
  Users,
  WifiOff,
  X,
} from 'lucide-react';
import { apiRequest, getAuthToken, setAuthToken } from './api';
import { AuditBackupView } from './components/AuditBackupView';
import { DashboardView } from './components/DashboardView';
import { ExcelImportView } from './components/ExcelImportView';
import { LoginView } from './components/LoginView';
import { PropertiesListView } from './components/PropertiesListView';
import { PropertyDrawer } from './components/PropertyDrawer';
import { ReportsView } from './components/ReportsView';
import { SatelliteMapView } from './components/SatelliteMapView';
import { TasksView } from './components/TasksView';
import { UsersRegionsView } from './components/UsersRegionsView';
import {
  USER_ROLE_LABELS,
  type AuthUser,
  type NotificationItem,
  type PropertyRecord,
  type RegionItem,
  type UserRole,
} from './types';

interface NavItem {
  id: string;
  label: string;
  roles: UserRole[];
  icon: typeof LayoutDashboard;
}

const NAV_ITEMS: NavItem[] = [
  {
    id: 'dashboard',
    label: 'Bosh sahifa',
    roles: ['admin', 'inspector', 'mahalla'],
    icon: LayoutDashboard,
  },
  {
    id: 'map',
    label: 'Sun’iy yo‘ldosh xaritasi',
    roles: ['admin', 'inspector', 'mahalla'],
    icon: MapIcon,
  },
  {
    id: 'properties',
    label: 'Obyektlar ro‘yxati',
    roles: ['admin', 'inspector', 'mahalla'],
    icon: List,
  },
  {
    id: 'import',
    label: 'Excel orqali ma’lumot yuklash',
    roles: ['admin'],
    icon: FileSpreadsheet,
  },
  {
    id: 'tasks',
    label: 'Tekshiruv topshiriqlari',
    roles: ['admin', 'inspector', 'mahalla'],
    icon: ClipboardList,
  },
  {
    id: 'reports',
    label: 'Hisobotlar va statistika',
    roles: ['admin', 'inspector'],
    icon: BarChart3,
  },
  {
    id: 'users',
    label: 'Foydalanuvchilar boshqaruvi',
    roles: ['admin'],
    icon: Users,
  },
  {
    id: 'audit',
    label: 'Harakatlar tarixi',
    roles: ['admin'],
    icon: History,
  },
];

export default function App() {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [bootstrapping, setBootstrapping] = useState<boolean>(Boolean(getAuthToken()));
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [regions, setRegions] = useState<RegionItem[]>([]);
  const [refreshTick, setRefreshTick] = useState(0);

  // Cross-view navigation state
  const [drawerPropertyId, setDrawerPropertyId] = useState<number | null>(null);
  const [mapFocusTarget, setMapFocusTarget] = useState<{
    propertyId: number;
    lat: number | null;
    lng: number | null;
    correctionMode?: boolean;
  } | null>(null);
  const [listSearchUid, setListSearchUid] = useState<string>('');

  // Notifications
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);

  // Network & Toast state (TZ Section 15)
  const [isOffline, setIsOffline] = useState<boolean>(
    typeof navigator !== 'undefined' ? !navigator.onLine : false
  );
  const [toast, setToast] = useState<{
    id: number;
    msg: string;
    type: 'success' | 'error';
  } | null>(null);

  const showToast = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    const id = Date.now();
    setToast({ id, msg, type });
    setTimeout(() => {
      setToast((prev) => (prev?.id === id ? null : prev));
    }, 4500);
  }, []);

  const loadRegionsAndNotifications = useCallback(async () => {
    try {
      const [regList, notifList] = await Promise.all([
        apiRequest<RegionItem[]>('/api/regions'),
        apiRequest<NotificationItem[]>('/api/notifications'),
      ]);
      setRegions(regList);
      setNotifications(notifList);
    } catch {
      // handled by auth/network listeners
    }
  }, []);

  useEffect(() => {
    const token = getAuthToken();
    if (!token) {
      setBootstrapping(false);
      return;
    }
    apiRequest<{ user: AuthUser }>('/api/auth/me')
      .then((res) => {
        setCurrentUser(res.user);
      })
      .catch(() => {
        setAuthToken(null);
        setCurrentUser(null);
      })
      .finally(() => {
        setBootstrapping(false);
      });
  }, []);

  useEffect(() => {
    if (currentUser) {
      loadRegionsAndNotifications();
    }
  }, [currentUser, refreshTick, loadRegionsAndNotifications]);

  // Global network & session listeners
  useEffect(() => {
    const onOffline = () => setIsOffline(true);
    const onOnline = () => setIsOffline(false);
    const onNetCustom = (e: Event) => {
      const custom = e as CustomEvent<{ online: boolean }>;
      setIsOffline(!custom.detail.online);
    };
    const onUnauth = () => {
      setCurrentUser(null);
      setDrawerPropertyId(null);
    };

    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    window.addEventListener('ekadastr-network-status', onNetCustom);
    window.addEventListener('ekadastr-unauthorized', onUnauth);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('ekadastr-network-status', onNetCustom);
      window.removeEventListener('ekadastr-unauthorized', onUnauth);
    };
  }, []);

  const allowedNavItems = useMemo(() => {
    if (!currentUser) return [];
    return NAV_ITEMS.filter((item) => item.roles.includes(currentUser.role));
  }, [currentUser]);

  // Ensure activeTab is always authorized for currentUser
  useEffect(() => {
    if (!currentUser) return;
    if (!allowedNavItems.some((item) => item.id === activeTab)) {
      setActiveTab('dashboard');
    }
  }, [currentUser, allowedNavItems, activeTab]);

  const handleLogout = async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore logout error if session already expired
    } finally {
      setAuthToken(null);
      setCurrentUser(null);
      setDrawerPropertyId(null);
      setActiveTab('dashboard');
    }
  };

  const handleMarkNotificationsRead = async () => {
    try {
      await apiRequest('/api/notifications/read-all', { method: 'POST' });
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: 1 })));
    } catch {
      // ignore
    }
  };

  const handleFlyToMap = useCallback(
    (propertyId: number, lat: number | null, lng: number | null, correctionMode = false) => {
      setDrawerPropertyId(null);
      setMapFocusTarget({ propertyId, lat, lng, correctionMode });
      setActiveTab('map');
    },
    []
  );

  const handleJumpFromDrawerToMap = useCallback(
    (prop: PropertyRecord, startCorrectionMode = false) => {
      setDrawerPropertyId(null);
      setMapFocusTarget({
        propertyId: prop.id,
        lat: prop.latitude,
        lng: prop.longitude,
        correctionMode: startCorrectionMode,
      });
      setActiveTab('map');
    },
    []
  );

  const handleFindInList = useCallback((systemUid: string) => {
    setListSearchUid(systemUid);
    setActiveTab('properties');
  }, []);

  if (bootstrapping) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-sm text-slate-600">
        Tizim yuklanmoqda...
      </div>
    );
  }

  if (!currentUser) {
    return (
      <>
        {isOffline && (
          <div className="bg-red-600 text-white px-4 py-2 text-xs text-center flex items-center justify-center gap-2">
            <WifiOff className="w-3.5 h-3.5" />
            <span>Tarmoq bilan aloqa uzildi. Internet ulanishini tekshiring.</span>
          </div>
        )}
        <LoginView
          onLoginSuccess={(user) => {
            setCurrentUser(user);
            setActiveTab('dashboard');
          }}
        />
      </>
    );
  }

  const unreadCount = notifications.filter((n) => !n.is_read).length;
  const activeNavLabel =
    allowedNavItems.find((i) => i.id === activeTab)?.label || 'Bosh sahifa';

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Network Interrupted Banner (TZ Section 15) */}
      {isOffline && (
        <div className="bg-red-700 text-white px-4 py-2 text-xs font-medium flex items-center justify-center gap-2 z-50">
          <WifiOff className="w-3.5 h-3.5 shrink-0" />
          <span>
            Server bilan aloqa vaqtincha uzildi. Kiritilgan o‘zgarishlarni sahifani yangilamasdan
            aloqa tiklangach qayta saqlashingiz mumkin.
          </span>
        </div>
      )}

      {/* Toast Feedback Banner */}
      {toast && (
        <div
          className={`fixed bottom-4 right-4 z-[60] max-w-md px-4 py-3 rounded-lg shadow-lg border text-xs font-medium flex items-center justify-between gap-3 ${
            toast.type === 'error'
              ? 'bg-red-50 border-red-300 text-red-900'
              : 'bg-slate-900 border-slate-800 text-white'
          }`}
        >
          <span>{toast.msg}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="opacity-70 hover:opacity-100 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        {/* Sidebar Navigation (Desktop + Mobile Overlay) */}
        {mobileMenuOpen && (
          <div
            className="fixed inset-0 bg-slate-900/50 z-40 lg:hidden"
            onClick={() => setMobileMenuOpen(false)}
          />
        )}

        <aside
          className={`fixed lg:static inset-y-0 left-0 z-40 w-64 bg-slate-900 text-slate-300 flex flex-col justify-between shrink-0 transition-transform duration-150 ${
            mobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
          }`}
        >
          <div>
            {/* Brand Title */}
            <div className="h-[57px] px-5 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-md bg-blue-600 flex items-center justify-center shrink-0">
                  <MapIcon className="w-4 h-4 text-white" />
                </div>
                <span className="text-sm font-bold tracking-tight text-white whitespace-nowrap">
                  E-Kadastr Nazorat
                </span>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="lg:hidden text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Role-Scoped Navigation Links */}
            <nav className="p-3 space-y-1">
              {allowedNavItems.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full px-3 py-2.5 rounded-lg text-xs font-medium flex items-center gap-2.5 transition-colors text-left whitespace-nowrap cursor-pointer ${
                      active
                        ? 'bg-blue-600 text-white font-semibold'
                        : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Authenticated User Scope Footer */}
          <div className="p-4 border-t border-slate-800 space-y-2 text-xs">
            <div className="font-semibold text-white truncate">{currentUser.full_name}</div>
            <div className="text-[11px] text-slate-400">
              {USER_ROLE_LABELS[currentUser.role]}
              {' · '}
              {currentUser.mahalla_name ||
                currentUser.tuman_name ||
                currentUser.viloyat_name ||
                'Andijon viloyati'}
            </div>
          </div>
        </aside>

        {/* Main Workspace Column */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Top Bar Contract: Breadcrumb on Left, Primary Actions on Right */}
          <header className="h-[57px] bg-white border-b border-slate-200 px-4 lg:px-6 flex items-center justify-between gap-4 shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                className="lg:hidden p-1.5 rounded-md text-slate-600 hover:bg-slate-100"
                aria-label="Menyu"
              >
                <Menu className="w-5 h-5" />
              </button>
              <div className="flex items-center gap-2 text-xs text-slate-500 truncate">
                <span className="hidden sm:inline">Andijon tajriba tizimi</span>
                <span className="hidden sm:inline">/</span>
                <span className="font-semibold text-slate-900 truncate">{activeNavLabel}</span>
              </div>
            </div>

            <div className="flex items-center gap-2.5 shrink-0 relative">
              {/* Notifications Dropdown */}
              <button
                type="button"
                onClick={() => {
                  setNotifOpen((v) => !v);
                  if (!notifOpen && unreadCount > 0) {
                    handleMarkNotificationsRead();
                  }
                }}
                className="px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-lg border border-slate-200 inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
              >
                <Bell className="w-3.5 h-3.5 text-slate-600" />
                <span>Xabarlar</span>
                {unreadCount > 0 && (
                  <span className="font-mono font-bold text-blue-700">({unreadCount})</span>
                )}
              </button>

              {notifOpen && (
                <div className="absolute right-0 top-11 w-80 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between text-xs font-bold text-slate-900">
                    <span>Tizim bildirishnomalari</span>
                    <button
                      type="button"
                      onClick={() => setNotifOpen(false)}
                      className="text-slate-400 hover:text-slate-700 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="max-h-72 overflow-y-auto divide-y divide-slate-200 text-xs">
                    {notifications.length === 0 ? (
                      <div className="p-4 text-slate-500 text-center">
                        Yangi bildirishnomalar yo‘q.
                      </div>
                    ) : (
                      notifications.map((n) => (
                        <div
                          key={n.id}
                          onClick={() => {
                            setNotifOpen(false);
                            if (n.entity_type === 'property' && n.entity_id) {
                              setDrawerPropertyId(n.entity_id);
                            } else if (n.entity_type === 'task') {
                              setActiveTab('tasks');
                            }
                          }}
                          className="p-3 hover:bg-slate-50 cursor-pointer space-y-0.5"
                        >
                          <div className="font-semibold text-slate-900">{n.title}</div>
                          <div className="text-slate-600 leading-snug">{n.message}</div>
                          <div className="font-mono text-[10px] text-slate-400">{n.created_at}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* Logout Button */}
              <button
                type="button"
                onClick={handleLogout}
                className="px-3 py-1.5 text-xs font-semibold text-slate-700 hover:text-red-700 hover:bg-red-50 border border-slate-200 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Chiqish</span>
              </button>
            </div>
          </header>

          {/* Main Active Viewport */}
          <main className="flex-1 overflow-y-auto">
            {activeTab === 'dashboard' && (
              <DashboardView
                key={`dash-${refreshTick}-${currentUser.id}`}
                currentUser={currentUser}
                onNavigate={setActiveTab}
                onOpenProperty={setDrawerPropertyId}
                onFlyToPropertyOnMap={(propId, lat, lng) => handleFlyToMap(propId, lat, lng, false)}
                onSwitchUser={(u) => {
                  setCurrentUser(u);
                  setDrawerPropertyId(null);
                  setActiveTab('dashboard');
                  setRefreshTick((t) => t + 1);
                  showToast(`${u.full_name} hisobi faollashtirildi.`, 'success');
                }}
              />
            )}

            {activeTab === 'map' && (
              <SatelliteMapView
                key={`map-${refreshTick}`}
                currentUser={currentUser}
                regions={regions}
                focusTarget={mapFocusTarget}
                onClearFocusTarget={() => setMapFocusTarget(null)}
                onOpenPropertyCard={setDrawerPropertyId}
                onFindInList={handleFindInList}
                onToast={showToast}
              />
            )}

            {activeTab === 'properties' && (
              <PropertiesListView
                key={`props-${refreshTick}`}
                currentUser={currentUser}
                regions={regions}
                initialSearchUid={listSearchUid}
                onClearInitialSearch={() => setListSearchUid('')}
                onOpenPropertyCard={setDrawerPropertyId}
                onFlyToMap={handleFlyToMap}
                onToast={showToast}
              />
            )}

            {activeTab === 'import' && currentUser.role === 'admin' && (
              <ExcelImportView
                onToast={showToast}
                onImportCompleted={() => setRefreshTick((t) => t + 1)}
              />
            )}

            {activeTab === 'tasks' && (
              <TasksView
                key={`tasks-${refreshTick}`}
                currentUser={currentUser}
                onOpenPropertyCard={setDrawerPropertyId}
                onFlyToMap={(propId, lat, lng) => handleFlyToMap(propId, lat, lng, false)}
                onToast={showToast}
              />
            )}

            {activeTab === 'reports' && currentUser.role !== 'mahalla' && (
              <ReportsView
                key={`rep-${refreshTick}`}
                currentUser={currentUser}
                onToast={showToast}
              />
            )}

            {activeTab === 'users' && currentUser.role === 'admin' && (
              <UsersRegionsView
                currentUser={currentUser}
                regions={regions}
                onRegionsChanged={() => setRefreshTick((t) => t + 1)}
                onToast={showToast}
              />
            )}

            {activeTab === 'audit' && currentUser.role === 'admin' && (
              <AuditBackupView
                onToast={showToast}
                onRestored={() => setRefreshTick((t) => t + 1)}
              />
            )}
          </main>
        </div>
      </div>

      {/* Global Slide-over Property Card (TZ Section 7) */}
      <PropertyDrawer
        propertyId={drawerPropertyId}
        currentUser={currentUser}
        onClose={() => setDrawerPropertyId(null)}
        onUpdated={() => setRefreshTick((t) => t + 1)}
        onJumpToMap={handleJumpFromDrawerToMap}
        onToast={showToast}
      />
    </div>
  );
}
