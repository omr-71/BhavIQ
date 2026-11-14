import { apiRequest } from './api';
import {
  buildMasterCatalogMatrix,
  computeDailyVarianceFactor,
  MASTER_CATEGORY_FILTERS,
  shiftIsoDate,
  type LiveAgriRateOverride,
  type MasterCategory,
  type MasterCategoryFilter,
  type MasterProductSKU,
  type SupplierTierLabel,
} from './masterCatalog';
import { roundCurrency } from './units';
import { formatMarketFetchError, getTodayIsoDate } from './wholesale';

export {
  buildMasterCatalogMatrix,
  computeDailyVarianceFactor,
  MASTER_CATEGORY_FILTERS,
  shiftIsoDate,
  type LiveAgriRateOverride,
  type MasterCategory,
  type MasterCategoryFilter,
  type MasterProductSKU,
  type SupplierTierLabel,
};

export const DATA_GOV_AGMARKNET_ENDPOINT =
  'https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070';

export interface RawDataGovCommodityRecord {
  commodity?: string;
  variety?: string;
  grade?: string;
  arrival_date?: string;
  min_price?: string | number;
  max_price?: string | number;
  modal_price?: string | number;
  state?: string;
  district?: string;
  market?: string;
}

export interface NormalizedMarketRateRecord {
  commodityName: string;
  variety: string | null;
  agriKey: string | null;
  supplierTier: SupplierTierLabel;
  modalQuintal: number;
  modalPerKg: number;
  previousPerKg: number;
  minPerKg: number;
  maxPerKg: number;
  observationDate: string;
  rawPayloadJson: string;
}

export interface ShopMarketDbAdapter {
  shopId: string;
  saveNormalizedMarketRates: (params: {
    sourceKey: string;
    sourceName: string;
    attemptedAt: string;
    completedAt: string;
    status: 'success' | 'failed' | 'not_configured';
    dataDate: string | null;
    recordsFetched: number;
    normalizedRecords: NormalizedMarketRateRecord[];
    httpStatus: number | null;
    errorCode: string | null;
    errorDetails: string | null;
  }) => { insertedCount: number; matchedCount: number };
}

export interface SyncMarketRatesResponse {
  ok: boolean;
  sourceMode: 'live_api' | 'enterprise_master_index';
  configured: boolean;
  lastSyncedAt: string;
  dataDate: string;
  recordsFetched: number;
  recordsStored: number;
  recordsMatched: number;
  totalCatalogCount: number;
  liveAgriOverrides: Record<string, LiveAgriRateOverride>;
  rateLimited: boolean;
  retryAfterSeconds: number | null;
  fallbackReason: string | null;
}

export interface ShopPrivateMarketSnapshot {
  shopId: string;
  sourceKey: string;
  sourceName: string;
  savedAt: string;
  dataDate: string | null;
  status: 'success' | 'failed' | 'not_configured';
  recordsFetched: number;
  insertedCount: number;
  matchedCount: number;
  normalizedRecords: NormalizedMarketRateRecord[];
}

export interface SaveProcessedMarketIntelligenceParams {
  shopId: string;
  sourceKey?: string;
  sourceName?: string;
  attemptedAt?: string;
  completedAt?: string;
  status: 'success' | 'failed' | 'not_configured';
  dataDate: string | null;
  recordsFetched: number;
  normalizedRecords: NormalizedMarketRateRecord[];
  httpStatus?: number | null;
  errorCode?: string | null;
  errorDetails?: string | null;
  dbAdapter?: ShopMarketDbAdapter;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
}

const SHOP_MARKET_STORAGE_PREFIX = 'bhaviq_shop_market_intel:';

function resolveLocalStorage(
  customStorage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
  if (customStorage) return customStorage;
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  return null;
}

/**
 * Persists processed, normalized market intelligence strictly scoped to the given `shopId`
 * (using the shop's SQLite/DB adapter on the server and/or shop-isolated local schema storage).
 * Throws if `shopId` is missing or mismatches the adapter's `shopId` to guarantee shop privacy.
 */
