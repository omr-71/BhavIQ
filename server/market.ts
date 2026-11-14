import crypto from 'node:crypto';
import { db } from './db';
import type {
  BaseUnit,
  FreshnessStatus,
  MarketSyncRun,
  PriceAlert,
  Product,
  ProductUnit,
  RetailCategory,
} from '../src/lib/types';
import { roundCurrency } from '../src/lib/units';
import { calculatePriceForTargetMargin } from '../src/lib/pricing';
import {
  formatMarketFetchError,
  getTodayIsoDate,
  isQuotationExpired,
  matchAgmarknetRecordToProduct,
  type RawAgmarknetRecord,
} from '../src/lib/wholesale';
import { detectDailyMarketAlerts, mergeShopAndMarketAlerts } from '../src/lib/marketAlerts';
import { mapCommodityToAgriKey } from '../src/lib/marketDataService';
import type { LiveAgriRateOverride } from '../src/lib/masterCatalog';

const AGMARKNET_RESOURCE_URL =
  'https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070';

export function loadProductsTypedForShop(shopId: string): Product[] {
  const rows = db
    .prepare(`
      SELECT p.*, s.name as primary_supplier_name
      FROM products p
      LEFT JOIN suppliers s ON s.id = p.primary_supplier_id
      WHERE p.shop_id = ?
      ORDER BY p.name ASC
    `)
    .all(shopId) as Array<Record<string, unknown>>;

  const units = db
    .prepare(`SELECT * FROM product_units WHERE shop_id = ?`)
    .all(shopId) as Array<Record<string, unknown>>;

  const unitMap = new Map<string, ProductUnit[]>();
  for (const u of units) {
    const pid = u.product_id as string;
    const list = unitMap.get(pid) || [];
    list.push({
      id: u.id as string,
      productId: pid,
      unitName: u.unit_name as string,
      conversionToBase: Number(u.conversion_to_base),
      isDefaultSellUnit: Boolean(u.is_default_sell_unit),
      isDefaultBuyUnit: Boolean(u.is_default_buy_unit),
    });
    unitMap.set(pid, list);
  }

  return rows.map((r) => ({
    id: r.id as string,
    shopId: r.shop_id as string,
    name: r.name as string,
    brand: (r.brand as string | null) ?? null,
    packSize: (r.pack_size as string | null) ?? null,
    variety: (r.variety as string | null) ?? null,
    category: r.category as RetailCategory,
    barcode: (r.barcode as string | null) ?? null,
    sku: (r.sku as string | null) ?? null,
    baseUnit: r.base_unit as BaseUnit,
    purchasePrice: r.purchase_price !== null ? Number(r.purchase_price) : null,
    landedCost: r.landed_cost !== null ? Number(r.landed_cost) : null,
    sellingPrice: Number(r.selling_price),
    mrp: r.mrp !== null ? Number(r.mrp) : null,
    taxRatePct: Number(r.tax_rate_pct),
    mrpRestricted: Boolean(r.mrp_restricted),
    currentStock: Number(r.current_stock),
    minStockLevel: Number(r.min_stock_level),
    primarySupplierId: (r.primary_supplier_id as string | null) ?? null,
    primarySupplierName: (r.primary_supplier_name as string | null) ?? null,
    expiryDate: (r.expiry_date as string | null) ?? null,
    batchNumber: (r.batch_number as string | null) ?? null,
    imageUrl: (r.image_url as string | null) ?? null,
    marketCommodityName: (r.market_commodity_name as string | null) ?? null,
    marketCoverageStatus: r.market_coverage_status as Product['marketCoverageStatus'],
    units: unitMap.get(r.id as string) || [],
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  }));
}

