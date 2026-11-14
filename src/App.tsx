import React, { useCallback, useEffect, useState } from 'react';
import { BhaviqLogo } from './components/BhaviqLogo';
import { SurfaceCard } from './components/ui';
import { apiRequest, getClientToken, setClientToken } from './lib/api';
import {
  buildAuthResultFromSupabaseSession,
  fetchShopProfile,
  getActiveSupabaseSession,
  isSupabaseConfigured,
  signOutSupabase,
} from './lib/supabaseClient';
import { t, type AppLanguage } from './lib/i18n';
import type { LiveAgriRateOverride } from './lib/masterCatalog';
import { useDailyMarketAlerts } from './lib/useDailyMarketAlerts';
import {
  getPendingTransactions,
  removePendingTransaction,
  updatePendingTransactionError,
  type PendingTransaction,
} from './lib/offlineQueue';
import type {
  Customer,
  DashboardSummary,
  Expense,
  Invoice,
  MarketPrice,
  MarketSyncRun,
  PriceAlert,
  PriceSource,
  Product,
  ProductWholesaleSummary,
  Purchase,
  Shop,
  StockMovement,
  Supplier,
  SupplierQuotation,
  UserProfile,
} from './lib/types';
import { AuthPage } from './pages/AuthPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { OverviewPage } from './pages/OverviewPage';
import { BillingPage } from './pages/BillingPage';
import { InventoryPage } from './pages/InventoryPage';
import { KhataPage } from './pages/KhataPage';
import { PurchasesPage, SuppliersPage } from './pages/PurchasesSuppliersPage';
import { MarketIntelligencePage } from './pages/MarketIntelligencePage';
import { ExpensesPage, ReportsPage, SettingsPage } from './pages/ReportsExpensesSettingsPage';
import {
  BarChart3,
  BookOpen,
  Building2,
  ChevronLeft,
  ChevronRight,
  Home,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Package,
  Receipt,
  ReceiptText,
  RefreshCw,
  Settings,
  Sun,
  TrendingUp,
  Truck,
  WifiOff,
  Smartphone,
} from 'lucide-react';
import { DevicePairingModal } from './components/DevicePairingModal';
import { MobileBarcodeScannerSheet } from './components/MobileBarcodeScannerSheet';
import {
  getSavedPairedDeviceInfo,
  getSavedPairingPayload,
  savePairedDeviceInfo,
  detectDeviceModel,
  deviceBridge,
  type PairedDeviceInfo,
  type BridgeMessage,
} from './lib/deviceBridge';

type NavKey =
  | 'overview'
  | 'billing'
  | 'inventory'
  | 'khata'
  | 'purchases'
  | 'suppliers'
  | 'market'
  | 'reports'
  | 'expenses'
  | 'settings'
  | 'more';

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return isMobile;
}