export function saveProcessedMarketIntelligence(
  params: SaveProcessedMarketIntelligenceParams
): ShopPrivateMarketSnapshot {
  const cleanShopId = params.shopId?.trim();
  if (!cleanShopId) {
    throw new Error('Cannot save market intelligence without a valid shopId.');
  }
  if (params.dbAdapter && params.dbAdapter.shopId !== cleanShopId) {
    throw new Error(
      `Shop privacy violation: adapter shopId (${params.dbAdapter.shopId}) does not match target shopId (${cleanShopId}).`
    );
  }

  const nowIso = new Date().toISOString();
  const attemptedAt = params.attemptedAt ?? nowIso;
  const completedAt = params.completedAt ?? nowIso;
  const sourceKey = params.sourceKey ?? 'agmarknet_ogd';
  const sourceName = params.sourceName ?? 'data.gov.in Wholesale Index';

  const dbResult = params.dbAdapter
    ? params.dbAdapter.saveNormalizedMarketRates({
        sourceKey,
        sourceName,
        attemptedAt,
        completedAt,
        status: params.status,
        dataDate: params.dataDate,
        recordsFetched: params.recordsFetched,
        normalizedRecords: params.normalizedRecords,
        httpStatus: params.httpStatus ?? null,
        errorCode: params.errorCode ?? null,
        errorDetails: params.errorDetails ?? null,
      })
    : {
        insertedCount: params.normalizedRecords.length,
        matchedCount: params.normalizedRecords.filter((r) => Boolean(r.agriKey)).length,
      };

  const snapshot: ShopPrivateMarketSnapshot = {
    shopId: cleanShopId,
    sourceKey,
    sourceName,
    savedAt: completedAt,
    dataDate: params.dataDate,
    status: params.status,
    recordsFetched: params.recordsFetched,
    insertedCount: dbResult.insertedCount,
    matchedCount: dbResult.matchedCount,
    normalizedRecords: params.normalizedRecords.map((r) => ({ ...r })),
  };

  const store = resolveLocalStorage(params.storage);
  if (store && params.status === 'success') {
    try {
      store.setItem(`${SHOP_MARKET_STORAGE_PREFIX}${cleanShopId}`, JSON.stringify(snapshot));
    } catch {
      // Ignore storage quota errors gracefully
    }
  }

  return snapshot;
}

/**
 * Loads processed market intelligence strictly for the requested `shopId`.
 * Rejects any mismatched shop payload so data remains 100% shop-private.
 */