export function ensureDefaultPriceSourcesForShop(shopId: string) {
  const apiKeyConfigured = Boolean(process.env.DATA_GOV_IN_API_KEY?.trim());
  const sources = [
    {
      sourceKey: 'agmarknet_ogd',
      name: 'AGMARKNET (data.gov.in Open Government Data)',
      sourceType: 'official_api',
      endpointUrl: AGMARKNET_RESOURCE_URL,
      isConfigured: apiKeyConfigured ? 1 : 0,
      updateFrequency: 'Daily scheduled sync (every 24h) + manual refresh',
      lastSyncStatus: apiKeyConfigured ? 'idle' : 'not_configured',
      coverageNotes:
        'Covers agricultural commodities (vegetables, fruits, grains, pulses, loose commodities) quoted in INR per Quintal (100 kg) and converted to kg/gram. Packaged FMCG goods are excluded.',
    },
    {
      sourceKey: 'verified_supplier_quotes',
      name: 'Verified Supplier Quotations',
      sourceType: 'supplier_feed',
      endpointUrl: null,
      isConfigured: 1,
      updateFrequency: 'On quotation entry',
      lastSyncStatus: 'success',
      coverageNotes:
        'Covers all registered products (Packaged FMCG, Grocery, Household, Personal Care, Beverages, Grains, Pulses) with full landed-cost breakdown and expiry tracking.',
    },
    {
      sourceKey: 'owner_market_observations',
      name: 'Owner-Verified Local Wholesale Observations',
      sourceType: 'manual_observation',
      endpointUrl: null,
      isConfigured: 1,
      updateFrequency: 'Real-time manual entry',
      lastSyncStatus: 'success',
      coverageNotes:
        'Covers local APMC, cash-and-carry, or distributor price observations recorded directly by the shop owner.',
    },
  ];

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO price_sources (
      id, shop_id, source_key, name, source_type, endpoint_url, is_configured,
      update_frequency, last_sync_at, last_sync_status, last_error, coverage_notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const updateCfgStmt = db.prepare(`
    UPDATE price_sources
    SET is_configured = ?,
        update_frequency = 'Daily scheduled sync (every 24h) + manual refresh',
        last_sync_status = CASE
          WHEN ? = 0 THEN 'not_configured'
          ELSE CASE WHEN last_sync_status = 'not_configured' THEN 'idle' ELSE last_sync_status END
        END
    WHERE shop_id = ? AND source_key = 'agmarknet_ogd'
  `);

  for (const s of sources) {
    insertStmt.run(
      crypto.randomUUID(),
      shopId,
      s.sourceKey,
      s.name,
      s.sourceType,
      s.endpointUrl,
      s.isConfigured,
      s.updateFrequency,
      null,
      s.lastSyncStatus,
      null,
      s.coverageNotes
    );
  }
  updateCfgStmt.run(apiKeyConfigured ? 1 : 0, apiKeyConfigured ? 1 : 0, shopId);
}

function classifyFreshness(arrivalDateRaw: string): FreshnessStatus {
  const parsed = parseAgmarknetDate(arrivalDateRaw);
  if (!parsed) return 'latest_available';
  const nowIst = new Date(Date.now() + 5.5 * 3600 * 1000);
  const todayStr = nowIst.toISOString().slice(0, 10);
  const yesterdayStr = new Date(nowIst.getTime() - 86400 * 1000).toISOString().slice(0, 10);

  if (parsed === todayStr) return 'updated_today';
  if (parsed === yesterdayStr) return 'yesterday';
  return 'latest_available';
}

function parseAgmarknetDate(raw?: string): string | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const iso = new Date(raw);
  if (!Number.isNaN(iso.getTime())) return iso.toISOString().slice(0, 10);
  return null;
}