export default function App() {
  const isMobile = useIsMobile();

  const [bootstrapping, setBootstrapping] = useState(true);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [shops, setShops] = useState<Shop[]>([]);
  const [activeShopId, setActiveShopId] = useState<string | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [language, setLanguage] = useState<AppLanguage>('en');
  const [activeNav, setActiveNav] = useState<NavKey>('overview');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [focusMarketProductId, setFocusMarketProductId] = useState<string | null>(null);
  const [focusMarketSkuCode, setFocusMarketSkuCode] = useState<string | null>(null);
  const [focusMarketTab, setFocusMarketTab] = useState<'live' | 'alerts' | null>(null);
  const [liveAgriOverrides, setLiveAgriOverrides] = useState<Record<string, LiveAgriRateOverride>>({});

  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [pendingTxs, setPendingTxs] = useState<PendingTransaction[]>([]);
  const [syncingQueue, setSyncingQueue] = useState(false);
  const [pairedDevice, setPairedDevice] = useState<PairedDeviceInfo | null>(getSavedPairedDeviceInfo());
  const [devicePairingModalOpen, setDevicePairingModalOpen] = useState(false);
  const [mobileScannerOpen, setMobileScannerOpen] = useState(false);

  // Check URL query parameters on mount for deep-linked pairing
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const pairToken = params.get('pair_token') || params.get('pair');
      if (pairToken) {
        const pin = params.get('pin') || '';
        const shopId = params.get('shop_id') || '';
        const shopName = params.get('shop_name') || '';
        const deviceName = detectDeviceModel();
        const info: PairedDeviceInfo = {
          deviceId: 'mob_' + Date.now().toString(36),
          deviceName,
          pairedAt: Date.now(),
          lastActive: Date.now(),
          platform: 'Mobile',
          status: 'connected',
          token: pairToken,
          pin,
          shopId,
          shopName,
        };
        savePairedDeviceInfo(info);
        setPairedDevice(info);
        deviceBridge.send('DEVICE_PAIRED', 'mobile', {
          deviceId: info.deviceId,
          deviceName: info.deviceName,
          platform: info.platform,
          token: pairToken,
        });
        setMobileScannerOpen(true);
      }
    } catch {
      // ignore
    }
  }, []);

  // Listen for mobile bridge scan requests
  useEffect(() => {
    const payload = getSavedPairedDeviceInfo();
    if (!payload?.deviceId) return;
    setPairedDevice(payload);
  }, []);

  // Domain State
  const [loadingData, setLoadingData] = useState(false);
  const [dashboard, setDashboard] = useState<DashboardSummary | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [marketData, setMarketData] = useState<{
    sources: PriceSource[];
    syncRuns?: MarketSyncRun[];
    marketPrices: MarketPrice[];
    quotations: SupplierQuotation[];
    alerts: PriceAlert[];
    acknowledgedAlerts?: PriceAlert[];
    productRates?: ProductWholesaleSummary[];
  } | null>(null);

  const activeShop = shops.find((s) => s.id === activeShopId) || shops[0] || null;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [activeNav]);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => !prev);
  }, []);

  // Force Ctrl+B Global Shortcut: keydown listener on window to toggle sidebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleSidebar();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [toggleSidebar]);

  // Bootstrap session on mount (local token or persisted Supabase Auth session)
  useEffect(() => {
    let active = true;
    const bootstrap = async () => {
      try {
        const token = getClientToken();
        if (token) {
          try {
            const res = await apiRequest<{
              user: UserProfile;
              shops: Shop[];
              activeShopId: string | null;
            }>('/api/auth/me');
            if (!active) return;
            // Verify if user has a persistent shop profile in Supabase vault
            if (res.shops.length === 0) {
              const vaultShop = await fetchShopProfile(res.user.id);
              if (vaultShop) {
                res.shops = [vaultShop];
                res.activeShopId = vaultShop.id;
              }
            }
            setUser(res.user);
            setShops(res.shops);
            setActiveShopId(res.activeShopId);
            setTheme(res.user.theme || 'light');
            setLanguage(res.user.preferredLanguage || 'en');
            return;
          } catch {
            // Local backend not reachable; fallback to Supabase session below
          }
        }

        if (isSupabaseConfigured()) {
          const sbSession = await getActiveSupabaseSession();
          if (sbSession?.access_token) {
            try {
              const exchanged = await apiRequest<{
                token: string;
                user: UserProfile;
                shops: Shop[];
                activeShopId: string | null;
              }>('/api/auth/supabase-exchange', {
                method: 'POST',
                body: JSON.stringify({ accessToken: sbSession.access_token }),
              });
              if (!active) return;
              if (exchanged.shops.length === 0) {
                const vaultShop = await fetchShopProfile(sbSession.user.id);
                if (vaultShop) {
                  exchanged.shops = [vaultShop];
                  exchanged.activeShopId = vaultShop.id;
                }
              }
              setClientToken(exchanged.token);
              setUser(exchanged.user);
              setShops(exchanged.shops);
              setActiveShopId(exchanged.activeShopId);
              setTheme(exchanged.user.theme || 'light');
              setLanguage(exchanged.user.preferredLanguage || 'en');
              return;
            } catch {
              // Direct Supabase standalone profile resolution
              const savedShop = await fetchShopProfile(sbSession.user.id);
              const direct = buildAuthResultFromSupabaseSession(sbSession, savedShop);
              if (!active) return;
              setClientToken(direct.token);
              setUser(direct.user);
              setShops(direct.shops);
              setActiveShopId(direct.activeShopId);
              setTheme(direct.user.theme || 'light');
              setLanguage(direct.user.preferredLanguage || 'en');
              return;
            }
          }
        }
      } catch {
        setClientToken(null);
      } finally {
        if (active) setBootstrapping(false);
      }
    };
    void bootstrap();
    return () => {
      active = false;
    };
  }, []);

  const refreshAll = useCallback(async () => {
    if (!activeShop) return;
    setLoadingData(true);
    try {
      const sid = activeShop.id;
      const [dashRes, prodRes, custRes, invRes, supRes, purRes, expRes, mktRes] =
        await Promise.all([
          apiRequest<DashboardSummary>(`/api/shops/${sid}/dashboard`),
          apiRequest<{ products: Product[]; movements: StockMovement[] }>(
            `/api/shops/${sid}/products`
          ).catch(() => ({ products: [], movements: [] })),
          apiRequest<{ customers: Customer[] }>(`/api/shops/${sid}/customers`).catch(() => ({
            customers: [],
          })),
          apiRequest<{ invoices: Invoice[] }>(`/api/shops/${sid}/invoices`).catch(() => ({
            invoices: [],
          })),
          apiRequest<{ suppliers: Supplier[] }>(`/api/shops/${sid}/suppliers`).catch(() => ({
            suppliers: [],
          })),
          apiRequest<{ purchases: Purchase[] }>(`/api/shops/${sid}/purchases`).catch(() => ({
            purchases: [],
          })),
          apiRequest<{ expenses: Expense[] }>(`/api/shops/${sid}/expenses`).catch(() => ({
            expenses: [],
          })),
          apiRequest<{
            sources: PriceSource[];
            syncRuns?: MarketSyncRun[];
            marketPrices: MarketPrice[];
            quotations: SupplierQuotation[];
            alerts: PriceAlert[];
            acknowledgedAlerts?: PriceAlert[];
            productRates?: ProductWholesaleSummary[];
          }>(`/api/shops/${sid}/market/overview`).catch(() => null),
        ]);

      setDashboard(dashRes);
      setProducts(prodRes.products);
      setMovements(prodRes.movements);
      setCustomers(custRes.customers);
      setInvoices(invRes.invoices);
      setSuppliers(supRes.suppliers);
      setPurchases(purRes.purchases);
      setExpenses(expRes.expenses);
      setMarketData(mktRes);
    } finally {
      setLoadingData(false);
    }
  }, [activeShop]);

  const dailyAlertsState = useDailyMarketAlerts({
    shopId: activeShop?.id || '',
    products,
    defaultMarginPct: activeShop?.defaultMarginPct || 15,
    serverAlerts: marketData?.alerts ?? dashboard?.priceAlerts ?? [],
    serverAcknowledgedAlerts: marketData?.acknowledgedAlerts ?? [],
    liveAgriOverrides,
    onAfterAcknowledge: refreshAll,
  });

  useEffect(() => {
    if (activeShop) {
      setPendingTxs(getPendingTransactions(activeShop.id));
      void refreshAll();
    }
  }, [activeShop, refreshAll]);

  const flushPendingQueue = useCallback(async () => {
    if (!activeShop || !isOnline || syncingQueue) return;
    const queue = getPendingTransactions(activeShop.id);
    if (queue.length === 0) return;

    setSyncingQueue(true);
    let anySynced = false;
    for (const tx of queue) {
      try {
        await apiRequest(tx.endpoint, {
          method: tx.method,
          body: JSON.stringify(tx.payload),
        });
        removePendingTransaction(tx.id);
        anySynced = true;
      } catch (err) {
        updatePendingTransactionError(
          tx.id,
          err instanceof Error ? err.message : 'Sync failed'
        );
      }
    }
    setPendingTxs(getPendingTransactions(activeShop.id));
    setSyncingQueue(false);
    if (anySynced) {
      await refreshAll();
    }
  }, [activeShop, isOnline, syncingQueue, refreshAll]);

  useEffect(() => {
    if (isOnline && pendingTxs.length > 0) {
      void flushPendingQueue();
    }
  }, [isOnline, pendingTxs.length, flushPendingQueue]);

  const handleToggleTheme = async () => {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    if (user) {
      try {
        await apiRequest('/api/auth/preferences', {
          method: 'PATCH',
          body: JSON.stringify({ theme: next }),
        });
      } catch {
        // ignore non-critical preference sync
      }
    }
  };

  const handleChangeLanguage = async (nextLang: AppLanguage) => {
    setLanguage(nextLang);
    if (user) {
      try {
        await apiRequest('/api/auth/preferences', {
          method: 'PATCH',
          body: JSON.stringify({ preferredLanguage: nextLang }),
        });
      } catch {
        // ignore
      }
    }
  };

  const handleLogout = async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    await signOutSupabase();
    setClientToken(null);
    setUser(null);
    setShops([]);
    setActiveShopId(null);
    setDashboard(null);
  };

  if (bootstrapping) {
    return (
      <div className="min-h-screen bg-[var(--bg-canvas)] flex items-center justify-center">
        <BhaviqLogo size="lg" />
      </div>
    );
  }

  if (!user) {
    return (
      <AuthPage
        theme={theme}
        onToggleTheme={handleToggleTheme}
        onAuthenticated={(data) => {
          setUser(data.user);
          setShops(data.shops);
          setActiveShopId(data.activeShopId);
          setTheme(data.user.theme || 'light');
          setLanguage(data.user.preferredLanguage || 'en');
        }}
      />
    );
  }

  if (!activeShop) {
    return (
      <OnboardingPage
        ownerName={user.fullName}
        onShopCreated={(shop, allShops) => {
          setShops(allShops);
          setActiveShopId(shop.id);
          setActiveNav('overview');
        }}
        onLogout={handleLogout}
      />
    );
  }

  const desktopNavItems: Array<{ key: NavKey; label: string; icon: React.ReactNode }> = [
    { key: 'overview', label: t(language, 'overview'), icon: <LayoutDashboard className="w-4 h-4" /> },
    { key: 'billing', label: t(language, 'billing'), icon: <Receipt className="w-4 h-4" /> },
    { key: 'inventory', label: t(language, 'inventory'), icon: <Package className="w-4 h-4" /> },
    { key: 'khata', label: t(language, 'khata'), icon: <BookOpen className="w-4 h-4" /> },
    { key: 'purchases', label: t(language, 'purchases'), icon: <Truck className="w-4 h-4" /> },
    { key: 'suppliers', label: t(language, 'suppliers'), icon: <Building2 className="w-4 h-4" /> },
    { key: 'market', label: t(language, 'market'), icon: <TrendingUp className="w-4 h-4" /> },
    { key: 'reports', label: t(language, 'reports'), icon: <BarChart3 className="w-4 h-4" /> },
    { key: 'expenses', label: t(language, 'expenses'), icon: <ReceiptText className="w-4 h-4" /> },
    { key: 'settings', label: t(language, 'settings'), icon: <Settings className="w-4 h-4" /> },
  ];

  const activeTitle =
    activeNav === 'more'
      ? t(language, 'more')
      : desktopNavItems.find((i) => i.key === activeNav)?.label || 'Overview';

  const renderActiveContent = () => {
    if (activeNav === 'more' && isMobile) {
      const moreItems: Array<{ key: NavKey; label: string; desc: string; icon: React.ReactNode }> = [
        { key: 'khata', label: t(language, 'khata'), desc: 'Customer credit & repayments', icon: <BookOpen className="w-5 h-5" /> },
        { key: 'purchases', label: t(language, 'purchases'), desc: 'Stock-in & landed costs', icon: <Truck className="w-5 h-5" /> },
        { key: 'suppliers', label: t(language, 'suppliers'), desc: 'Wholesaler directory', icon: <Building2 className="w-5 h-5" /> },
        { key: 'reports', label: t(language, 'reports'), desc: 'Sales, profit & GST', icon: <BarChart3 className="w-5 h-5" /> },
        { key: 'expenses', label: t(language, 'expenses'), desc: 'Rent, electricity & wages', icon: <ReceiptText className="w-5 h-5" /> },
        { key: 'settings', label: t(language, 'settings'), desc: 'Shop, tax, RBAC & theme', icon: <Settings className="w-5 h-5" /> },
      ];
      return (
        <div className="space-y-3 bhaviq-page-enter">
          <div className="grid grid-cols-2 gap-3">
            {moreItems.map((item) => (
              <SurfaceCard
                key={item.key}
                onClick={() => setActiveNav(item.key)}
                className="p-4 space-y-2"
              >
                <div className="w-9 h-9 rounded-xl bg-[var(--bg-subtle)] text-[var(--accent-primary)] flex items-center justify-center">
                  {item.icon}
                </div>
                <div>
                  <p className="text-sm font-semibold text-[var(--text-primary)]">{item.label}</p>
                  <p className="text-[11px] text-[var(--text-muted)] leading-snug">{item.desc}</p>
                </div>
              </SurfaceCard>
            ))}
          </div>

          <SurfaceCard className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-[var(--text-primary)]">{user.fullName}</p>
              <p className="text-[11px] text-[var(--text-muted)]">{user.email}</p>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="px-3 py-2 rounded-xl border border-[var(--border-hairline)] text-xs font-semibold inline-flex items-center gap-1.5"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign out</span>
            </button>
          </SurfaceCard>
        </div>
      );
    }

    switch (activeNav) {
      case 'overview':
        return (
          <OverviewPage
            shop={activeShop}
            summary={dashboard}
            alerts={dailyAlertsState.activeAlerts}
            acknowledgingAlertId={dailyAlertsState.acknowledgingId}
            loading={loadingData}
            isMobile={isMobile}
            onNavigate={(tab) => setActiveNav(tab as NavKey)}
            onAcknowledgeAlert={(alertId) => void dailyAlertsState.acknowledgeAlert(alertId)}
            onOpenAlertsTab={() => {
              setFocusMarketProductId(null);
              setFocusMarketSkuCode(null);
              setFocusMarketTab('alerts');
              setActiveNav('market');
            }}
            onViewAlertSku={(alert) => {
              if (alert.skuCode) {
                setFocusMarketProductId(null);
                setFocusMarketSkuCode(alert.skuCode);
                setFocusMarketTab('live');
                setActiveNav('market');
              } else if (alert.productId) {
                setFocusMarketSkuCode(null);
                setFocusMarketTab(null);
                setFocusMarketProductId(alert.productId);
                setActiveNav('market');
              } else {
                setFocusMarketTab('alerts');
                setActiveNav('market');
              }
            }}
          />
        );
      case 'billing':
        return (
          <BillingPage
            shop={activeShop}
            products={products}
            customers={customers}
            invoices={invoices}
            isMobile={isMobile}
            isOnline={isOnline}
            onRefreshAll={refreshAll}
            onPendingQueueUpdated={() => setPendingTxs(getPendingTransactions(activeShop.id))}
          />
        );
      case 'inventory':
        return (
          <InventoryPage
            shop={activeShop}
            products={products}
            movements={movements}
            suppliers={suppliers}
            isMobile={isMobile}
            onRefreshAll={refreshAll}
            onOpenWholesaleView={(productId) => {
              setFocusMarketProductId(productId);
              setActiveNav('market');
            }}
          />
        );
      case 'khata':
        return (
          <KhataPage
            shop={activeShop}
            customers={customers}
            isMobile={isMobile}
            onRefreshAll={refreshAll}
          />
        );
      case 'purchases':
        return (
          <PurchasesPage
            shop={activeShop}
            purchases={purchases}
            suppliers={suppliers}
            products={products}
            isMobile={isMobile}
            onRefreshAll={refreshAll}
          />
        );
      case 'suppliers':
        return (
          <SuppliersPage
            shop={activeShop}
            suppliers={suppliers}
            isMobile={isMobile}
            onRefreshAll={refreshAll}
          />
        );
      case 'market':
        return (
          <MarketIntelligencePage
            shop={activeShop}
            products={products}
            suppliers={suppliers}
            marketData={marketData}
            isMobile={isMobile}
            initialDetailProductId={focusMarketProductId}
            initialFocusSkuCode={focusMarketSkuCode}
            initialTab={focusMarketTab}
            dailyAlertsState={dailyAlertsState}
            onClearInitialDetail={() => setFocusMarketProductId(null)}
            onClearInitialFocusSku={() => setFocusMarketSkuCode(null)}
            onClearInitialTab={() => setFocusMarketTab(null)}
            onLiveAgriOverridesChange={setLiveAgriOverrides}
            onRefreshAll={refreshAll}
          />
        );
      case 'reports':
        return <ReportsPage shop={activeShop} isMobile={isMobile} />;
      case 'expenses':
        return (
          <ExpensesPage
            shop={activeShop}
            expenses={expenses}
            onRefreshAll={refreshAll}
          />
        );
      case 'settings':
        return (
          <SettingsPage
            shop={activeShop}
            user={user}
            theme={theme}
            language={language}
            onToggleTheme={handleToggleTheme}
            onChangeLanguage={handleChangeLanguage}
            onRefreshAll={refreshAll}
            products={products}
            invoices={invoices}
            customers={customers}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg-canvas)] text-[var(--text-primary)] flex w-full max-w-full overflow-x-hidden">
        {/* DESKTOP FLOATING 3D SIDEBAR */}
        {!isMobile && (
          <div className="p-3 pr-0 shrink-0">
            <aside
              aria-label="Primary sidebar navigation"
              className={`bhaviq-sidebar-3d sticky top-3 h-[calc(100vh-1.5rem)] rounded-2xl flex flex-col justify-between transition-[width] duration-200 overflow-hidden ${
                sidebarCollapsed ? 'w-[74px]' : 'w-[254px]'
              }`}
            >
              <div>
                <div className={`h-16 flex items-center border-b border-[var(--border-hairline)] ${sidebarCollapsed ? 'justify-center px-2' : 'justify-between px-4'}`}>
                  {sidebarCollapsed ? (
                    <button
                      type="button"
                      onClick={toggleSidebar}
                      aria-label="Expand sidebar (Ctrl+B)"
                      title="Expand sidebar (Ctrl+B)"
                      className="p-1 rounded-xl hover:bg-[var(--bg-subtle)] transition-colors flex items-center justify-center focus:outline-none"
                    >
                      <BhaviqLogo variant="mark" size="md" />
                    </button>
                  ) : (
                    <>
                      <BhaviqLogo variant="lockup" size="md" />
                      <button
                        type="button"
                        onClick={toggleSidebar}
                        aria-label="Collapse sidebar (Ctrl+B)"
                        title="Collapse sidebar (Ctrl+B)"
                        className="p-1.5 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)] transition-colors shrink-0"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </div>

                {!sidebarCollapsed && (
                  <div className="mx-3 mt-3 px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200/70 dark:border-slate-700/60">
                    <p className="text-xs font-bold text-[var(--text-primary)] truncate">
                      {activeShop.name}
                    </p>
                    <p className="text-[11px] text-[var(--text-muted)] truncate mt-0.5">
                      {activeShop.city}, {activeShop.state} · {activeShop.role}
                    </p>
                  </div>
                )}

                <nav className="p-3 space-y-1">
                  {desktopNavItems.map((item) => {
                    const active = activeNav === item.key;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => {
                          if (item.key !== 'market') setFocusMarketProductId(null);
                          setActiveNav(item.key);
                        }}
                        title={sidebarCollapsed ? item.label : undefined}
                        className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-full text-xs font-semibold transition-all duration-150 whitespace-nowrap ${
                          active
                            ? 'bhaviq-nav-active'
                            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)] hover:translate-x-1'
                        } ${sidebarCollapsed ? 'justify-center px-0' : ''}`}
                      >
                        <span className="shrink-0">{item.icon}</span>
                        {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                      </button>
                    );
                  })}
                </nav>
              </div>

              <div className="p-3 border-t border-[var(--border-hairline)]">
                <button
                  type="button"
                  onClick={handleLogout}
                  title="Sign out"
                  className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-full text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)] hover:translate-x-1 transition-all duration-150 ${
                    sidebarCollapsed ? 'justify-center px-0' : ''
                  }`}
                >
                  <LogOut className="w-4 h-4 shrink-0" />
                  {!sidebarCollapsed && <span>Sign out</span>}
                </button>
              </div>
            </aside>
          </div>
        )}

        {/* MAIN COLUMN */}
        <div className="flex-1 min-w-0 flex flex-col w-full max-w-full overflow-x-hidden">
          {/* TOP BAR */}
          <header className="sticky top-0 z-30 h-[56px] md:h-16 border-b border-[var(--border-hairline)] bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl px-4 md:px-8 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <h1 className="font-display text-base md:text-lg font-bold tracking-tight text-[var(--text-primary)] truncate">
                {activeTitle}
              </h1>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              {!isOnline && (
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
                  <WifiOff className="w-3.5 h-3.5" />
                  <span>Offline</span>
                </span>
              )}

              {pendingTxs.length > 0 && (
                <button
                  type="button"
                  onClick={() => void flushPendingQueue()}
                  disabled={!isOnline || syncingQueue}
                  className="px-3 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs font-semibold text-amber-800 dark:text-amber-300 inline-flex items-center gap-1.5 shadow-xs"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${syncingQueue ? 'animate-spin' : ''}`} />
                  <span>{pendingTxs.length} pending sync</span>
                </button>
              )}

              {/* Mobile Barcode Scanner Bridge Quick Access */}
              <button
                type="button"
                onClick={() => setDevicePairingModalOpen(true)}
                aria-label="Device Pairing & Mobile Barcode Bridge"
                title={
                  pairedDevice
                    ? `🟢 Linked & Connected to ${pairedDevice.deviceName} (Ready to scan)`
                    : 'Pair mobile phone as wireless optical barcode scanner'
                }
                className={`min-h-[40px] px-3 rounded-xl border flex items-center justify-center gap-1.5 transition-colors shadow-xs ${
                  pairedDevice
                    ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50/90 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300'
                    : 'border-slate-200 dark:border-slate-700 bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]'
                }`}
              >
                <Smartphone className={`w-4 h-4 ${pairedDevice ? 'text-emerald-600 dark:text-emerald-400' : ''}`} />
                {pairedDevice && (
                  <span className="flex h-2 w-2 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                )}
                <span className="text-xs font-semibold hidden md:inline">
                  {pairedDevice ? '🟢 Linked & Connected' : 'Link Device'}
                </span>
              </button>

              <button
                type="button"
                onClick={handleToggleTheme}
                aria-label="Toggle color theme"
                className="min-w-[40px] min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-[var(--bg-surface)] shadow-xs flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] transition-colors"
              >
                {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>

              {!isMobile && activeNav !== 'billing' && (
                <button
                  type="button"
                  onClick={() => setActiveNav('billing')}
                  className="bhaviq-btn-primary px-4 py-2 min-h-[40px] rounded-xl text-xs font-semibold whitespace-nowrap"
                >
                  New Bill
                </button>
              )}
            </div>
          </header>

          {/* MAIN WORKSPACE */}
          <main className="flex-1 p-4 md:p-8 pb-24 md:pb-10 max-w-[1440px] w-full mx-auto min-w-0 overflow-x-hidden">
            {renderActiveContent()}
          </main>
        </div>

        {/* MOBILE FIXED BOTTOM NAVIGATION BAR (5 native retail tabs, height 64px) */}
        {isMobile && (
          <nav
            aria-label="Mobile bottom navigation"
            className="fixed bottom-0 left-0 right-0 z-40 h-16 border-t border-[var(--border-hairline)] bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl grid grid-cols-5 items-center shadow-lg shadow-slate-900/5"
          >
            {(
              [
                { key: 'overview', label: 'Home', icon: <Home className="w-5 h-5" /> },
                { key: 'billing', label: 'Billing', icon: <Receipt className="w-5 h-5" /> },
                { key: 'inventory', label: 'Stock', icon: <Package className="w-5 h-5" /> },
                { key: 'market', label: 'Market', icon: <TrendingUp className="w-5 h-5" /> },
                { key: 'more', label: 'More', icon: <Menu className="w-5 h-5" /> },
              ] as const
            ).map((tab) => {
              const isMoreChild =
                tab.key === 'more' &&
                ['more', 'khata', 'purchases', 'suppliers', 'reports', 'expenses', 'settings'].includes(
                  activeNav
                );
              const isActive = activeNav === tab.key || isMoreChild;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => {
                    if (tab.key !== 'market') setFocusMarketProductId(null);
                    setActiveNav(tab.key);
                  }}
                  className={`h-full flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors ${
                    isActive
                      ? 'text-indigo-600 dark:text-indigo-400 font-semibold'
                      : 'text-[var(--text-muted)]'
                  }`}
                >
                  {tab.icon}
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        )}

        {/* Cross-Device Pairing Handshake Modal */}
        {activeShop && (
          <DevicePairingModal
            isOpen={devicePairingModalOpen}
            onClose={() => setDevicePairingModalOpen(false)}
            shop={activeShop}
            isMobileDevice={isMobile}
            onPairedChange={(info) => setPairedDevice(info)}
            onOpenMobileScanner={() => setMobileScannerOpen(true)}
          />
        )}

        {/* Mobile Laser Barcode Camera Scanner Terminal Sheet */}
        {activeShop && (
          <MobileBarcodeScannerSheet
            isOpen={mobileScannerOpen}
            onClose={() => setMobileScannerOpen(false)}
            shopName={activeShop.name}
            pairingToken={getSavedPairingPayload()?.token}
            existingShopProducts={products}
          />
        )}
      </div>
  );
}
