import React, { useEffect, useMemo, useState } from 'react';
import {
  EmptyStateCard,
  FieldLabel,
  KpiCard,
  ResponsiveDialog,
  SelectInput,
  SurfaceCard,
  TextInput,
} from '../components/ui';
import { PriceHistorySparkChart } from '../components/Charts';
import { LiveCommodityCard } from '../components/LiveCommodityCard';
import { MarketAlertCard } from '../components/MarketAlertCard';
import { ProductWholesaleIntelligence } from '../components/ProductWholesaleIntelligence';
import { apiRequest } from '../lib/api';
import { formatINR } from '../lib/finance';
import {
  MASTER_CATEGORY_FILTERS,
  buildMasterCatalogMatrix,
  filterMasterCatalogSKUs,
  formatRelativeSyncTime,
  syncMarketRates,
  type LiveAgriRateOverride,
  type MasterCategoryFilter,
  type MasterProductSKU,
  type SyncMarketRatesResponse,
} from '../lib/marketDataService';
import { analyzeProductPricing } from '../lib/pricing';
import {
  buildProductWholesaleSummaries,
  calculateQuotationLandedCost,
  filterProductWholesaleSummaries,
} from '../lib/wholesale';
import type {
  MarketPrice,
  MarketSyncRun,
  PriceAlert,
  PriceSource,
  Product,
  ProductWholesaleSummary,
  RateExplorerFilter,
  Shop,
  Supplier,
  SupplierQuotation,
} from '../lib/types';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Calculator,
  CheckCircle2,
  ChevronRight,
  Clock,
  Database,
  Package,
  Plus,
  Radio,
  RefreshCw,
  Search,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';

interface MarketOverviewData {
  sources: PriceSource[];
  syncRuns?: MarketSyncRun[];
  marketPrices: MarketPrice[];
  quotations: SupplierQuotation[];
  alerts: PriceAlert[];
  acknowledgedAlerts?: PriceAlert[];
  productRates?: ProductWholesaleSummary[];
}

interface DailyAlertsStateProp {
  activeAlerts: PriceAlert[];
  acknowledgedAlerts: PriceAlert[];
  acknowledgingId: string | null;
  acknowledgeAlert: (alertId: string) => Promise<void>;
  restoreAlert: (alertId: string) => Promise<void>;
}

interface MarketIntelligencePageProps {
  shop: Shop;
  products: Product[];
  suppliers: Supplier[];
  marketData: MarketOverviewData | null;
  isMobile: boolean;
  initialDetailProductId?: string | null;
  initialFocusSkuCode?: string | null;
  initialTab?: 'live' | 'alerts' | null;
  dailyAlertsState?: DailyAlertsStateProp;
  onClearInitialDetail?: () => void;
  onClearInitialFocusSku?: () => void;
  onClearInitialTab?: () => void;
  onLiveAgriOverridesChange?: (overrides: Record<string, LiveAgriRateOverride>) => void;
  onRefreshAll: () => Promise<void>;
}

const EXPLORER_FILTERS: RateExplorerFilter[] = [
  'All products',
  'Packaged FMCG',
  'Grocery',
  'Vegetables',
  'Fruits',
  'Grains',
  'Pulses',
  'Household',
  'Personal Care',
  'Beverages',
  'Available rates',
  'Missing rates',
  'Increasing prices',
  'Decreasing prices',
];

function formatShortTimestamp(val: string | null | undefined): string {
  if (!val) return 'Never';
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? val : d.toLocaleString();
}