function recordSyncRun(run: Omit<MarketSyncRun, 'id'>) {
  db.prepare(`
    INSERT INTO market_sync_runs (
      id, shop_id, source_key, source_name, trigger_type, status,
      attempted_at, completed_at, data_date, records_fetched, records_inserted,
      records_matched, http_status, error_code, error_details
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    run.shopId,
    run.sourceKey,
    run.sourceName,
    run.triggerType,
    run.status,
    run.attemptedAt,
    run.completedAt,
    run.dataDate,
    run.recordsFetched,
    run.recordsInserted,
    run.recordsMatched,
    run.httpStatus,
    run.errorCode,
    run.errorDetails
  );
}

export async function syncAgmarknetForShop(params: {
  shopId: string;
  commodity?: string;
  state?: string;
  limit?: number;
  triggerType?: 'manual' | 'scheduled';
}): Promise<{
  ok: boolean;
  configured: boolean;
  recordsFetched: number;
  insertedCount: number;
  recordsMatched: number;
  dataDate: string | null;
  errorCode: string | null;
  message: string;
}> {
  ensureDefaultPriceSourcesForShop(params.shopId);
  const apiKey = process.env.DATA_GOV_IN_API_KEY?.trim();
  const attemptedAt = new Date().toISOString();
  const triggerType = params.triggerType || 'manual';

  const source = db
    .prepare(`SELECT * FROM price_sources WHERE shop_id = ? AND source_key = 'agmarknet_ogd'`)
    .get(params.shopId) as Record<string, unknown> | undefined;

  if (!source) {
    return {
      ok: false,
      configured: false,
      recordsFetched: 0,
      insertedCount: 0,
      recordsMatched: 0,
      dataDate: null,
      errorCode: 'SOURCE_NOT_INITIALIZED',
      message: 'Source record not initialized.',
    };
  }

  const sourceName = String(source.name || 'AGMARKNET (data.gov.in Open Government Data)');

  if (!apiKey) {
    const errMsg =
      'DATA_GOV_IN_API_KEY is not configured in server environment. Add DATA_GOV_IN_API_KEY to enable live AGMARKNET APMC mandi sync.';
    db.prepare(`
      UPDATE price_sources
      SET is_configured = 0,
          last_attempted_at = ?,
          last_sync_status = 'not_configured',
          last_error = ?
      WHERE id = ?
    `).run(attemptedAt, errMsg, source.id as string);

    recordSyncRun({
      shopId: params.shopId,
      sourceKey: 'agmarknet_ogd',
      sourceName,
      triggerType,
      status: 'not_configured',
      attemptedAt,
      completedAt: new Date().toISOString(),
      dataDate: null,
      recordsFetched: 0,
      recordsInserted: 0,
      recordsMatched: 0,
      httpStatus: null,
      errorCode: 'MISSING_API_KEY',
      errorDetails: errMsg,
    });

    return {
      ok: false,
      configured: false,
      recordsFetched: 0,
      insertedCount: 0,
      recordsMatched: 0,
      dataDate: null,
      errorCode: 'MISSING_API_KEY',
      message: errMsg,
    };
  }

  const url = new URL(AGMARKNET_RESOURCE_URL);
  url.searchParams.set('api-key', apiKey);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', String(params.limit ?? 100));
  if (params.commodity?.trim()) {
    url.searchParams.set('filters[commodity]', params.commodity.trim());
  }
  if (params.state?.trim()) {
    url.searchParams.set('filters[state]', params.state.trim());
  }

  try {
    const resp = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'BhavIQ-Retail-MarketSync/1.0',
      },
      signal: AbortSignal.timeout(12000),
    });

    const completedAt = new Date().toISOString();

    if (!resp.ok) {
      const rawBody = await resp.text().catch(() => '');
      const snippet = rawBody.replace(/\s+/g, ' ').trim().slice(0, 220);
      const retryAfter = resp.headers.get('retry-after');
      const msg = [
        `AGMARKNET API responded with HTTP ${resp.status} ${resp.statusText || ''}`.trim(),
        retryAfter ? `Retry-After: ${retryAfter}s` : null,
        snippet ? `Response: ${snippet}` : null,
      ]
        .filter(Boolean)
        .join(' · ');

      db.prepare(`
        UPDATE price_sources
        SET last_attempted_at = ?,
            last_sync_status = 'failed',
            last_error = ?,
            last_records_fetched = 0,
            last_records_matched = 0
        WHERE id = ?
      `).run(attemptedAt, msg, source.id as string);

      recordSyncRun({
        shopId: params.shopId,
        sourceKey: 'agmarknet_ogd',
        sourceName,
        triggerType,
        status: 'failed',
        attemptedAt,
        completedAt,
        dataDate: null,
        recordsFetched: 0,
        recordsInserted: 0,
        recordsMatched: 0,
        httpStatus: resp.status,
        errorCode: `HTTP_${resp.status}`,
        errorDetails: msg,
      });

      return {
        ok: false,
        configured: true,
        recordsFetched: 0,
        insertedCount: 0,
        recordsMatched: 0,
        dataDate: null,
        errorCode: `HTTP_${resp.status}`,
        message: msg,
      };
    }

    const payload = (await resp.json()) as {
      records?: RawAgmarknetRecord[];
      status?: string;
      message?: string;
      error?: string;
    };

    if (payload.error || (payload.status && payload.status.toLowerCase() === 'error')) {
      const msg = `AGMARKNET API returned error payload: ${payload.error || payload.message || 'Unknown API error'}`;
      db.prepare(`
        UPDATE price_sources
        SET last_attempted_at = ?,
            last_sync_status = 'failed',
            last_error = ?
        WHERE id = ?
      `).run(attemptedAt, msg, source.id as string);

      recordSyncRun({
        shopId: params.shopId,
        sourceKey: 'agmarknet_ogd',
        sourceName,
        triggerType,
        status: 'failed',
        attemptedAt,
        completedAt,
        dataDate: null,
        recordsFetched: 0,
        recordsInserted: 0,
        recordsMatched: 0,
        httpStatus: resp.status,
        errorCode: 'API_ERROR_PAYLOAD',
        errorDetails: msg,
      });

      return {
        ok: false,
        configured: true,
        recordsFetched: 0,
        insertedCount: 0,
        recordsMatched: 0,
        dataDate: null,
        errorCode: 'API_ERROR_PAYLOAD',
        message: msg,
      };
    }

    const records = Array.isArray(payload.records) ? payload.records : [];
    const shopRow = db.prepare(`SELECT state FROM shops WHERE id = ?`).get(params.shopId) as
      | { state: string }
      | undefined;
    const shopProducts = loadProductsTypedForShop(params.shopId);

    const existingDupStmt = db.prepare(`
      SELECT id FROM market_prices
      WHERE shop_id = ?
        AND source_id = ?
        AND commodity_or_product_name = ?
        AND COALESCE(brand, '') = ?
        AND market_name = ?
        AND observation_date = ?
      LIMIT 1
    `);

    const prevStmt = db.prepare(`
      SELECT modal_price FROM market_prices
      WHERE shop_id = ?
        AND commodity_or_product_name = ?
        AND COALESCE(brand, '') = ?
        AND market_name = ?
      ORDER BY observation_date DESC, created_at DESC
      LIMIT 1
    `);

    const insertStmt = db.prepare(`
      INSERT INTO market_prices (
        id, shop_id, source_id, product_id, commodity_or_product_name, brand, pack_size, unit,
        market_name, state, district, location, min_price, max_price, modal_price, previous_price,
        price_unit_basis, normalized_per_base_unit, observation_date, freshness_status,
        verification_status, confidence_level, raw_payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let insertedCount = 0;
    let recordsMatched = 0;
    let latestDataDate: string | null = null;

    for (const rec of records) {
      const commodity = (rec.commodity || '').trim();
      const variety = (rec.variety || '').trim();
      const marketName = (rec.market || '').trim();
      const modal = Number(rec.modal_price);
      if (!commodity || !marketName || !Number.isFinite(modal) || modal <= 0) continue;

      const obsDate = parseAgmarknetDate(rec.arrival_date) || completedAt.slice(0, 10);
      if (!latestDataDate || obsDate > latestDataDate) {
        latestDataDate = obsDate;
      }

      const matchResult = matchAgmarknetRecordToProduct(
        rec,
        shopProducts,
        params.state || shopRow?.state || null
      );
      if (matchResult) {
        recordsMatched++;
      }

      const dup = existingDupStmt.get(
        params.shopId,
        source.id as string,
        commodity,
        variety,
        marketName,
        obsDate
      );
      if (dup) continue;

      const prevRow = prevStmt.get(params.shopId, commodity, variety, marketName) as
        | { modal_price: number }
        | undefined;

      // Convert INR per Quintal (100 kg) accurately to matched product base unit or default Kilogram
      const normalized =
        matchResult?.normalizedPerBaseUnit ?? roundCurrency(modal / 100);
      const unitLabel = matchResult?.product.baseUnit ?? 'Kilogram';
      const location = [rec.district, rec.state].filter(Boolean).join(', ') || marketName;
      const freshness = classifyFreshness(rec.arrival_date || '');

      insertStmt.run(
        crypto.randomUUID(),
        params.shopId,
        source.id as string,
        matchResult?.product.id ?? null,
        commodity,
        variety || null,
        '100 Kg (1 Quintal)',
        unitLabel,
        marketName,
        rec.state || null,
        rec.district || null,
        location,
        Number.isFinite(Number(rec.min_price)) ? Number(rec.min_price) : null,
        Number.isFinite(Number(rec.max_price)) ? Number(rec.max_price) : null,
        modal,
        prevRow ? prevRow.modal_price : null,
        'INR per Quintal (100 kg)',
        normalized,
        obsDate,
        freshness,
        'verified_official',
        matchResult ? 'high' : 'medium',
        JSON.stringify(rec),
        completedAt
      );
      insertedCount++;
    }

    db.prepare(`
      UPDATE price_sources
      SET is_configured = 1,
          last_sync_at = ?,
          last_attempted_at = ?,
          last_data_date = ?,
          last_records_fetched = ?,
          last_records_matched = ?,
          last_sync_status = 'success',
          last_error = NULL
      WHERE id = ?
    `).run(
      completedAt,
      attemptedAt,
      latestDataDate,
      records.length,
      recordsMatched,
      source.id as string
    );

    recordSyncRun({
      shopId: params.shopId,
      sourceKey: 'agmarknet_ogd',
      sourceName,
      triggerType,
      status: 'success',
      attemptedAt,
      completedAt,
      dataDate: latestDataDate,
      recordsFetched: records.length,
      recordsInserted: insertedCount,
      recordsMatched,
      httpStatus: resp.status,
      errorCode: null,
      errorDetails: null,
    });

    return {
      ok: true,
      configured: true,
      recordsFetched: records.length,
      insertedCount,
      recordsMatched,
      dataDate: latestDataDate,
      errorCode: null,
      message: `Fetched ${records.length} AGMARKNET records (${insertedCount} new observations, ${recordsMatched} matched to shop products).`,
    };
  } catch (err) {
    const completedAt = new Date().toISOString();
    const formatted = formatMarketFetchError(err);

    db.prepare(`
      UPDATE price_sources
      SET last_attempted_at = ?,
          last_sync_status = 'failed',
          last_error = ?,
          last_records_fetched = 0,
          last_records_matched = 0
      WHERE id = ?
    `).run(attemptedAt, formatted.message, source.id as string);

    recordSyncRun({
      shopId: params.shopId,
      sourceKey: 'agmarknet_ogd',
      sourceName,
      triggerType,
      status: 'failed',
      attemptedAt,
      completedAt,
      dataDate: null,
      recordsFetched: 0,
      recordsInserted: 0,
      recordsMatched: 0,
      httpStatus: null,
      errorCode: formatted.code,
      errorDetails: formatted.message,
    });

    return {
      ok: false,
      configured: true,
      recordsFetched: 0,
      insertedCount: 0,
      recordsMatched: 0,
      dataDate: null,
      errorCode: formatted.code,
      message: formatted.message,
    };
  }
}

/**
 * Real daily backend scheduler for AGMARKNET synchronization.
 * Checks hourly whether any shop with DATA_GOV_IN_API_KEY configured has missed its 24h sync window.
 */
let schedulerHandle: ReturnType<typeof setInterval> | null = null;

export function startMarketScheduler() {
  if (schedulerHandle) return;

  const runDailyCheck = async () => {
    const apiKey = process.env.DATA_GOV_IN_API_KEY?.trim();
    if (!apiKey) return;

    const shops = db.prepare(`SELECT id, state FROM shops`).all() as Array<{
      id: string;
      state: string;
    }>;
    const cutoffIso = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

    for (const s of shops) {
      ensureDefaultPriceSourcesForShop(s.id);
      const src = db
        .prepare(`
          SELECT last_attempted_at FROM price_sources
          WHERE shop_id = ? AND source_key = 'agmarknet_ogd'
        `)
        .get(s.id) as { last_attempted_at: string | null } | undefined;

      if (!src?.last_attempted_at || src.last_attempted_at < cutoffIso) {
        await syncAgmarknetForShop({
          shopId: s.id,
          state: s.state,
          limit: 100,
          triggerType: 'scheduled',
        });
      }
    }
  };

  // Run first check 15 seconds after server boot, then every 60 minutes for 24h overdue check
  setTimeout(() => {
    void runDailyCheck();
  }, 15000);

  schedulerHandle = setInterval(() => {
    void runDailyCheck();
  }, 60 * 60 * 1000);
}

function loadLiveAgriOverridesFromDb(shopId: string): Record<string, LiveAgriRateOverride> {
  const rows = db
    .prepare(`
      SELECT mp.commodity_or_product_name, mp.modal_price, mp.previous_price, mp.observation_date
      FROM market_prices mp
      JOIN price_sources ps ON ps.id = mp.source_id
      WHERE mp.shop_id = ?
        AND ps.source_key = 'agmarknet_ogd'
      ORDER BY mp.observation_date DESC, mp.created_at DESC
      LIMIT 120
    `)
    .all(shopId) as Array<{
    commodity_or_product_name: string;
    modal_price: number;
    previous_price: number | null;
    observation_date: string;
  }>;

  const overrides: Record<string, LiveAgriRateOverride> = {};
  for (const r of rows) {
    const key = mapCommodityToAgriKey(r.commodity_or_product_name);
    if (!key || overrides[key]) continue;
    const modalPerKg = Number(r.modal_price);
    if (!Number.isFinite(modalPerKg) || modalPerKg <= 0) continue;
    // AGMARKNET table stores modal_price per quintal in syncAgmarknetForShop or per kg in marketFeed
    const normalizedKg = modalPerKg > 500 ? roundCurrency(modalPerKg / 100) : roundCurrency(modalPerKg);
    const prevRaw = r.previous_price !== null ? Number(r.previous_price) : normalizedKg;
    const prevKg = prevRaw > 500 ? roundCurrency(prevRaw / 100) : roundCurrency(prevRaw);
    overrides[key] = {
      pricePerKg: normalizedKg,
      previousPricePerKg: prevKg > 0 ? prevKg : normalizedKg,
      arrivalDate: r.observation_date,
    };
  }
  return overrides;
}

export function getMarketAlertsStateForShop(
  shopId: string,
  defaultMarginPct = 15
): { activeAlerts: PriceAlert[]; acknowledgedAlerts: PriceAlert[] } {
  const shopProducts = loadProductsTypedForShop(shopId);
  const products = db
    .prepare(`SELECT * FROM products WHERE shop_id = ?`)
    .all(shopId) as Array<Record<string, unknown>>;

  const todayDate = getTodayIsoDate();
  const inventoryAlerts: PriceAlert[] = [];

  for (const prod of products) {
    const productId = prod.id as string;
    const productName = prod.name as string;
    const brand = (prod.brand as string | null) ?? null;
    const packSize = (prod.pack_size as string | null) ?? null;
    const category = (prod.category as string) || 'Grocery';
    const baseUnit = (prod.base_unit as string) || 'Piece';
    const historicalLanded = prod.landed_cost !== null ? Number(prod.landed_cost) : null;
    const currentSelling = Number(prod.selling_price);
    const mrp = prod.mrp !== null ? Number(prod.mrp) : null;
    const mrpRestricted = Boolean(prod.mrp_restricted);
    const isLoose =
      category !== 'Packaged FMCG' &&
      !mrpRestricted &&
      mrp === null &&
      (baseUnit === 'Kilogram' || baseUnit === 'Gram');

    const quoteRows = db
      .prepare(`
        SELECT q.*, s.name as supplier_name
        FROM supplier_quotations q
        JOIN suppliers s ON s.id = q.supplier_id
        WHERE q.shop_id = ? AND q.product_id = ?
        ORDER BY COALESCE(q.final_landed_cost, q.landed_estimate) ASC, q.quotation_date DESC
      `)
      .all(shopId, productId) as Array<Record<string, unknown>>;

    // Exclude expired quotations from replacement-cost alerts
    const lowestValidQuote = quoteRows.find(
      (q) => !isQuotationExpired((q.valid_until as string | null) ?? null, todayDate)
    );

    const latestMarket = db
      .prepare(`
        SELECT m.*, ps.name as source_name
        FROM market_prices m
        JOIN price_sources ps ON ps.id = m.source_id
        WHERE m.shop_id = ? AND m.product_id = ?
        ORDER BY m.observation_date DESC, m.created_at DESC
        LIMIT 1
      `)
      .get(shopId, productId) as Record<string, unknown> | undefined;

    let replacementCost: number | null = null;
    let sourceLabel = '';
    let timestamp = '';

    if (lowestValidQuote) {
      replacementCost = Number(
        lowestValidQuote.final_landed_cost ?? lowestValidQuote.landed_estimate
      );
      sourceLabel = `Supplier Quote · ${lowestValidQuote.supplier_name as string}`;
      timestamp = lowestValidQuote.quotation_date as string;
    } else if (latestMarket && latestMarket.normalized_per_base_unit !== null) {
      replacementCost = Number(latestMarket.normalized_per_base_unit);
      sourceLabel = `${latestMarket.source_name as string} · ${latestMarket.market_name as string}`;
      timestamp = latestMarket.observation_date as string;
    }

    if (replacementCost === null || replacementCost <= 0) continue;

    const suggested = calculatePriceForTargetMargin(
      replacementCost,
      defaultMarginPct,
      mrp,
      mrpRestricted
    );
    const officialMrp = isLoose ? null : mrp;
    const changePct =
      historicalLanded && historicalLanded > 0
        ? roundCurrency(((replacementCost - historicalLanded) / historicalLanded) * 100)
        : null;
    const marginBeforePct =
      !isLoose && currentSelling > 0 && historicalLanded !== null
        ? roundCurrency(((currentSelling - historicalLanded) / currentSelling) * 100)
        : null;
    const marginAfterPct =
      !isLoose && currentSelling > 0
        ? roundCurrency(((currentSelling - replacementCost) / currentSelling) * 100)
        : null;

    if (currentSelling < replacementCost) {
      const shortfall = roundCurrency(replacementCost - currentSelling);
      inventoryAlerts.push({
        id: `below-replacement-${productId}`,
        alertKind: 'inventory_replacement',
        productId,
        skuCode: (prod.sku as string | null) ?? null,
        category,
        packVariant: packSize,
        isLoose,
        productName,
        brand,
        severity: 'critical',
        movementDirection: 'up',
        changePct,
        previousWholesaleRate: historicalLanded,
        currentWholesaleRate: replacementCost,
        ratePerKg: isLoose ? replacementCost : null,
        previousRatePerKg: isLoose ? historicalLanded : null,
        ratePerQuintal: isLoose ? roundCurrency(replacementCost * 100) : null,
        previousRatePerQuintal:
          isLoose && historicalLanded !== null ? roundCurrency(historicalLanded * 100) : null,
        officialMrp,
        marginBeforePct,
        marginAfterPct,
        replacementImpactSummary: `Selling ₹${currentSelling.toFixed(2)} is -₹${shortfall.toFixed(2)} below replacement ₹${replacementCost.toFixed(2)}`,
        title: `Selling below replacement cost (-₹${shortfall.toFixed(2)})`,
        reason: `Current selling price ₹${currentSelling.toFixed(2)} cannot cover lowest valid replacement landed cost ₹${replacementCost.toFixed(2)}.`,
        source: sourceLabel,
        timestamp,
        historicalLandedCost: historicalLanded,
        replacementLandedCost: replacementCost,
        currentSellingPrice: currentSelling,
        recommendedPrice: isLoose ? null : suggested.suggestedPrice,
        calculationDetail: `Replacement ₹${replacementCost.toFixed(2)} - Selling ₹${currentSelling.toFixed(2)} = -₹${shortfall.toFixed(2)} loss on restock`,
      });
    } else if (historicalLanded !== null && replacementCost > historicalLanded * 1.03) {
      const pctIncrease = roundCurrency(((replacementCost - historicalLanded) / historicalLanded) * 100);
      inventoryAlerts.push({
        id: `cost-rise-${productId}`,
        alertKind: 'inventory_replacement',
        productId,
        skuCode: (prod.sku as string | null) ?? null,
        category,
        packVariant: packSize,
        isLoose,
        productName,
        brand,
        severity: 'warning',
        movementDirection: 'up',
        changePct: pctIncrease,
        previousWholesaleRate: historicalLanded,
        currentWholesaleRate: replacementCost,
        ratePerKg: isLoose ? replacementCost : null,
        previousRatePerKg: isLoose ? historicalLanded : null,
        ratePerQuintal: isLoose ? roundCurrency(replacementCost * 100) : null,
        previousRatePerQuintal: isLoose ? roundCurrency(historicalLanded * 100) : null,
        officialMrp,
        marginBeforePct,
        marginAfterPct,
        replacementImpactSummary: isLoose
          ? `Replacement cost up +₹${(replacementCost - historicalLanded).toFixed(2)}/kg vs historical`
          : `Margin compressed ${marginBeforePct?.toFixed(1) ?? '—'}% → ${marginAfterPct?.toFixed(1) ?? '—'}%`,
        title: `Replacement cost increased by ${pctIncrease.toFixed(1)}%`,
        reason: `Cost moved from historical ₹${historicalLanded.toFixed(2)} to replacement ₹${replacementCost.toFixed(2)}.`,
        source: sourceLabel,
        timestamp,
        historicalLandedCost: historicalLanded,
        replacementLandedCost: replacementCost,
        currentSellingPrice: currentSelling,
        recommendedPrice: isLoose ? null : suggested.suggestedPrice,
        calculationDetail: `(${replacementCost.toFixed(2)} - ${historicalLanded.toFixed(2)}) / ${historicalLanded.toFixed(2)} × 100 = +${pctIncrease.toFixed(1)}%`,
      });
    } else if (historicalLanded !== null && replacementCost < historicalLanded * 0.96) {
      const pctDrop = roundCurrency(((historicalLanded - replacementCost) / historicalLanded) * 100);
      inventoryAlerts.push({
        id: `cost-drop-${productId}`,
        alertKind: 'inventory_replacement',
        productId,
        skuCode: (prod.sku as string | null) ?? null,
        category,
        packVariant: packSize,
        isLoose,
        productName,
        brand,
        severity: 'opportunity',
        movementDirection: 'down',
        changePct: -pctDrop,
        previousWholesaleRate: historicalLanded,
        currentWholesaleRate: replacementCost,
        ratePerKg: isLoose ? replacementCost : null,
        previousRatePerKg: isLoose ? historicalLanded : null,
        ratePerQuintal: isLoose ? roundCurrency(replacementCost * 100) : null,
        previousRatePerQuintal: isLoose ? roundCurrency(historicalLanded * 100) : null,
        officialMrp,
        marginBeforePct,
        marginAfterPct,
        replacementImpactSummary: `Restock savings of ₹${(historicalLanded - replacementCost).toFixed(2)} per unit`,
        title: `Lower wholesale rate available (-${pctDrop.toFixed(1)}%)`,
        reason: `Available valid replacement cost ₹${replacementCost.toFixed(2)} is below historical landed cost ₹${historicalLanded.toFixed(2)}.`,
        source: sourceLabel,
        timestamp,
        historicalLandedCost: historicalLanded,
        replacementLandedCost: replacementCost,
        currentSellingPrice: currentSelling,
        recommendedPrice: isLoose ? null : suggested.suggestedPrice,
        calculationDetail: `Potential restock savings of ₹${(historicalLanded - replacementCost).toFixed(2)} per unit`,
      });
    }
  }

  const liveOverrides = loadLiveAgriOverridesFromDb(shopId);
  const marketAlerts = detectDailyMarketAlerts({
    todayIso: todayDate,
    liveAgriOverrides: liveOverrides,
    shopProducts,
    defaultMarginPct,
    includeAcknowledged: true,
    maxAlerts: 12,
  });

  const ackRows = db
    .prepare(`SELECT alert_id, acknowledged_at FROM acknowledged_market_alerts WHERE shop_id = ?`)
    .all(shopId) as Array<{ alert_id: string; acknowledged_at: string }>;
  const acknowledgedMap = new Map(ackRows.map((r) => [r.alert_id, r.acknowledged_at]));

  return mergeShopAndMarketAlerts({
    inventoryAlerts,
    marketAlerts,
    acknowledgedMap,
  });
}

export function computePriceAlertsForShop(shopId: string, defaultMarginPct = 15): PriceAlert[] {
  return getMarketAlertsStateForShop(shopId, defaultMarginPct).activeAlerts;
}