export function loadShopPrivateMarketIntelligence(
  shopId: string,
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
): ShopPrivateMarketSnapshot | null {
  const cleanShopId = shopId?.trim();
  if (!cleanShopId) return null;
  const store = resolveLocalStorage(storage);
  if (!store) return null;
  try {
    const raw = store.getItem(`${SHOP_MARKET_STORAGE_PREFIX}${cleanShopId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ShopPrivateMarketSnapshot;
    if (!parsed || parsed.shopId !== cleanShopId || !Array.isArray(parsed.normalizedRecords)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearShopPrivateMarketIntelligence(
  shopId: string,
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
): void {
  const cleanShopId = shopId?.trim();
  if (!cleanShopId) return;
  const store = resolveLocalStorage(storage);
  if (!store) return;
  try {
    store.removeItem(`${SHOP_MARKET_STORAGE_PREFIX}${cleanShopId}`);
  } catch {
    // ignore
  }
}

export interface SyncMarketRatesParams {
  shopId: string;
  state?: string;
  commodity?: string;
  limit?: number;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  dbAdapter?: ShopMarketDbAdapter;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
}

/**
 * Converts a wholesale rate quoted per Quintal (100 kg) into per-Kilogram INR.
 */
export function normalizeQuintalToKg(quintalPrice: number): number | null {
  if (!Number.isFinite(quintalPrice) || quintalPrice <= 0) return null;
  return roundCurrency(quintalPrice / 100);
}

/**
 * Maps raw agricultural commodity titles to standardized staple category keys
 * used by the Master Product Price Matrix.
 */
export function mapCommodityToAgriKey(commodityName: string): string | null {
  const s = commodityName.toLowerCase();
  if (/\b(turmeric|haldi)\b/.test(s)) return 'turmeric';
  if (/\b(cumin|jeera|cummin)\b/.test(s)) return 'cumin';
  if (/\b(coriander|dhania)\b/.test(s)) return 'coriander';
  if (/\b(chilli|chillies|mirch)\b/.test(s)) return 'chilli';
  if (/\b(black pepper|pepper|kali mirch)\b/.test(s)) return 'black_pepper';
  if (/\b(cardamom|elaichi|elachi)\b/.test(s)) return 'cardamom';
  if (/\b(mustard seed|rai|sarson seed)\b/.test(s)) return 'mustard_seed';
  if (/\b(sunflower)\b/.test(s)) return 'sunflower_oil';
  if (/\b(mustard)\b/.test(s)) return 'mustard_oil';
  if (/\b(groundnut)\b/.test(s)) return 'groundnut_oil';
  if (/\b(toor|tur|arhar|pigeon pea)\b/.test(s)) return 'toor_dal';
  if (/\b(urad|black gram|masha)\b/.test(s)) return 'urad_dal';
  if (/\b(masoor|lentil)\b/.test(s)) return 'masoor_dal';
  if (/\b(moong|green gram)\b/.test(s)) return 'moong_dal';
  if (/\b(kabuli)\b/.test(s)) return 'kabuli_chana';
  if (/\b(rajma|kidney bean)\b/.test(s)) return 'rajma';
  if (/\b(besan|gram flour)\b/.test(s)) return 'besan';
  if (/\b(chana|bengal gram|gram)\b/.test(s)) return 'chana_dal';
  if (/\b(poha|flattened rice|beaten rice)\b/.test(s)) return 'poha';
  if (/\b(maida)\b/.test(s)) return 'maida';
  if (/\b(suji|sooji|rava|semolina)\b/.test(s)) return 'suji';
  if (/\b(wheat|atta)\b/.test(s)) return 'wheat';
  if (/\b(rice|paddy|basmati)\b/.test(s)) return 'rice';
  if (/\b(jaggery|gur)\b/.test(s)) return 'jaggery';
  if (/\b(sugar)\b/.test(s)) return 'sugar';
  if (/\b(cashew|kaju)\b/.test(s)) return 'cashew';
  if (/\b(almond|badam)\b/.test(s)) return 'almond';
  return null;
}

function parseDataGovDate(raw?: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const dmy = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

export function normalizeAgmarknetRecordForShop(
  rec: RawDataGovCommodityRecord,
  fallbackDate: string
): NormalizedMarketRateRecord | null {
  const commodityName = (rec.commodity || '').trim();
  const modalQuintal = Number(rec.modal_price);
  const modalPerKg = normalizeQuintalToKg(modalQuintal);
  if (!commodityName || modalPerKg === null) return null;

  const minQ = Number(rec.min_price);
  const maxQ = Number(rec.max_price);
  const minPerKg =
    Number.isFinite(minQ) && minQ > 0 ? roundCurrency(minQ / 100) : roundCurrency(modalPerKg * 0.94);
  const maxPerKg =
    Number.isFinite(maxQ) && maxQ > 0 ? roundCurrency(maxQ / 100) : roundCurrency(modalPerKg * 1.06);
  const previousPerKg = roundCurrency((minPerKg + maxPerKg) / 2) || modalPerKg;
  const agriKey = mapCommodityToAgriKey(commodityName);

  return {
    commodityName,
    variety: (rec.variety || rec.grade || '').trim() || null,
    agriKey,
    supplierTier:
      agriKey && (agriKey.includes('oil') || agriKey === 'wheat' || agriKey === 'rice')
        ? 'National Distributor Benchmark'
        : 'Agri-Commodity Bulk Index',
    modalQuintal: roundCurrency(modalQuintal),
    modalPerKg,
    previousPerKg,
    minPerKg,
    maxPerKg,
    observationDate: parseDataGovDate(rec.arrival_date) || fallbackDate,
    rawPayloadJson: JSON.stringify(rec),
  };
}

/**
 * Integrates with data.gov.in commodity API, normalizes agricultural quintal rates to INR/kg,
 * handles HTTP 429 rate limits and upstream errors gracefully without throwing,
 * and persists normalized outputs into the shop database schema via `dbAdapter` (on server)
 * or delegates securely via `/api/shops/:shopId/market/live-feed/sync` (in browser).
 */
export async function syncMarketRates(
  params: SyncMarketRatesParams
): Promise<SyncMarketRatesResponse> {
  // Browser execution path: proxy safely through Express backend so DATA_GOV_IN_API_KEY stays server-only
  if (typeof window !== 'undefined' && !params.dbAdapter && !params.fetchImpl) {
    return apiRequest<SyncMarketRatesResponse>(
      `/api/shops/${params.shopId}/market/live-feed/sync`,
      {
        method: 'POST',
        body: JSON.stringify({
          state: params.state,
          commodity: params.commodity,
          limit: params.limit,
        }),
      }
    );
  }

  const attemptedAt = new Date().toISOString();
  const todayIso = getTodayIsoDate();
  const catalogBaseline = buildMasterCatalogMatrix(todayIso);
  const apiKey = params.apiKey?.trim();
  const fetchFn = params.fetchImpl ?? fetch;

  if (!apiKey) {
    const completedAt = new Date().toISOString();
    saveProcessedMarketIntelligence({
      shopId: params.shopId,
      sourceKey: 'agmarknet_ogd',
      sourceName: 'data.gov.in Wholesale Index',
      attemptedAt,
      completedAt,
      status: 'not_configured',
      dataDate: todayIso,
      recordsFetched: 0,
      normalizedRecords: [],
      httpStatus: null,
      errorCode: 'MISSING_API_KEY',
      errorDetails:
        'DATA_GOV_IN_API_KEY not configured — serving Enterprise Master Product Price Matrix.',
      dbAdapter: params.dbAdapter,
      storage: params.storage,
    });

    return {
      ok: true,
      sourceMode: 'enterprise_master_index',
      configured: false,
      lastSyncedAt: completedAt,
      dataDate: todayIso,
      recordsFetched: 0,
      recordsStored: 0,
      recordsMatched: 0,
      totalCatalogCount: catalogBaseline.length,
      liveAgriOverrides: {},
      rateLimited: false,
      retryAfterSeconds: null,
      fallbackReason: 'API credentials not configured; active benchmark catalog enabled.',
    };
  }

  const url = new URL(DATA_GOV_AGMARKNET_ENDPOINT);
  url.searchParams.set('api-key', apiKey);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', String(params.limit ?? 150));
  if (params.commodity?.trim()) {
    url.searchParams.set('filters[commodity]', params.commodity.trim());
  }

  try {
    const resp = await fetchFn(url.toString(), {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'BhavIQ-EnterprisePriceMatrix/2.0',
      },
      signal: AbortSignal.timeout(8000),
    });

    const completedAt = new Date().toISOString();

    if (resp.status === 429) {
      const retryHeader = resp.headers.get('retry-after');
      const retrySeconds = retryHeader && Number.isFinite(Number(retryHeader))
        ? Number(retryHeader)
        : 60;
      const errMsg = `Rate limited by data.gov.in (HTTP 429). Retry after ${retrySeconds}s.`;

      saveProcessedMarketIntelligence({
        shopId: params.shopId,
        sourceKey: 'agmarknet_ogd',
        sourceName: 'data.gov.in Wholesale Index',
        attemptedAt,
        completedAt,
        status: 'failed',
        dataDate: todayIso,
        recordsFetched: 0,
        normalizedRecords: [],
        httpStatus: 429,
        errorCode: 'RATE_LIMITED_429',
        errorDetails: errMsg,
        dbAdapter: params.dbAdapter,
        storage: params.storage,
      });

      return {
        ok: true,
        sourceMode: 'enterprise_master_index',
        configured: true,
        lastSyncedAt: completedAt,
        dataDate: todayIso,
        recordsFetched: 0,
        recordsStored: 0,
        recordsMatched: 0,
        totalCatalogCount: catalogBaseline.length,
        liveAgriOverrides: {},
        rateLimited: true,
        retryAfterSeconds: retrySeconds,
        fallbackReason: errMsg,
      };
    }

    if (!resp.ok) {
      throw new Error(`data.gov.in HTTP ${resp.status} ${resp.statusText || ''}`.trim());
    }

    const payload = (await resp.json()) as {
      records?: RawDataGovCommodityRecord[];
      status?: string;
      message?: string;
      error?: string;
    };

    if (payload.error || payload.status?.toLowerCase() === 'error') {
      throw new Error(payload.error || payload.message || 'data.gov.in returned an error payload');
    }

    const rawRecords = Array.isArray(payload.records) ? payload.records : [];
    const normalized: NormalizedMarketRateRecord[] = [];
    const liveAgriOverrides: Record<string, LiveAgriRateOverride> = {};

    for (const rec of rawRecords) {
      const norm = normalizeAgmarknetRecordForShop(rec, todayIso);
      if (!norm) continue;
      normalized.push(norm);

      if (norm.agriKey) {
        const existing = liveAgriOverrides[norm.agriKey];
        if (!existing) {
          liveAgriOverrides[norm.agriKey] = {
            pricePerKg: norm.modalPerKg,
            previousPricePerKg: norm.previousPerKg,
            arrivalDate: norm.observationDate,
          };
        } else {
          // Average multiple distributor benchmark records cleanly without location bias
          liveAgriOverrides[norm.agriKey] = {
            pricePerKg: roundCurrency((existing.pricePerKg + norm.modalPerKg) / 2),
            previousPricePerKg: roundCurrency(
              (existing.previousPricePerKg + norm.previousPerKg) / 2
            ),
            arrivalDate:
              norm.observationDate > existing.arrivalDate
                ? norm.observationDate
                : existing.arrivalDate,
          };
        }
      }
    }

    if (normalized.length === 0) {
      throw new Error('data.gov.in returned 0 valid commodity rate records.');
    }

    const latestDate = normalized.reduce(
      (max, item) => (item.observationDate > max ? item.observationDate : max),
      todayIso
    );

    const savedSnapshot = saveProcessedMarketIntelligence({
      shopId: params.shopId,
      sourceKey: 'agmarknet_ogd',
      sourceName: 'data.gov.in Wholesale Index',
      attemptedAt,
      completedAt,
      status: 'success',
      dataDate: latestDate,
      recordsFetched: rawRecords.length,
      normalizedRecords: normalized,
      httpStatus: resp.status,
      errorCode: null,
      errorDetails: null,
      dbAdapter: params.dbAdapter,
      storage: params.storage,
    });

    const totalCatalogCount = buildMasterCatalogMatrix(latestDate, liveAgriOverrides).length;

    return {
      ok: true,
      sourceMode: 'live_api',
      configured: true,
      lastSyncedAt: completedAt,
      dataDate: latestDate,
      recordsFetched: rawRecords.length,
      recordsStored: savedSnapshot.insertedCount,
      recordsMatched: savedSnapshot.matchedCount,
      totalCatalogCount,
      liveAgriOverrides,
      rateLimited: false,
      retryAfterSeconds: null,
      fallbackReason: null,
    };
  } catch (err) {
    const completedAt = new Date().toISOString();
    const formatted = formatMarketFetchError(err);

    saveProcessedMarketIntelligence({
      shopId: params.shopId,
      sourceKey: 'agmarknet_ogd',
      sourceName: 'data.gov.in Wholesale Index',
      attemptedAt,
      completedAt,
      status: 'failed',
      dataDate: todayIso,
      recordsFetched: 0,
      normalizedRecords: [],
      httpStatus: null,
      errorCode: formatted.code,
      errorDetails: formatted.message,
      dbAdapter: params.dbAdapter,
      storage: params.storage,
    });

    return {
      ok: true,
      sourceMode: 'enterprise_master_index',
      configured: true,
      lastSyncedAt: completedAt,
      dataDate: todayIso,
      recordsFetched: 0,
      recordsStored: 0,
      recordsMatched: 0,
      totalCatalogCount: catalogBaseline.length,
      liveAgriOverrides: {},
      rateLimited: false,
      retryAfterSeconds: null,
      fallbackReason: formatted.message,
    };
  }
}

/**
 * Filters 10,000+ Master Product SKUs instantly across SKU code, product name, brand,
 * category, pack/weight variant, and standardized supplier tier.
 */
export function filterMasterCatalogSKUs(
  items: MasterProductSKU[],
  search: string,
  categoryFilter: MasterCategoryFilter
): MasterProductSKU[] {
  const tokens = search
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  return items.filter((item) => {
    if (categoryFilter !== 'All SKUs' && item.category !== categoryFilter) {
      return false;
    }
    if (tokens.length === 0) return true;
    const haystack = `${item.skuCode} ${item.name} ${item.brand} ${item.category} ${item.packVariant} ${item.supplierTier}`.toLowerCase();
    return tokens.every((tok) => haystack.includes(tok));
  });
}

export function formatRelativeSyncTime(
  isoTimestamp: string | null | undefined,
  nowMs: number = Date.now()
): string {
  if (!isoTimestamp) return 'Not synced yet';
  const parsed = new Date(isoTimestamp).getTime();
  if (!Number.isFinite(parsed)) return 'Just now';

  const diffSec = Math.max(0, Math.floor((nowMs - parsed) / 1000));
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin === 1) return '1 minute ago';
  if (diffMin < 60) return `${diffMin} minutes ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr === 1) return '1 hour ago';
  if (diffHr < 24) return `${diffHr} hours ago`;
  const diffDay = Math.floor(diffHr / 24);
  return diffDay === 1 ? '1 day ago' : `${diffDay} days ago`;
}