export const MarketIntelligencePage: React.FC<MarketIntelligencePageProps> = ({
  shop,
  products,
  suppliers,
  marketData,
  isMobile,
  initialDetailProductId,
  initialFocusSkuCode,
  initialTab,
  dailyAlertsState,
  onClearInitialDetail,
  onClearInitialFocusSku,
  onClearInitialTab,
  onLiveAgriOverridesChange,
  onRefreshAll,
}) => {
  const [activeTab, setActiveTab] = useState<'live' | 'explorer' | 'calculator' | 'alerts' | 'sources'>(
    initialDetailProductId
      ? 'explorer'
      : initialTab === 'alerts'
        ? 'alerts'
        : 'live'
  );
  const [detailProductId, setDetailProductId] = useState<string | null>(
    initialDetailProductId || null
  );
  const [alertFilter, setAlertFilter] = useState<'all' | 'surges' | 'opportunities' | 'acknowledged'>('all');

  useEffect(() => {
    if (initialDetailProductId) {
      setActiveTab('explorer');
      setDetailProductId(initialDetailProductId);
    }
  }, [initialDetailProductId]);

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
      onClearInitialTab?.();
    }
  }, [initialTab, onClearInitialTab]);

  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<RateExplorerFilter>('All products');

  // Live Enterprise Sync & Master Product Price Matrix
  const [liveFeed, setLiveFeed] = useState<SyncMarketRatesResponse | null>(null);
  const [liveLoading, setLiveLoading] = useState<boolean>(true);
  const [liveSyncing, setLiveSyncing] = useState<boolean>(false);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState<boolean>(true);
  const [liveSearch, setLiveSearch] = useState<string>(initialFocusSkuCode || '');
  const [liveFilterPill, setLiveFilterPill] = useState<MasterCategoryFilter>('All SKUs');
  const [visibleSkuCount, setVisibleSkuCount] = useState<number>(36);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [currentDayIso, setCurrentDayIso] = useState<string>(() => new Date().toISOString().slice(0, 10));

  useEffect(() => {
    if (initialFocusSkuCode) {
      setActiveTab('live');
      setLiveFilterPill('All SKUs');
      setLiveSearch(initialFocusSkuCode);
      onClearInitialFocusSku?.();
    }
  }, [initialFocusSkuCode, onClearInitialFocusSku]);

  const [selectedProductId, setSelectedProductId] = useState<string>(products[0]?.id || '');
  const [targetMarginPct, setTargetMarginPct] = useState<string>(String(shop.defaultMarginPct || 15));
  const [customReplacementOverride, setCustomReplacementOverride] = useState<string>('');
  const [applyingPrice, setApplyingPrice] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Sync AGMARKNET state
  const [syncing, setSyncing] = useState(false);
  const [syncCommodity, setSyncCommodity] = useState('');
  const [syncResultMsg, setSyncResultMsg] = useState<string | null>(null);
  const [syncResultOk, setSyncResultOk] = useState<boolean | null>(null);

  // Log Supplier Quotation Modal (full landed cost fields)
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [qProductId, setQProductId] = useState(products[0]?.id || '');
  const [qSupplierId, setQSupplierId] = useState(suppliers[0]?.id || '');
  const [qQuantity, setQQuantity] = useState('1');
  const [qUnit, setQUnit] = useState('');
  const [qRate, setQRate] = useState('');
  const [qDiscount, setQDiscount] = useState('0');
  const [qTax, setQTax] = useState('0');
  const [qFreight, setQFreight] = useState('0');
  const [qAdditional, setQAdditional] = useState('0');
  const [qDate, setQDate] = useState(new Date().toISOString().slice(0, 10));
  const [qValidUntil, setQValidUntil] = useState('');
  const [qSourceEvidence, setQSourceEvidence] = useState('');
  const [qVerification, setQVerification] = useState<'verified_quotation' | 'price_list' | 'verbal_quote'>('verified_quotation');
  const [qNotes, setQNotes] = useState('');
  const [qSaving, setQSaving] = useState(false);
  const [qError, setQError] = useState<string | null>(null);

  // Log Market Observation Modal
  const [obsOpen, setObsOpen] = useState(false);
  const [obsProductId, setObsProductId] = useState('');
  const [obsName, setObsName] = useState('');
  const [obsMarket, setObsMarket] = useState('');
  const [obsLocation, setObsLocation] = useState(`${shop.city}, ${shop.state}`);
  const [obsUnit, setObsUnit] = useState('Kilogram');
  const [obsPrice, setObsPrice] = useState('');
  const [obsDate, setObsDate] = useState(new Date().toISOString().slice(0, 10));
  const [obsSaving, setObsSaving] = useState(false);

  const sources = marketData?.sources || [];
  const syncRuns = marketData?.syncRuns || [];
  const marketPrices = marketData?.marketPrices || [];
  const quotations = marketData?.quotations || [];
  const alerts = dailyAlertsState?.activeAlerts ?? marketData?.alerts ?? [];
  const acknowledgedAlerts = dailyAlertsState?.acknowledgedAlerts ?? marketData?.acknowledgedAlerts ?? [];

  // Build product summaries directly if server response is momentarily loading
  const productSummaries = useMemo(() => {
    if (marketData?.productRates && marketData.productRates.length === products.length) {
      return marketData.productRates;
    }
    return buildProductWholesaleSummaries({
      products,
      quotations,
      marketPrices,
      historicalPurchasesByProduct: new Map(),
    });
  }, [marketData?.productRates, products, quotations, marketPrices]);

  const filteredSummaries = useMemo(
    () => filterProductWholesaleSummaries(productSummaries, search, activeFilter),
    [productSummaries, search, activeFilter]
  );

  const explorerMetrics = useMemo(() => {
    const total = productSummaries.length;
    const withRates = productSummaries.filter((s) => s.latestWholesaleRate !== null).length;
    const missing = total - withRates;
    const increasing = productSummaries.filter(
      (s) => s.priceDifference !== null && s.priceDifference > 0
    ).length;
    const decreasing = productSummaries.filter(
      (s) => s.priceDifference !== null && s.priceDifference < 0
    ).length;
    return { total, withRates, missing, increasing, decreasing };
  }, [productSummaries]);

  // Fetch Live Enterprise Sync metadata & live agricultural rate overrides on mount / shop change
  useEffect(() => {
    let cancelled = false;
    setLiveLoading(true);
    apiRequest<SyncMarketRatesResponse>(`/api/shops/${shop.id}/market/live-feed`)
      .then((res) => {
        if (!cancelled) {
          setLiveFeed(res);
          setNowMs(Date.now());
          onLiveAgriOverridesChange?.(res.liveAgriOverrides || {});
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setActionError(err instanceof Error ? err.message : 'Unable to load Master Price Matrix');
        }
      })
      .finally(() => {
        if (!cancelled) setLiveLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [shop.id, onLiveAgriOverridesChange]);

  // Reset visible window when search or category filter changes
  useEffect(() => {
    setVisibleSkuCount(36);
  }, [liveSearch, liveFilterPill]);

  // Auto-sync live feed every 60s when enabled & keep relative timestamp ticking
  useEffect(() => {
    const tickId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 15000);
    return () => window.clearInterval(tickId);
  }, []);

  // 24-hour daily refresh cycle: watch calendar day rollover & refresh live rates + logs
  useEffect(() => {
    if (!autoSyncEnabled) return;
    const pollId = window.setInterval(() => {
      const nextDayIso = new Date().toISOString().slice(0, 10);
      if (nextDayIso !== currentDayIso) {
        setCurrentDayIso(nextDayIso);
        syncMarketRates({ shopId: shop.id, state: shop.state })
          .then((res) => {
            setLiveFeed(res);
            setNowMs(Date.now());
            onLiveAgriOverridesChange?.(res.liveAgriOverrides || {});
            return onRefreshAll();
          })
          .catch(() => {
            // Silent background retry on next cycle
          });
        return;
      }

      apiRequest<SyncMarketRatesResponse>(`/api/shops/${shop.id}/market/live-feed`)
        .then((res) => {
          setLiveFeed(res);
          setNowMs(Date.now());
          onLiveAgriOverridesChange?.(res.liveAgriOverrides || {});
        })
        .catch(() => {
          // Silent background poll retry on next tick
        });
    }, 60000);
    return () => window.clearInterval(pollId);
  }, [shop.id, shop.state, autoSyncEnabled, currentDayIso, onRefreshAll, onLiveAgriOverridesChange]);

  const handleSyncLiveFeed = async () => {
    setLiveSyncing(true);
    setActionError(null);
    try {
      const res = await syncMarketRates({
        shopId: shop.id,
        state: shop.state,
      });
      setLiveFeed(res);
      setNowMs(Date.now());
      onLiveAgriOverridesChange?.(res.liveAgriOverrides || {});
      await onRefreshAll();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to sync enterprise rates');
      await onRefreshAll().catch(() => {});
    } finally {
      setLiveSyncing(false);
    }
  };

  const masterCatalogItems = useMemo(
    () =>
      buildMasterCatalogMatrix(
        liveFeed?.dataDate || currentDayIso,
        liveFeed?.liveAgriOverrides || {}
      ),
    [liveFeed?.dataDate, liveFeed?.liveAgriOverrides, currentDayIso]
  );

  const filteredMasterItems = useMemo(
    () => filterMasterCatalogSKUs(masterCatalogItems, liveSearch, liveFilterPill),
    [masterCatalogItems, liveSearch, liveFilterPill]
  );

  const visibleMasterItems = useMemo(
    () => filteredMasterItems.slice(0, visibleSkuCount),
    [filteredMasterItems, visibleSkuCount]
  );

  const livePillCounts = useMemo(() => {
    const counts: Record<MasterCategoryFilter, number> = {
      'All SKUs': masterCatalogItems.length,
      'Packaged FMCG': 0,
      'Staple Grains': 0,
      Pulses: 0,
      'Edible Oils': 0,
      Spices: 0,
      Beverages: 0,
      'Personal Care': 0,
      'Household Cleaning': 0,
      'Loose Items': 0,
    };
    for (const item of masterCatalogItems) {
      if (counts[item.category] !== undefined) {
        counts[item.category] += 1;
      }
    }
    return counts;
  }, [masterCatalogItems]);

  const findMatchedProductForSku = useMemo(() => {
    return (sku: MasterProductSKU): Product | null => {
      const sName = sku.name.toLowerCase();
      const sBrand = sku.brand.toLowerCase();

      for (const p of products) {
        const pCode = (p.sku || '').trim().toLowerCase();
        if (pCode && pCode === sku.skuCode.toLowerCase()) return p;

        const mc = (p.marketCommodityName || '').trim().toLowerCase();
        if (mc && sName.includes(mc)) return p;

        const pName = p.name.toLowerCase();
        const pBrand = (p.brand || '').trim().toLowerCase();
        const nameTokens = sName
          .replace(/[^a-z0-9\s]/g, ' ')
          .split(/\s+/)
          .filter((t) => t.length >= 4 && !['pack', 'bulk', 'wholesale', 'pure', 'classic'].includes(t));

        const tokenHits = nameTokens.filter((tok) => {
          const escaped = tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          return new RegExp(`\\b${escaped}\\b`, 'i').test(pName);
        }).length;

        if (tokenHits >= 2 || (tokenHits >= 1 && pBrand && sBrand.includes(pBrand))) {
          return p;
        }
      }
      return null;
    };
  }, [products]);

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === selectedProductId) || products[0] || null,
    [products, selectedProductId]
  );

  const selectedSummary = useMemo(
    () =>
      selectedProduct
        ? productSummaries.find((s) => s.productId === selectedProduct.id) || null
        : null,
    [productSummaries, selectedProduct]
  );

  const pricingAnalysis = useMemo(() => {
    if (!selectedProduct) return null;
    const derivedReplacement =
      customReplacementOverride !== '' && Number.isFinite(Number(customReplacementOverride))
        ? Number(customReplacementOverride)
        : selectedSummary?.latestWholesaleRate ?? selectedProduct.landedCost;

    return analyzeProductPricing({
      historicalLandedCost:
        selectedSummary?.historicalPurchaseRate ??
        selectedProduct.landedCost ??
        selectedProduct.purchasePrice,
      replacementLandedCost: derivedReplacement,
      currentSellingPrice: selectedProduct.sellingPrice,
      mrp: selectedProduct.mrp,
      mrpRestricted: selectedProduct.mrpRestricted,
      targetMarginPct: Number(targetMarginPct) || 0,
    });
  }, [selectedProduct, selectedSummary, customReplacementOverride, targetMarginPct]);

  const priceHistoryPoints = useMemo(() => {
    if (!selectedProduct) return [];
    const quotePts = quotations
      .filter((q) => q.productId === selectedProduct.id)
      .map((q) => ({
        date: q.quotationDate,
        price: q.finalLandedCost || q.landedEstimate,
        label: `${q.isExpired ? 'Expired ' : ''}${q.supplierName || 'Supplier Quote'}`,
      }));
    const marketPts = marketPrices
      .filter((m) => m.productId === selectedProduct.id && m.normalizedPerBaseUnit !== null)
      .map((m) => ({
        date: m.observationDate,
        price: m.normalizedPerBaseUnit!,
        label: m.marketName,
      }));
    return [...quotePts, ...marketPts].sort((a, b) => a.date.localeCompare(b.date));
  }, [selectedProduct, quotations, marketPrices]);

  const qProduct = useMemo(
    () => products.find((p) => p.id === qProductId) || null,
    [products, qProductId]
  );

  const qAllowedUnits = useMemo(() => {
    if (!qProduct) return ['Kilogram'];
    const set = new Set<string>([qProduct.baseUnit]);
    for (const u of qProduct.units) set.add(u.unitName);
    if (qProduct.baseUnit === 'Kilogram') set.add('Gram');
    if (qProduct.baseUnit === 'Gram') set.add('Kilogram');
    if (qProduct.baseUnit === 'Litre') set.add('Millilitre');
    if (qProduct.baseUnit === 'Millilitre') set.add('Litre');
    return Array.from(set);
  }, [qProduct]);

  const qLiveCostPreview = useMemo(() => {
    if (!qProduct || !Number.isFinite(Number(qRate)) || Number(qRate) <= 0) return null;
    try {
      return calculateQuotationLandedCost({
        quantity: Number(qQuantity) || 1,
        unitName: qUnit || qProduct.baseUnit,
        baseUnit: qProduct.baseUnit,
        productUnits: qProduct.units,
        wholesaleRatePerUnit: Number(qRate),
        discountAmount: Number(qDiscount) || 0,
        taxAmount: Number(qTax) || 0,
        transportFreight: Number(qFreight) || 0,
        additionalCosts: Number(qAdditional) || 0,
      });
    } catch {
      return null;
    }
  }, [qProduct, qQuantity, qUnit, qRate, qDiscount, qTax, qFreight, qAdditional]);

  const openQuoteModalForProduct = (productId?: string) => {
    const target =
      (productId && products.find((p) => p.id === productId)) ||
      selectedProduct ||
      products[0] ||
      null;
    setQProductId(target?.id || '');
    setQSupplierId(suppliers[0]?.id || '');
    setQQuantity('1');
    setQUnit(target?.baseUnit || 'Kilogram');
    setQRate('');
    setQDiscount('0');
    setQTax('0');
    setQFreight('0');
    setQAdditional('0');
    setQValidUntil('');
    setQSourceEvidence('');
    setQNotes('');
    setQError(null);
    setQuoteOpen(true);
  };

  const openObsModalForProduct = (productId?: string) => {
    const target =
      (productId && products.find((p) => p.id === productId)) ||
      selectedProduct ||
      null;
    setObsProductId(target?.id || '');
    setObsName(target?.name || '');
    setObsUnit(target?.baseUnit || 'Kilogram');
    setObsPrice('');
    setObsOpen(true);
  };

  const handleSyncAgmarknet = async () => {
    setSyncing(true);
    setSyncResultMsg(null);
    setSyncResultOk(null);
    try {
      const res = await apiRequest<{
        ok: boolean;
        configured: boolean;
        recordsFetched: number;
        insertedCount: number;
        recordsMatched: number;
        message: string;
      }>(`/api/shops/${shop.id}/market/sync-agmarknet`, {
        method: 'POST',
        body: JSON.stringify({
          commodity: syncCommodity || undefined,
          state: shop.state,
          limit: 100,
        }),
      });
      setSyncResultOk(res.ok);
      setSyncResultMsg(res.message);
      await onRefreshAll();
    } catch (err) {
      setSyncResultOk(false);
      setSyncResultMsg(err instanceof Error ? err.message : 'Sync failed');
      await onRefreshAll();
    } finally {
      setSyncing(false);
    }
  };

  const handleCreateQuotation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!qProduct) return;
    setQSaving(true);
    setQError(null);
    setActionError(null);
    try {
      await apiRequest(`/api/shops/${shop.id}/market/quotations`, {
        method: 'POST',
        body: JSON.stringify({
          productId: qProduct.id,
          supplierId: qSupplierId,
          brand: qProduct.brand,
          packSize: qProduct.packSize,
          quantity: Number(qQuantity) || 1,
          unit: qUnit || qProduct.baseUnit,
          quotedRate: Number(qRate),
          discountAmount: Number(qDiscount) || 0,
          taxAmount: Number(qTax) || 0,
          freightEstimatePerUnit: Number(qFreight) || 0,
          additionalCosts: Number(qAdditional) || 0,
          quotationDate: qDate,
          validUntil: qValidUntil || null,
          sourceEvidence: qSourceEvidence || null,
          verificationStatus: qVerification,
          notes: qNotes || null,
        }),
      });
      setQuoteOpen(false);
      setActionMsg(
        `Saved quotation for ${qProduct.name}${qLiveCostPreview ? ` · Final landed ${formatINR(qLiveCostPreview.landedCostPerBaseUnit)}/${qProduct.baseUnit}` : ''}.`
      );
      await onRefreshAll();
    } catch (err) {
      setQError(err instanceof Error ? err.message : 'Unable to save quotation');
    } finally {
      setQSaving(false);
    }
  };

  const handleCreateObservation = async (e: React.FormEvent) => {
    e.preventDefault();
    setObsSaving(true);
    setActionError(null);
    const linked = products.find((p) => p.id === obsProductId) || null;
    try {
      await apiRequest(`/api/shops/${shop.id}/market/observations`, {
        method: 'POST',
        body: JSON.stringify({
          productId: obsProductId || null,
          commodityOrProductName: obsName,
          brand: linked?.brand || null,
          packSize: linked?.packSize || null,
          marketName: obsMarket,
          location: obsLocation,
          unit: obsUnit,
          modalPrice: Number(obsPrice),
          observationDate: obsDate,
        }),
      });
      setObsOpen(false);
      setObsName('');
      setObsPrice('');
      setActionMsg('Market price observation saved.');
      await onRefreshAll();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to save observation');
    } finally {
      setObsSaving(false);
    }
  };

  const handleApprovePrice = async (recommendedPrice: number, strategyLabel: string) => {
    if (!selectedProduct || !pricingAnalysis) return;
    setApplyingPrice(true);
    setActionError(null);
    setActionMsg(null);
    try {
      await apiRequest(`/api/shops/${shop.id}/market/apply-price`, {
        method: 'POST',
        body: JSON.stringify({
          productId: selectedProduct.id,
          newSellingPrice: recommendedPrice,
          targetMarginPct: Number(targetMarginPct) || 15,
          strategy: strategyLabel,
          replacementLandedCost: pricingAnalysis.replacementLandedCost,
          alertReason: `Owner approved ${strategyLabel} scenario from Market Intelligence`,
        }),
      });
      setActionMsg(
        `Updated ${selectedProduct.name} selling price to ${formatINR(recommendedPrice)} with audit record.`
      );
      await onRefreshAll();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to update selling price');
    } finally {
      setApplyingPrice(false);
    }
  };

  const agmarknetSource = sources.find((s) => s.sourceKey === 'agmarknet_ogd');

  return (
    <div className="space-y-5 bhaviq-page-enter">
      {/* Header & Primary Market Actions */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 rounded-xl bg-[var(--bg-subtle)] overflow-x-auto no-scrollbar">
          {(
            [
              { id: 'live', label: 'Master Price Matrix' },
              { id: 'explorer', label: 'Rate Explorer' },
              { id: 'calculator', label: 'Price Calculator' },
              { id: 'alerts', label: `Alerts (${alerts.length})` },
              { id: 'sources', label: 'Daily Sync & Sources' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveTab(tab.id);
                if (tab.id !== 'explorer') {
                  setDetailProductId(null);
                  onClearInitialDetail?.();
                }
              }}
              className={`px-3.5 py-2 text-xs font-semibold rounded-lg min-h-[38px] whitespace-nowrap transition-colors ${
                activeTab === tab.id
                  ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {!(activeTab === 'explorer' && detailProductId) && (
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={products.length === 0 || suppliers.length === 0}
              onClick={() => openQuoteModalForProduct(detailProductId || undefined)}
              className="bhaviq-btn-primary px-4 py-2 min-h-[40px] rounded-xl disabled:opacity-50 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>Log supplier quote</span>
            </button>
            <button
              type="button"
              onClick={() => openObsModalForProduct(detailProductId || undefined)}
              className="px-4 py-2 min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-[var(--bg-surface)] hover:bg-[var(--bg-subtle)] text-xs font-semibold text-[var(--text-primary)] shadow-xs whitespace-nowrap transition-colors"
            >
              Log market observation
            </button>
          </div>
        )}
      </div>

      {actionMsg && (
        <div className="px-4 py-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs font-medium text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{actionMsg}</span>
        </div>
      )}
      {actionError && (
        <div className="px-4 py-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs font-medium text-rose-700 dark:text-rose-300">
          {actionError}
        </div>
      )}

      {/* TAB 0: ENTERPRISE FMCG & KIRANA MASTER PRODUCT PRICE MATRIX */}
      {activeTab === 'live' && (
        <div className="space-y-5">
          {/* Live Enterprise Sync Header Card */}
          <SurfaceCard className="relative overflow-hidden p-5 sm:p-6 space-y-4">
            <div
              aria-hidden="true"
              className={`absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r ${
                liveFeed?.sourceMode === 'live_api'
                  ? 'from-emerald-500 via-teal-400 to-indigo-500'
                  : 'from-indigo-500 via-blue-500 to-emerald-500'
              }`}
            />

            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="space-y-1.5 min-w-0">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-[var(--text-secondary)]">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700 dark:text-emerald-400">
                    <Radio className="w-3.5 h-3.5" />
                    <span>Live Enterprise Sync</span>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1 font-medium">
                    <Clock className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                    <span>Last updated: {formatRelativeSyncTime(liveFeed?.lastSyncedAt, nowMs)}</span>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono-num tabular-nums font-semibold text-[var(--text-primary)]">
                    {masterCatalogItems.length.toLocaleString('en-IN')} Active SKUs
                  </span>
                  <span aria-hidden="true">·</span>
                  <button
                    type="button"
                    onClick={() => setActiveTab('sources')}
                    className="font-medium text-blue-600 dark:text-indigo-400 hover:underline whitespace-nowrap"
                  >
                    {syncRuns.length > 0
                      ? `Sync logs (${syncRuns.length} · ${syncRuns[0].status.replace('_', ' ')})`
                      : 'View 24h sync logs'}
                  </button>
                </div>

                <h2 className="font-display text-lg sm:text-xl font-bold tracking-tight text-[var(--text-primary)]">
                  FMCG &amp; Kirana Master Product Price Matrix
                </h2>
                <p className="text-xs text-[var(--text-secondary)] max-w-2xl">
                  {liveFeed?.rateLimited
                    ? `Rate limit reached on upstream feed (retry after ${liveFeed.retryAfterSeconds ?? 60}s) — serving cached enterprise distributor benchmarks across packaged FMCG, staples, oils, spices, beverages, and home care.`
                    : liveFeed?.sourceMode === 'live_api'
                      ? `Live normalized agricultural & distributor wholesale benchmarks synced (${liveFeed.recordsStored} rate rows persisted to shop ledger) across ${masterCatalogItems.length.toLocaleString('en-IN')} packaged and staple SKUs.`
                      : `Standardized wholesale purchase benchmarks, suggested MRPs, and daily 24h market variance across ${masterCatalogItems.length.toLocaleString('en-IN')} packaged FMCG and staple Kirana SKUs.`}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setAutoSyncEnabled((prev) => !prev)}
                  aria-pressed={autoSyncEnabled}
                  className={`px-3.5 py-2 min-h-[40px] rounded-xl border text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                    autoSyncEnabled
                      ? 'bg-emerald-50/70 dark:bg-emerald-500/15 border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                      : 'bg-[var(--bg-surface)] border-slate-200 dark:border-slate-700 text-[var(--text-secondary)]'
                  }`}
                >
                  <Radio className="w-3.5 h-3.5" />
                  <span>Auto-sync (60s / 24h)</span>
                </button>

                <button
                  type="button"
                  onClick={handleSyncLiveFeed}
                  disabled={liveSyncing}
                  className="bhaviq-btn-primary px-4 py-2 min-h-[40px] rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <RefreshCw className={`w-4 h-4 ${liveSyncing ? 'animate-spin' : ''}`} />
                  <span>{liveSyncing ? 'Syncing...' : 'Sync Now'}</span>
                </button>
              </div>
            </div>
          </SurfaceCard>

          {/* Search & Master Category Filter Pills */}
          <div className="space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 text-[var(--text-muted)] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <TextInput
                aria-label="Search master SKU price matrix"
                value={liveSearch}
                onChange={(e) => setLiveSearch(e.target.value)}
                placeholder={`Search ${masterCatalogItems.length.toLocaleString('en-IN')} SKUs by SKU code, brand (Britannia, Parle, ITC, HUL, Nestlé), item, or pack size...`}
                className="pl-10"
              />
            </div>

            <div
              role="tablist"
              aria-label="Master catalog category filters"
              className="flex items-center gap-1.5 overflow-x-auto md:flex-wrap no-scrollbar pb-1"
            >
              {MASTER_CATEGORY_FILTERS.map((pill) => {
                const active = liveFilterPill === pill;
                const count = livePillCounts[pill] ?? 0;
                return (
                  <button
                    key={pill}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setLiveFilterPill(pill)}
                    className={`px-3.5 py-1.5 min-h-[34px] rounded-full text-xs font-semibold whitespace-nowrap border inline-flex items-center gap-1.5 transition-all duration-150 ${
                      active
                        ? 'bhaviq-nav-active border-transparent'
                        : 'bg-[var(--bg-surface)] border-slate-200 dark:border-slate-700 text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    <span>{pill}</span>
                    <span
                      className={`font-mono-num tabular-nums text-[11px] ${
                        active ? 'text-white/80' : 'text-[var(--text-muted)]'
                      }`}
                    >
                      {count.toLocaleString('en-IN')}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center justify-between text-xs text-[var(--text-muted)] px-0.5">
              <span className="font-mono-num tabular-nums">
                Showing {visibleMasterItems.length.toLocaleString('en-IN')} of{' '}
                {filteredMasterItems.length.toLocaleString('en-IN')} matching SKUs
              </span>
              {(liveSearch.trim() !== '' || liveFilterPill !== 'All SKUs') && (
                <button
                  type="button"
                  onClick={() => {
                    setLiveSearch('');
                    setLiveFilterPill('All SKUs');
                  }}
                  className="font-semibold text-indigo-600 dark:text-indigo-400 hover:underline whitespace-nowrap"
                >
                  Clear filters
                </button>
              )}
            </div>
          </div>

          {/* 3D Floating Master Product Grid */}
          {liveLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
              {Array.from({ length: 6 }).map((_, idx) => (
                <div
                  key={idx}
                  className="h-52 rounded-2xl bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 shadow-xl shadow-slate-200/50 dark:shadow-black/40 p-5 animate-pulse space-y-4"
                >
                  <div className="h-3.5 w-28 rounded bg-slate-200 dark:bg-slate-700" />
                  <div className="h-5 w-52 rounded bg-slate-200 dark:bg-slate-700" />
                  <div className="h-10 w-36 rounded bg-slate-200 dark:bg-slate-700" />
                </div>
              ))}
            </div>
          ) : filteredMasterItems.length === 0 ? (
            <EmptyStateCard
              icon={<Search className="w-6 h-6" />}
              title="No matching catalog SKUs"
              description="Try adjusting your brand, SKU code, pack size search, or switch back to All SKUs."
              actionLabel="Show all SKUs"
              onAction={() => {
                setLiveSearch('');
                setLiveFilterPill('All SKUs');
              }}
            />
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                {visibleMasterItems.map((item) => {
                  const matched = findMatchedProductForSku(item);
                  return (
                    <LiveCommodityCard
                      key={item.id}
                      item={item}
                      matchedProductId={matched?.id || null}
                      matchedProductName={matched?.name || null}
                      liveSyncTimestamp={formatRelativeSyncTime(liveFeed?.lastSyncedAt, nowMs)}
                      onInspectMatchedProduct={(pid) => {
                        setActiveTab('explorer');
                        setDetailProductId(pid);
                      }}
                    />
                  );
                })}
              </div>

              {visibleMasterItems.length < filteredMasterItems.length && (
                <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setVisibleSkuCount((prev) => prev + 48)}
                    className="px-5 py-2.5 min-h-[42px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-semibold text-[var(--text-primary)] shadow-md shadow-slate-200/40 dark:shadow-black/30 whitespace-nowrap transition-colors"
                  >
                    Load 48 more SKUs ({(filteredMasterItems.length - visibleMasterItems.length).toLocaleString('en-IN')} remaining)
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* TAB 1: PRODUCT-WISE RATE EXPLORER & PER-PRODUCT WHOLESALE VIEW */}
      {activeTab === 'explorer' && (
        detailProductId ? (
          <ProductWholesaleIntelligence
            shop={shop}
            productId={detailProductId}
            initialSummary={
              productSummaries.find((s) => s.productId === detailProductId) || null
            }
            canAddQuote={products.length > 0 && suppliers.length > 0}
            backLabel="Back to Rate Explorer"
            onBack={() => {
              setDetailProductId(null);
              onClearInitialDetail?.();
            }}
            onOpenQuoteModal={(pid) => openQuoteModalForProduct(pid)}
            onOpenObsModal={(pid) => openObsModalForProduct(pid)}
            onRefreshAll={onRefreshAll}
          />
        ) : (
          <div className="space-y-5">
            {/* Elevated 3D Summary KPI Strip */}
            {products.length > 0 && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <KpiCard
                  label="Registered Products"
                  value={String(explorerMetrics.total)}
                  icon={<Package className="w-4 h-4" />}
                  accentTop="indigo"
                  subtext="Every catalog SKU tracked"
                />
                <KpiCard
                  label="Available Wholesale Rates"
                  value={String(explorerMetrics.withRates)}
                  icon={<ShieldCheck className="w-4 h-4" />}
                  accentTop="emerald"
                  tone="positive"
                  subtext="Verified active quotes or mandi matches"
                />
                <KpiCard
                  label="Missing Rate Coverage"
                  value={String(explorerMetrics.missing)}
                  icon={<AlertTriangle className="w-4 h-4" />}
                  accentTop={explorerMetrics.missing > 0 ? 'amber' : 'emerald'}
                  tone={explorerMetrics.missing > 0 ? 'warning' : 'neutral'}
                  subtext="No valid current rate yet"
                />
                <SurfaceCard className="relative overflow-hidden p-5 flex flex-col justify-between gap-2.5">
                  <div
                    aria-hidden="true"
                    className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-indigo-500 via-blue-500 to-emerald-500"
                  />
                  <div className="flex items-center justify-between gap-2 pt-0.5">
                    <span className="text-xs font-semibold text-[var(--text-muted)] tracking-tight">
                      Rate Movement
                    </span>
                    <span className="w-8 h-8 rounded-xl bg-indigo-50 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                      <TrendingUp className="w-4 h-4" />
                    </span>
                  </div>
                  <span className="font-mono-num text-sm md:text-base font-bold text-[var(--text-primary)] flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-rose-600 dark:text-rose-400 whitespace-nowrap">
                      ↑ {explorerMetrics.increasing} rising
                    </span>
                    <span className="text-[var(--text-muted)]">·</span>
                    <span className="text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                      ↓ {explorerMetrics.decreasing} falling
                    </span>
                  </span>
                  <span className="text-xs text-[var(--text-secondary)]">
                    Compared against previous wholesale rate
                  </span>
                </SurfaceCard>
              </div>
            )}

            {/* Search & 14 Explorer Filters */}
            <div className="space-y-3">
              <div className="relative">
                <Search className="w-4 h-4 text-[var(--text-muted)] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <TextInput
                  aria-label="Search product rates"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search product, brand, category, pack size, or supplier..."
                  className="pl-10"
                />
              </div>

              <div
                role="tablist"
                aria-label="Rate explorer filters"
                className="flex items-center gap-1.5 overflow-x-auto md:flex-wrap no-scrollbar pb-1"
              >
                {EXPLORER_FILTERS.map((flt) => {
                  const active = activeFilter === flt;
                  return (
                    <button
                      key={flt}
                      type="button"
                      onClick={() => setActiveFilter(flt)}
                      className={`px-3 py-1.5 min-h-[34px] rounded-full text-xs font-semibold whitespace-nowrap border transition-all duration-150 ${
                        active
                          ? 'bhaviq-nav-active border-transparent'
                          : 'bg-[var(--bg-surface)] border-slate-200 dark:border-slate-700 text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      {flt}
                    </button>
                  );
                })}
              </div>
            </div>

            {products.length === 0 ? (
              <EmptyStateCard
                icon={<TrendingUp className="w-6 h-6" />}
                title="No registered products yet"
                description="Register products in Products & Inventory first. Every registered product will appear here with its wholesale rate history, supplier quotations, and landed-cost comparison."
              />
            ) : filteredSummaries.length === 0 ? (
              <EmptyStateCard
                icon={<Search className="w-6 h-6" />}
                title="No matching products"
                description="Try clearing the search query or switching to All products."
                actionLabel="Show all products"
                onAction={() => {
                  setSearch('');
                  setActiveFilter('All products');
                }}
              />
            ) : isMobile ? (
              <div className="space-y-3">
                {filteredSummaries.map((row) => {
                  const deltaUp = row.priceDifference !== null && row.priceDifference > 0;
                  const deltaDown = row.priceDifference !== null && row.priceDifference < 0;
                  return (
                    <SurfaceCard
                      key={row.productId}
                      onClick={() => setDetailProductId(row.productId)}
                      className="p-4 space-y-2.5"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
                            {row.productName}
                          </p>
                          <p className="text-xs text-[var(--text-muted)]">
                            {[row.brand || 'Unbranded', row.packSize, row.baseUnit, row.category]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                        </div>
                        <ChevronRight className="w-4 h-4 text-[var(--text-muted)] shrink-0 mt-1" />
                      </div>

                      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[var(--border-hairline)] text-xs">
                        <div>
                          <span className="text-[var(--text-muted)] block">Latest Wholesale</span>
                          <span className="font-mono-num font-bold text-[var(--text-primary)]">
                            {row.latestWholesaleRate !== null
                              ? `${formatINR(row.latestWholesaleRate)}/${row.baseUnit}`
                              : 'Unavailable'}
                          </span>
                        </div>
                        <div>
                          <span className="text-[var(--text-muted)] block">Last Purchase</span>
                          <span className="font-mono-num font-semibold text-[var(--text-primary)]">
                            {row.historicalPurchaseRate !== null
                              ? `${formatINR(row.historicalPurchaseRate)}/${row.baseUnit}`
                              : 'Not recorded'}
                          </span>
                        </div>
                        <div>
                          <span className="text-[var(--text-muted)] block">Selling / Landed</span>
                          <span className="font-mono-num text-[var(--text-primary)]">
                            {formatINR(row.currentSellingPrice)} /{' '}
                            {row.currentLandedCost !== null ? formatINR(row.currentLandedCost) : '—'}
                          </span>
                        </div>
                        <div>
                          <span className="text-[var(--text-muted)] block">Price Change</span>
                          {row.priceDifference !== null ? (
                            <span
                              className={`font-mono-num font-semibold inline-flex items-center gap-0.5 ${
                                deltaUp
                                  ? 'text-red-700 dark:text-red-400'
                                  : deltaDown
                                    ? 'text-emerald-700 dark:text-emerald-400'
                                    : ''
                              }`}
                            >
                              {deltaUp && <ArrowUpRight className="w-3.5 h-3.5" />}
                              {deltaDown && <ArrowDownRight className="w-3.5 h-3.5" />}
                              {row.priceDifference > 0 ? '+' : ''}
                              {formatINR(row.priceDifference)}
                              {row.priceChangePct !== null
                                ? ` (${row.priceChangePct > 0 ? '+' : ''}${row.priceChangePct.toFixed(1)}%)`
                                : ''}
                            </span>
                          ) : (
                            <span className="font-mono-num text-[var(--text-muted)]">—</span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-[11px] pt-1 text-[var(--text-muted)]">
                        <span className="truncate">
                          {row.latestSupplierName || row.sourceLabel}
                        </span>
                        <span
                          className={`font-semibold shrink-0 ml-2 ${
                            row.coverageStatus === 'Verified current rate' ||
                            row.coverageStatus === 'Supplier quotation available'
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : row.coverageStatus === 'Historical rate only'
                                ? 'text-amber-700 dark:text-amber-400'
                                : 'text-[var(--text-secondary)]'
                          }`}
                        >
                          {row.coverageStatus}
                        </span>
                      </div>
                    </SurfaceCard>
                  );
                })}
              </div>
            ) : (
              <SurfaceCard className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-[var(--border-hairline)] text-[11px] text-[var(--text-muted)] uppercase tracking-wider">
                        <th className="py-3 px-3 font-semibold">Product</th>
                        <th className="py-3 px-3 font-semibold">Brand</th>
                        <th className="py-3 px-3 font-semibold text-right">Last Purchase Rate</th>
                        <th className="py-3 px-3 font-semibold text-right">Latest Wholesale Rate</th>
                        <th className="py-3 px-3 font-semibold">Supplier</th>
                        <th className="py-3 px-3 font-semibold text-right">Previous Rate</th>
                        <th className="py-3 px-3 font-semibold text-right">Price Change</th>
                        <th className="py-3 px-3 font-semibold text-right">Landed Cost</th>
                        <th className="py-3 px-3 font-semibold text-right">Selling Price</th>
                        <th className="py-3 px-3 font-semibold">Last Updated</th>
                        <th className="py-3 px-3 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border-hairline)] text-xs">
                      {filteredSummaries.map((row) => {
                        const deltaUp = row.priceDifference !== null && row.priceDifference > 0;
                        const deltaDown = row.priceDifference !== null && row.priceDifference < 0;
                        const belowReplacement =
                          row.latestWholesaleRate !== null &&
                          row.currentSellingPrice < row.latestWholesaleRate;

                        return (
                          <tr
                            key={row.productId}
                            onClick={() => setDetailProductId(row.productId)}
                            className="hover:bg-[var(--bg-subtle)]/60 cursor-pointer transition-colors"
                          >
                            <td className="py-3 px-3">
                              <p className="font-semibold text-[var(--text-primary)]">
                                {row.productName}
                              </p>
                              <p className="text-[11px] text-[var(--text-muted)]">
                                {[row.category, row.packSize, row.baseUnit].filter(Boolean).join(' · ')}
                              </p>
                            </td>
                            <td className="py-3 px-3 text-[var(--text-secondary)]">
                              {row.brand || 'Unbranded'}
                            </td>
                            <td className="py-3 px-3 font-mono-num text-right text-[var(--text-secondary)]">
                              {row.historicalPurchaseRate !== null
                                ? formatINR(row.historicalPurchaseRate)
                                : '—'}
                            </td>
                            <td className="py-3 px-3 font-mono-num text-right font-bold text-[var(--text-primary)]">
                              {row.latestWholesaleRate !== null
                                ? formatINR(row.latestWholesaleRate)
                                : 'Unavailable'}
                            </td>
                            <td className="py-3 px-3 text-[var(--text-secondary)] min-w-[150px] max-w-[220px]">
                              <span className="line-clamp-2">
                                {row.latestSupplierName || (row.latestMarketLabel ? row.latestMarketLabel : '—')}
                              </span>
                            </td>
                            <td className="py-3 px-3 font-mono-num text-right text-[var(--text-secondary)] whitespace-nowrap">
                              {row.previousWholesaleRate !== null
                                ? formatINR(row.previousWholesaleRate)
                                : '—'}
                            </td>
                            <td className="py-3 px-3 font-mono-num text-right whitespace-nowrap">
                              {row.priceDifference !== null ? (
                                <span
                                  className={`font-semibold inline-flex items-center justify-end gap-0.5 whitespace-nowrap ${
                                    deltaUp
                                      ? 'text-red-700 dark:text-red-400'
                                      : deltaDown
                                        ? 'text-emerald-700 dark:text-emerald-400'
                                        : 'text-[var(--text-secondary)]'
                                  }`}
                                >
                                  {deltaUp && <ArrowUpRight className="w-3.5 h-3.5 shrink-0" />}
                                  {deltaDown && <ArrowDownRight className="w-3.5 h-3.5 shrink-0" />}
                                  {row.priceDifference > 0 ? '+' : ''}
                                  {formatINR(row.priceDifference)}
                                  {row.priceChangePct !== null
                                    ? ` (${row.priceChangePct > 0 ? '+' : ''}${row.priceChangePct.toFixed(1)}%)`
                                    : ''}
                                </span>
                              ) : (
                                <span className="text-[var(--text-muted)]">—</span>
                              )}
                            </td>
                            <td className="py-3 px-3 font-mono-num text-right text-[var(--text-primary)]">
                              {row.currentLandedCost !== null
                                ? formatINR(row.currentLandedCost)
                                : '—'}
                            </td>
                            <td
                              className={`py-3 px-3 font-mono-num text-right font-semibold ${
                                belowReplacement
                                  ? 'text-red-700 dark:text-red-400'
                                  : 'text-[var(--text-primary)]'
                              }`}
                            >
                              {formatINR(row.currentSellingPrice)}
                              {belowReplacement && (
                                <span className="block text-[10px] font-normal">
                                  Below cost
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-3 font-mono-num text-[var(--text-muted)] whitespace-nowrap">
                              {row.lastUpdated || '—'}
                            </td>
                            <td className="py-3 px-3 whitespace-nowrap">
                              <span
                                className={`font-semibold ${
                                  row.coverageStatus === 'Verified current rate' ||
                                  row.coverageStatus === 'Supplier quotation available'
                                    ? 'text-emerald-700 dark:text-emerald-400'
                                    : row.coverageStatus === 'Manual observation'
                                      ? 'text-[var(--accent-primary)]'
                                      : row.coverageStatus === 'Historical rate only'
                                        ? 'text-amber-700 dark:text-amber-400'
                                        : 'text-[var(--text-muted)]'
                                }`}
                              >
                                {row.coverageStatus}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </SurfaceCard>
            )}
          </div>
        )
      )}

      {/* TAB 2: INTELLIGENT SELLING PRICE CALCULATOR */}
      {activeTab === 'calculator' && (
        products.length === 0 ? (
          <EmptyStateCard
            icon={<Calculator className="w-6 h-6" />}
            title="Add a product to run pricing economics"
            description="Compare historical landed cost against today's replacement cost and calculate MRP-safe selling prices."
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <SurfaceCard className="lg:col-span-5 p-5 space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-display text-base font-semibold">
                    Replacement-Cost Pricing Inputs
                  </h3>
                  <p className="text-xs text-[var(--text-secondary)]">
                    Formula: Suggested Price = Landed Cost / (1 - Target Margin %)
                  </p>
                </div>
                {selectedProduct && (
                  <button
                    type="button"
                    onClick={() => {
                      setDetailProductId(selectedProduct.id);
                      setActiveTab('explorer');
                    }}
                    className="text-xs font-semibold text-[var(--accent-primary)] hover:underline whitespace-nowrap"
                  >
                    Full wholesale view
                  </button>
                )}
              </div>

              <div>
                <FieldLabel htmlFor="calc-prod">Select product</FieldLabel>
                <SelectInput
                  id="calc-prod"
                  value={selectedProduct?.id || ''}
                  onChange={(e) => {
                    setSelectedProductId(e.target.value);
                    setCustomReplacementOverride('');
                  }}
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} {p.brand ? `(${p.brand})` : ''}{' '}
                      {p.packSize ? `· ${p.packSize}` : ''} · {p.baseUnit}
                    </option>
                  ))}
                </SelectInput>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <FieldLabel htmlFor="calc-margin">Target margin (%)</FieldLabel>
                  <TextInput
                    id="calc-margin"
                    type="number"
                    min="0"
                    max="95"
                    step="0.5"
                    value={targetMarginPct}
                    onChange={(e) => setTargetMarginPct(e.target.value)}
                  />
                </div>
                <div>
                  <FieldLabel htmlFor="calc-repl">Override replacement cost (₹)</FieldLabel>
                  <TextInput
                    id="calc-repl"
                    type="number"
                    min="0"
                    step="0.01"
                    value={customReplacementOverride}
                    onChange={(e) => setCustomReplacementOverride(e.target.value)}
                    placeholder={
                      pricingAnalysis?.replacementLandedCost !== null &&
                      pricingAnalysis?.replacementLandedCost !== undefined
                        ? pricingAnalysis.replacementLandedCost.toFixed(2)
                        : 'Auto from valid quote'
                    }
                  />
                </div>
              </div>

              {selectedProduct && pricingAnalysis && (
                <div className="pt-3 border-t border-[var(--border-hairline)] space-y-2.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-[var(--text-secondary)]">
                      1. Historical purchase landed cost
                    </span>
                    <span className="font-mono-num font-semibold">
                      {pricingAnalysis.historicalLandedCost !== null
                        ? formatINR(pricingAnalysis.historicalLandedCost)
                        : 'Not recorded'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--text-secondary)]">
                      2. Current replacement landed cost
                    </span>
                    <span className="font-mono-num font-semibold">
                      {pricingAnalysis.replacementLandedCost !== null
                        ? formatINR(pricingAnalysis.replacementLandedCost)
                        : 'No verified rate available'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--text-secondary)]">Current shelf selling price</span>
                    <span className="font-mono-num font-semibold">
                      {formatINR(pricingAnalysis.currentSellingPrice)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--text-secondary)]">MRP ceiling</span>
                    <span className="font-mono-num">
                      {pricingAnalysis.mrp !== null
                        ? `${formatINR(pricingAnalysis.mrp)} (${pricingAnalysis.mrpRestricted ? 'Enforced' : 'Advisory'})`
                        : 'Unrestricted / Loose'}
                    </span>
                  </div>
                </div>
              )}

              <div className="pt-3 border-t border-[var(--border-hairline)]">
                <p className="text-xs font-semibold text-[var(--text-secondary)] mb-2">
                  Verified Rate History
                </p>
                <PriceHistorySparkChart points={priceHistoryPoints} />
              </div>
            </SurfaceCard>

            <div className="lg:col-span-7 space-y-4">
              {pricingAnalysis && (
                <>
                  {pricingAnalysis.warnings.length > 0 && (
                    <div className="p-4 rounded-2xl bg-red-50 dark:bg-red-950/35 border border-red-200 dark:border-red-900 space-y-1">
                      <p className="text-xs font-bold text-red-800 dark:text-red-300 flex items-center gap-1.5">
                        <AlertTriangle className="w-4 h-4" />
                        Replacement-Cost Warning
                      </p>
                      {pricingAnalysis.warnings.map((w, i) => (
                        <p key={i} className="text-xs text-red-700 dark:text-red-300">
                          {w}
                        </p>
                      ))}
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <SurfaceCard className="p-4 space-y-1.5">
                      <span className="text-xs font-medium text-[var(--text-muted)]">
                        Historical gross profit (existing stock)
                      </span>
                      <p className="font-mono-num text-xl font-bold">
                        {pricingAnalysis.historicalGrossProfitPerUnit !== null
                          ? `${formatINR(pricingAnalysis.historicalGrossProfitPerUnit)} / ${selectedProduct?.baseUnit}`
                          : 'Not enough recorded data.'}
                      </p>
                      <p className="text-xs text-[var(--text-secondary)]">
                        {pricingAnalysis.historicalMarginPct !== null
                          ? `${formatINR(pricingAnalysis.currentSellingPrice)} − ${formatINR(pricingAnalysis.historicalLandedCost)} = ${pricingAnalysis.historicalMarginPct.toFixed(1)}% gross margin`
                          : 'Record purchase cost to measure historical profit.'}
                      </p>
                    </SurfaceCard>

                    <SurfaceCard className="p-4 space-y-1.5">
                      <span className="text-xs font-medium text-[var(--text-muted)]">
                        Replacement-cost difference (restock)
                      </span>
                      <p
                        className={`font-mono-num text-xl font-bold ${
                          pricingAnalysis.isSellingBelowReplacementCost
                            ? 'text-red-700 dark:text-red-400'
                            : 'text-emerald-700 dark:text-emerald-400'
                        }`}
                      >
                        {pricingAnalysis.replacementCostDiffPerUnit !== null
                          ? `${formatINR(pricingAnalysis.replacementCostDiffPerUnit)} / ${selectedProduct?.baseUnit}`
                          : 'No verified rate'}
                      </p>
                      <p className="text-xs text-[var(--text-secondary)]">
                        {pricingAnalysis.breakEvenSellingPrice !== null
                          ? `Break-even floor: ${formatINR(pricingAnalysis.breakEvenSellingPrice)} · Restock margin: ${pricingAnalysis.replacementMarginPct?.toFixed(1)}%`
                          : 'Log a valid supplier quote or market rate to evaluate restock margin.'}
                      </p>
                    </SurfaceCard>
                  </div>

                  <SurfaceCard className="p-5 space-y-4">
                    <div>
                      <h3 className="font-display text-base font-semibold">
                        Transparent Suggested Selling Prices
                      </h3>
                      <p className="text-xs text-[var(--text-secondary)]">
                        Prices are never changed automatically. Every scenario explains its formula and requires owner approval.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {pricingAnalysis.scenarios.map((sc) => (
                        <div
                          key={sc.label}
                          className="p-4 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)]/50 flex flex-col justify-between gap-3"
                        >
                          <div>
                            <p className="text-xs font-semibold text-[var(--text-secondary)]">
                              {sc.label} ({sc.targetMarginPct}% target)
                            </p>
                            <p className="font-mono-num text-xl font-bold text-[var(--text-primary)] mt-1">
                              {sc.suggestedPrice !== null
                                ? formatINR(sc.suggestedPrice)
                                : 'Unavailable'}
                            </p>
                            {sc.suggestedPrice !== null &&
                              pricingAnalysis.replacementLandedCost !== null && (
                                <p className="text-[11px] text-[var(--text-muted)] mt-1">
                                  {formatINR(pricingAnalysis.replacementLandedCost)} ÷ (1 −{' '}
                                  {(sc.targetMarginPct / 100).toFixed(2)}) ={' '}
                                  <span className="font-mono-num">{formatINR(sc.uncappedPrice)}</span>
                                </p>
                              )}
                            {sc.cappedByMrp && (
                              <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-400 mt-0.5">
                                Capped at MRP ({formatINR(selectedProduct?.mrp)})
                              </p>
                            )}
                            {sc.profitPerUnit !== null && (
                              <p className="text-[11px] text-[var(--text-muted)] mt-1 font-mono-num">
                                Margin: {sc.resultingMarginPct?.toFixed(1)}% · +{formatINR(sc.profitPerUnit)}
                              </p>
                            )}
                          </div>

                          <button
                            type="button"
                            disabled={sc.suggestedPrice === null || applyingPrice}
                            onClick={() =>
                              sc.suggestedPrice !== null &&
                              handleApprovePrice(sc.suggestedPrice, sc.label)
                            }
                            className="bhaviq-btn-primary w-full min-h-[38px] rounded-xl disabled:opacity-40 text-xs font-semibold"
                          >
                            Approve & update
                          </button>
                        </div>
                      ))}
                    </div>
                  </SurfaceCard>
                </>
              )}
            </div>
          </div>
        )
      )}

      {/* TAB 3: PRICE MOVEMENT ALERTS */}
      {activeTab === 'alerts' && (() => {
        const surgeAlerts = alerts.filter((a) => a.severity !== 'opportunity');
        const opportunityAlerts = alerts.filter((a) => a.severity === 'opportunity');
        const displayedAlerts =
          alertFilter === 'surges'
            ? surgeAlerts
            : alertFilter === 'opportunities'
              ? opportunityAlerts
              : alertFilter === 'acknowledged'
                ? acknowledgedAlerts
                : alerts;

        const handleAlertViewSku = (alert: PriceAlert) => {
          if (alert.skuCode) {
            setLiveFilterPill('All SKUs');
            setLiveSearch(alert.skuCode);
            setActiveTab('live');
          } else if (alert.productId) {
            setDetailProductId(alert.productId);
            setActiveTab('explorer');
          }
        };

        return (
          <div className="space-y-4">
            <SurfaceCard className="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div>
                <h3 className="font-display text-base font-bold text-[var(--text-primary)]">
                  Live Daily Volatility &amp; Replacement-Cost Alerts
                </h3>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                  Monitors daily wholesale shocks across Edible Oils, Sugar, Toor Dal, Wheat Atta, Loose Tea, and FMCG packs against official MRPs and your inventory cost.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 shrink-0" role="tablist" aria-label="Filter price movement alerts">
                {(
                  [
                    { id: 'all', label: `All Active (${alerts.length})` },
                    { id: 'surges', label: `Price Surges (${surgeAlerts.length})` },
                    { id: 'opportunities', label: `Buying Opportunities (${opportunityAlerts.length})` },
                    { id: 'acknowledged', label: `Acknowledged (${acknowledgedAlerts.length})` },
                  ] as const
                ).map((pill) => {
                  const active = alertFilter === pill.id;
                  return (
                    <button
                      key={pill.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setAlertFilter(pill.id)}
                      className={`px-3.5 py-1.5 min-h-[34px] rounded-full text-xs font-semibold whitespace-nowrap border transition-colors ${
                        active
                          ? 'bhaviq-nav-active border-transparent'
                          : 'bg-[var(--bg-surface)] border-slate-200 dark:border-slate-700 text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]'
                      }`}
                    >
                      {pill.label}
                    </button>
                  );
                })}
              </div>
            </SurfaceCard>

            {displayedAlerts.length === 0 ? (
              <EmptyStateCard
                icon={<AlertTriangle className="w-6 h-6" />}
                title={
                  alertFilter === 'acknowledged'
                    ? 'No acknowledged alerts yet'
                    : 'No active alerts in this view'
                }
                description={
                  alertFilter === 'acknowledged'
                    ? 'Alerts you acknowledge from Overview or this screen appear here for audit tracking.'
                    : 'All price movement alerts in this category have been acknowledged or no threshold spikes occurred.'
                }
              />
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {displayedAlerts.map((alert) => (
                  <MarketAlertCard
                    key={alert.id}
                    alert={alert}
                    acknowledging={dailyAlertsState?.acknowledgingId === alert.id}
                    onViewSku={handleAlertViewSku}
                    onOpenCalculator={(a) => {
                      if (!a.productId) return;
                      setSelectedProductId(a.productId);
                      setCustomReplacementOverride('');
                      setActiveTab('calculator');
                    }}
                    onAcknowledge={
                      dailyAlertsState ? (id) => void dailyAlertsState.acknowledgeAlert(id) : undefined
                    }
                    onRestore={
                      dailyAlertsState ? (id) => void dailyAlertsState.restoreAlert(id) : undefined
                    }
                  />
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* TAB 4: DAILY DATA SOURCES & SYNC DIAGNOSTICS */}
      {activeTab === 'sources' && (
        <div className="space-y-5">
          <SurfaceCard className="p-6 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-base font-bold">
                  Daily Rate Update & AGMARKNET Diagnostics (data.gov.in)
                </h3>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                  Resource ID: <span className="font-mono-num">9ef84268-d588-465a-a308-a864a43d0070</span> · Backend scheduler triggers <span className="font-mono-num">syncMarketRates</span> every 24h and logs every run below.
                </p>
              </div>
              <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5 shrink-0">
                <TextInput
                  aria-label="Filter AGMARKNET commodity"
                  value={syncCommodity}
                  onChange={(e) => setSyncCommodity(e.target.value)}
                  placeholder="Commodity (e.g. Onion)"
                  className="w-full sm:w-56"
                />
                <button
                  type="button"
                  onClick={handleSyncAgmarknet}
                  disabled={syncing}
                  className="bhaviq-btn-primary px-4 py-2.5 min-h-[42px] rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
                  <span>{syncing ? 'Syncing...' : 'Sync AGMARKNET now'}</span>
                </button>
              </div>
            </div>

            {agmarknetSource && !agmarknetSource.isConfigured && (
              <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-xs text-amber-800 dark:text-amber-300">
                AGMARKNET sync requires <code className="font-mono-num font-semibold">DATA_GOV_IN_API_KEY</code> in the server environment. BHAVIQ never fabricates live mandi rates or fakes a success status when the API key is missing or upstream requests fail.
              </div>
            )}

            {syncResultMsg && (
              <div
                className={`p-3.5 rounded-xl border text-xs font-medium ${
                  syncResultOk
                    ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-300'
                    : 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900 text-red-700 dark:text-red-300'
                }`}
              >
                {syncResultMsg}
              </div>
            )}
          </SurfaceCard>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {sources.map((src) => (
              <SurfaceCard key={src.id} className="p-4 space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <Database className="w-4 h-4 text-[var(--accent-primary)] shrink-0 mt-0.5" />
                  <span
                    className={`text-[11px] font-semibold uppercase ${
                      src.lastSyncStatus === 'success'
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : src.lastSyncStatus === 'failed'
                          ? 'text-red-700 dark:text-red-400'
                          : src.lastSyncStatus === 'not_configured'
                            ? 'text-amber-700 dark:text-amber-400'
                            : 'text-[var(--text-muted)]'
                    }`}
                  >
                    {src.lastSyncStatus.replace('_', ' ')}
                  </span>
                </div>
                <p className="text-sm font-semibold">{src.name}</p>
                <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                  {src.coverageNotes}
                </p>
                <div className="pt-2 border-t border-[var(--border-hairline)] space-y-1 text-[11px] font-mono-num text-[var(--text-muted)]">
                  <p>Last successful sync: {formatShortTimestamp(src.lastSyncAt)}</p>
                  <p>Last attempted sync: {formatShortTimestamp(src.lastAttemptedAt)}</p>
                  <p>
                    Data date: {src.lastDataDate || '—'} · Fetched: {src.lastRecordsFetched} · Matched:{' '}
                    {src.lastRecordsMatched}
                  </p>
                </div>
                {src.lastError && (
                  <p className="text-[11px] text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/30 p-2 rounded-lg">
                    Error: {src.lastError}
                  </p>
                )}
              </SurfaceCard>
            ))}
          </div>

          {/* Sync Run Audit Log */}
          <SurfaceCard className="p-5 space-y-3">
            <div>
              <h4 className="font-display text-sm font-semibold">
                Recent Synchronization Attempts ({syncRuns.length})
              </h4>
              <p className="text-xs text-[var(--text-muted)]">
                Every scheduled (24h) and manual sync attempt records exact network diagnostics, data date, fetched counts, and matched product counts.
              </p>
            </div>
            {syncRuns.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">
                No sync attempts logged yet. Click &ldquo;Sync Now&rdquo; in Master Price Matrix or &ldquo;Sync AGMARKNET now&rdquo; above to test connectivity.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border-hairline)] text-[var(--text-muted)]">
                      <th className="py-2 px-2.5 font-medium">Attempted</th>
                      <th className="py-2 px-2.5 font-medium">Trigger</th>
                      <th className="py-2 px-2.5 font-medium">Status</th>
                      <th className="py-2 px-2.5 font-medium whitespace-nowrap">Data Date</th>
                      <th className="py-2 px-2.5 font-medium text-right">Fetched</th>
                      <th className="py-2 px-2.5 font-medium text-right">Matched</th>
                      <th className="py-2 px-2.5 font-medium">Error / Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-hairline)]">
                    {syncRuns.map((run) => (
                      <tr key={run.id}>
                        <td className="py-2 px-2.5 font-mono-num whitespace-nowrap">
                          {formatShortTimestamp(run.attemptedAt)}
                        </td>
                        <td className="py-2 px-2.5 capitalize">{run.triggerType}</td>
                        <td
                          className={`py-2 px-2.5 font-semibold uppercase whitespace-nowrap ${
                            run.status === 'success'
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : run.status === 'failed'
                                ? 'text-red-700 dark:text-red-400'
                                : 'text-amber-700 dark:text-amber-400'
                          }`}
                        >
                          {run.status.replace('_', ' ')}
                        </td>
                        <td className="py-2 px-2.5 font-mono-num whitespace-nowrap">{run.dataDate || '—'}</td>
                        <td className="py-2 px-2.5 font-mono-num text-right">{run.recordsFetched}</td>
                        <td className="py-2 px-2.5 font-mono-num text-right">{run.recordsMatched}</td>
                        <td className="py-2 px-2.5 text-[var(--text-secondary)]">
                          {run.errorDetails || `Inserted ${run.recordsInserted} new rows`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SurfaceCard>
        </div>
      )}

      {/* Enhanced Supplier Quotation Modal */}
      <ResponsiveDialog
        open={quoteOpen}
        onClose={() => setQuoteOpen(false)}
        title="Log verified supplier quotation"
        subtitle="Preserves full cost breakdown, validity date, and source evidence without overwriting historical prices"
        maxWidthClass="max-w-2xl"
      >
        <form onSubmit={handleCreateQuotation} className="space-y-4">
          {qError && (
            <div className="px-3.5 py-2.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
              {qError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <FieldLabel htmlFor="q-prod" required>
                Product (brand & pack size locked)
              </FieldLabel>
              <SelectInput
                id="q-prod"
                value={qProductId}
                onChange={(e) => {
                  const p = products.find((x) => x.id === e.target.value);
                  setQProductId(e.target.value);
                  if (p) setQUnit(p.baseUnit);
                }}
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.brand ? ` (${p.brand})` : ''}
                    {p.packSize ? ` · ${p.packSize}` : ''}
                  </option>
                ))}
              </SelectInput>
            </div>
            <div>
              <FieldLabel htmlFor="q-sup" required>
                Supplier
              </FieldLabel>
              <SelectInput
                id="q-sup"
                value={qSupplierId}
                onChange={(e) => setQSupplierId(e.target.value)}
              >
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </SelectInput>
            </div>
          </div>

          {qProduct && (
            <p className="text-xs text-[var(--text-muted)]">
              Matching identity: Brand <strong className="text-[var(--text-primary)]">{qProduct.brand || 'Unbranded'}</strong>
              {' · '}Pack size <strong className="text-[var(--text-primary)]">{qProduct.packSize || 'Standard / Loose'}</strong>
              {' · '}Base unit <strong className="text-[var(--text-primary)]">{qProduct.baseUnit}</strong>
            </p>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <FieldLabel htmlFor="q-qty" required>
                Quantity
              </FieldLabel>
              <TextInput
                id="q-qty"
                type="number"
                min="0.01"
                step="any"
                required
                value={qQuantity}
                onChange={(e) => setQQuantity(e.target.value)}
              />
            </div>
            <div>
              <FieldLabel htmlFor="q-unit" required>
                Quote unit
              </FieldLabel>
              <SelectInput
                id="q-unit"
                value={qUnit}
                onChange={(e) => setQUnit(e.target.value)}
              >
                {qAllowedUnits.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </SelectInput>
            </div>
            <div>
              <FieldLabel htmlFor="q-rate" required>
                Wholesale rate / {qUnit || 'unit'} (₹)
              </FieldLabel>
              <TextInput
                id="q-rate"
                type="number"
                min="0.01"
                step="0.01"
                required
                value={qRate}
                onChange={(e) => setQRate(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
            <div>
              <FieldLabel htmlFor="q-discount">Discount (₹)</FieldLabel>
              <TextInput
                id="q-discount"
                type="number"
                min="0"
                step="0.01"
                value={qDiscount}
                onChange={(e) => setQDiscount(e.target.value)}
              />
            </div>
            <div>
              <FieldLabel htmlFor="q-tax">Applicable tax (₹)</FieldLabel>
              <TextInput
                id="q-tax"
                type="number"
                min="0"
                step="0.01"
                value={qTax}
                onChange={(e) => setQTax(e.target.value)}
              />
            </div>
            <div>
              <FieldLabel htmlFor="q-freight">Transport / freight (₹)</FieldLabel>
              <TextInput
                id="q-freight"
                type="number"
                min="0"
                step="0.01"
                value={qFreight}
                onChange={(e) => setQFreight(e.target.value)}
              />
            </div>
            <div>
              <FieldLabel htmlFor="q-additional">Additional costs (₹)</FieldLabel>
              <TextInput
                id="q-additional"
                type="number"
                min="0"
                step="0.01"
                value={qAdditional}
                onChange={(e) => setQAdditional(e.target.value)}
              />
            </div>
          </div>

          {qLiveCostPreview && qProduct && (
            <div className="p-3.5 rounded-xl bg-[var(--bg-subtle)]/70 border border-[var(--border-hairline)] flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="text-[var(--text-secondary)]">
                Total quotation cost:{' '}
                <strong className="font-mono-num text-[var(--text-primary)]">
                  {formatINR(qLiveCostPreview.finalTotalCost)}
                </strong>{' '}
                for {qLiveCostPreview.baseQuantity} {qProduct.baseUnit}
              </span>
              <span className="font-mono-num font-bold text-[var(--accent-primary)]">
                Final landed cost: {formatINR(qLiveCostPreview.landedCostPerBaseUnit)} /{' '}
                {qProduct.baseUnit}
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <FieldLabel htmlFor="q-date" required>
                Quotation date
              </FieldLabel>
              <TextInput
                id="q-date"
                type="date"
                required
                value={qDate}
                onChange={(e) => setQDate(e.target.value)}
              />
            </div>
            <div>
              <FieldLabel htmlFor="q-valid-until">Valid until (optional)</FieldLabel>
              <TextInput
                id="q-valid-until"
                type="date"
                value={qValidUntil}
                onChange={(e) => setQValidUntil(e.target.value)}
              />
            </div>
            <div>
              <FieldLabel htmlFor="q-ver">Verification status</FieldLabel>
              <SelectInput
                id="q-ver"
                value={qVerification}
                onChange={(e) =>
                  setQVerification(
                    e.target.value as 'verified_quotation' | 'price_list' | 'verbal_quote'
                  )
                }
              >
                <option value="verified_quotation">Verified written quotation</option>
                <option value="price_list">Distributor price list</option>
                <option value="verbal_quote">Verbal quote</option>
              </SelectInput>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <FieldLabel htmlFor="q-evidence">Source evidence / Quotation ref</FieldLabel>
              <TextInput
                id="q-evidence"
                value={qSourceEvidence}
                onChange={(e) => setQSourceEvidence(e.target.value)}
                placeholder="e.g. Quote #QT-402 or WhatsApp PDF ref"
              />
            </div>
            <div>
              <FieldLabel htmlFor="q-evidence-file">Or attach quotation filename</FieldLabel>
              <input
                id="q-evidence-file"
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setQSourceEvidence(`Uploaded file: ${file.name} (${Math.ceil(file.size / 1024)} KB)`);
                  }
                }}
                className="w-full text-xs text-[var(--text-secondary)] file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border file:border-[var(--border-hairline)] file:bg-[var(--bg-subtle)] file:text-xs file:font-semibold"
              />
            </div>
          </div>

          <div>
            <FieldLabel htmlFor="q-notes">Notes</FieldLabel>
            <TextInput
              id="q-notes"
              value={qNotes}
              onChange={(e) => setQNotes(e.target.value)}
              placeholder="e.g. Minimum 10 bags, delivery included"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setQuoteOpen(false)}
              className="px-4 py-2.5 min-h-[42px] rounded-xl border border-[var(--border-hairline)] text-xs font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={qSaving}
              className="bhaviq-btn-primary px-5 py-2.5 min-h-[42px] rounded-xl text-xs font-semibold"
            >
              {qSaving ? 'Saving...' : 'Save quotation'}
            </button>
          </div>
        </form>
      </ResponsiveDialog>

      {/* Market Observation Modal */}
      <ResponsiveDialog
        open={obsOpen}
        onClose={() => setObsOpen(false)}
        title="Log wholesale / retail market observation"
        subtitle="Manually verified local market or cash-and-carry rate"
      >
        <form onSubmit={handleCreateObservation} className="space-y-4">
          <div>
            <FieldLabel htmlFor="obs-prod">Link to shop product (optional)</FieldLabel>
            <SelectInput
              id="obs-prod"
              value={obsProductId}
              onChange={(e) => {
                setObsProductId(e.target.value);
                const p = products.find((x) => x.id === e.target.value);
                if (p) {
                  setObsName(p.name);
                  setObsUnit(p.baseUnit);
                }
              }}
            >
              <option value="">Standalone commodity / product</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.packSize ? ` · ${p.packSize}` : ''}
                </option>
              ))}
            </SelectInput>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <FieldLabel htmlFor="obs-name" required>
                Product / commodity name
              </FieldLabel>
              <TextInput
                id="obs-name"
                required
                value={obsName}
                onChange={(e) => setObsName(e.target.value)}
                placeholder="e.g. Onion / Sugar M-30"
              />
            </div>
            <div>
              <FieldLabel htmlFor="obs-market" required>
                Market / Wholesale hub
              </FieldLabel>
              <TextInput
                id="obs-market"
                required
                value={obsMarket}
                onChange={(e) => setObsMarket(e.target.value)}
                placeholder="e.g. Gultekdi Market Yard"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <FieldLabel htmlFor="obs-price" required>
                Observed rate (₹)
              </FieldLabel>
              <TextInput
                id="obs-price"
                type="number"
                min="0.01"
                step="0.01"
                required
                value={obsPrice}
                onChange={(e) => setObsPrice(e.target.value)}
              />
            </div>
            <div>
              <FieldLabel htmlFor="obs-unit" required>
                Unit
              </FieldLabel>
              <TextInput
                id="obs-unit"
                required
                value={obsUnit}
                onChange={(e) => setObsUnit(e.target.value)}
              />
            </div>
            <div>
              <FieldLabel htmlFor="obs-date" required>
                Date
              </FieldLabel>
              <TextInput
                id="obs-date"
                type="date"
                required
                value={obsDate}
                onChange={(e) => setObsDate(e.target.value)}
              />
            </div>
          </div>
          <div>
            <FieldLabel htmlFor="obs-loc" required>
              Location
            </FieldLabel>
            <TextInput
              id="obs-loc"
              required
              value={obsLocation}
              onChange={(e) => setObsLocation(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setObsOpen(false)}
              className="px-4 py-2.5 min-h-[42px] rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={obsSaving}
              className="bhaviq-btn-primary px-5 py-2.5 min-h-[42px] rounded-xl text-xs font-semibold"
            >
              {obsSaving ? 'Saving...' : 'Save observation'}
            </button>
          </div>
        </form>
      </ResponsiveDialog>
    </div>
  );
};
