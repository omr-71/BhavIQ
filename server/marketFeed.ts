import crypto from 'node:crypto';
import { db } from './db';
import { ensureDefaultPriceSourcesForShop, loadProductsTypedForShop } from './market';
import {
  syncMarketRates,
  type ShopMarketDbAdapter,
  type SyncMarketRatesResponse,
} from '../src/lib/marketDataService';

interface CachedFeedEntry {
  fetchedAtMs: number;
  response: SyncMarketRatesResponse;
}

const feedCacheByShop = new Map<string, CachedFeedEntry>();
const CACHE_TTL_MS = 60 * 1000;

export function createSqliteMarketDbAdapter(
  shopId: string,
  triggerType: 'manual' | 'scheduled' = 'manual'
): ShopMarketDbAdapter {
  return {
    shopId,
    saveNormalizedMarketRates: (params) => {
      ensureDefaultPriceSourcesForShop(shopId);
      const source = db
        .prepare(`SELECT id FROM price_sources WHERE shop_id = ? AND source_key = ?`)
        .get(shopId, params.sourceKey) as { id: string } | undefined;

      if (!source) {
        return { insertedCount: 0, matchedCount: 0 };
      }

      if (params.status !== 'success') {
        db.prepare(`
          UPDATE price_sources
          SET last_attempted_at = ?,
              last_sync_status = ?,
              last_error = ?,
              is_configured = ?
          WHERE id = ?
        `).run(
          params.attemptedAt,
          params.status,
          params.errorDetails,
          params.status === 'not_configured' ? 0 : 1,
          source.id
        );

        db.prepare(`
          INSERT INTO market_sync_runs (
            id, shop_id, source_key, source_name, trigger_type, status,
            attempted_at, completed_at, data_date, records_fetched, records_inserted,
            records_matched, http_status, error_code, error_details
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)
        `).run(
          crypto.randomUUID(),
          shopId,
          params.sourceKey,
          params.sourceName,
          triggerType,
          params.status,
          params.attemptedAt,
          params.completedAt,
          params.dataDate,
          params.recordsFetched,
          params.httpStatus,
          params.errorCode,
          params.errorDetails
        );

        return { insertedCount: 0, matchedCount: 0 };
      }

      const shopProducts = loadProductsTypedForShop(shopId);

      const dupStmt = db.prepare(`
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
        ORDER BY observation_date DESC, created_at DESC
        LIMIT 1
      `);

      const insertStmt = db.prepare(`
        INSERT INTO market_prices (
          id, shop_id, source_id, product_id, commodity_or_product_name, brand, pack_size, unit,
          market_name, state, district, location, min_price, max_price, modal_price, previous_price,
          price_unit_basis, normalized_per_base_unit, observation_date, freshness_status,
          verification_status, confidence_level, raw_payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'verified_official', ?, ?, ?)
      `);

      let insertedCount = 0;
      let matchedCount = 0;

      for (const rec of params.normalizedRecords) {
        const matchedProd = shopProducts.find((p) => {
          if (p.category === 'Packaged FMCG') return false;
          const mc = (p.marketCommodityName || p.name).toLowerCase();
          return (
            mc.includes(rec.commodityName.toLowerCase()) ||
            rec.commodityName.toLowerCase().includes(mc)
          );
        });

        if (matchedProd) matchedCount++;

        const dup = dupStmt.get(
          shopId,
          source.id,
          rec.commodityName,
          rec.variety || '',
          rec.supplierTier,
          rec.observationDate
        );
        if (dup) continue;

        const prevRow = prevStmt.get(
          shopId,
          rec.commodityName,
          rec.variety || ''
        ) as { modal_price: number } | undefined;

        insertStmt.run(
          crypto.randomUUID(),
          shopId,
          source.id,
          matchedProd?.id ?? null,
          rec.commodityName,
          rec.variety,
          '1 Kg Standard',
          'Kilogram',
          rec.supplierTier,
          'Enterprise Benchmark',
          rec.minPerKg,
          rec.maxPerKg,
          rec.modalPerKg,
          prevRow ? prevRow.modal_price : rec.previousPerKg,
          'INR per Kilogram (normalized from Quintal)',
          rec.modalPerKg,
          rec.observationDate,
          'updated_today',
          matchedProd ? 'high' : 'medium',
          rec.rawPayloadJson,
          params.completedAt
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
        params.completedAt,
        params.attemptedAt,
        params.dataDate,
        params.recordsFetched,
        matchedCount,
        source.id
      );

      db.prepare(`
        INSERT INTO market_sync_runs (
          id, shop_id, source_key, source_name, trigger_type, status,
          attempted_at, completed_at, data_date, records_fetched, records_inserted,
          records_matched, http_status, error_code, error_details
        ) VALUES (?, ?, ?, ?, ?, 'success', ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
      `).run(
        crypto.randomUUID(),
        shopId,
        params.sourceKey,
        params.sourceName,
        triggerType,
        params.attemptedAt,
        params.completedAt,
        params.dataDate,
        params.recordsFetched,
        insertedCount,
        matchedCount,
        params.httpStatus
      );

      return { insertedCount, matchedCount };
    },
  };
}

export async function fetchLiveMasterMatrixFeed(params: {
  shopId: string;
  state?: string;
  commodity?: string;
  forceRefresh?: boolean;
  triggerType?: 'manual' | 'scheduled';
}): Promise<SyncMarketRatesResponse> {
  const cacheKey = `${params.shopId}:${(params.commodity || 'all').toLowerCase()}`;
  const nowMs = Date.now();
  const existing = feedCacheByShop.get(cacheKey);
  if (!params.forceRefresh && existing && nowMs - existing.fetchedAtMs < CACHE_TTL_MS) {
    return existing.response;
  }

  const hasApiKey = Boolean(process.env.DATA_GOV_IN_API_KEY?.trim());
  // Persist sync audit rows on explicit Sync Now / scheduled 24h runs, or when live API is configured
  const shouldLogRun = Boolean(params.forceRefresh || hasApiKey);
  const dbAdapter = shouldLogRun
    ? createSqliteMarketDbAdapter(params.shopId, params.triggerType || 'manual')
    : undefined;

  const response = await syncMarketRates({
    shopId: params.shopId,
    state: params.state,
    commodity: params.commodity,
    apiKey: process.env.DATA_GOV_IN_API_KEY,
    dbAdapter,
  });

  feedCacheByShop.set(cacheKey, { fetchedAtMs: nowMs, response });
  return response;
}

let dailySchedulerHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Backend 24-hour scheduler calling syncMarketRates for each shop and logging
 * every scheduled success, HTTP 429/network failure, or unconfigured state to SQLite.
 */
export function startDailyMarketScheduler() {
  if (dailySchedulerHandle) return;

  const runDailyCheck = async () => {
    const shops = db.prepare(`SELECT id, state FROM shops`).all() as Array<{
      id: string;
      state: string;
    }>;
    const cutoffIso = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

    for (const s of shops) {
      ensureDefaultPriceSourcesForShop(s.id);
      const lastScheduled = db
        .prepare(`
          SELECT attempted_at FROM market_sync_runs
          WHERE shop_id = ? AND trigger_type = 'scheduled'
          ORDER BY attempted_at DESC
          LIMIT 1
        `)
        .get(s.id) as { attempted_at: string | null } | undefined;

      if (!lastScheduled?.attempted_at || lastScheduled.attempted_at < cutoffIso) {
        await fetchLiveMasterMatrixFeed({
          shopId: s.id,
          state: s.state,
          forceRefresh: true,
          triggerType: 'scheduled',
        });
      }
    }
  };

  setTimeout(() => {
    void runDailyCheck();
  }, 10000);

  dailySchedulerHandle = setInterval(() => {
    void runDailyCheck();
  }, 60 * 60 * 1000);
}
