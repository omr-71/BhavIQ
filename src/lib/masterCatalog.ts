import { roundCurrency } from './units';
import {
  MASTER_CATEGORY_FILTERS,
  type MasterCategory,
  type MasterCategoryFilter,
  type MasterProductSKU,
  type SupplierTierLabel,
} from './catalog/types';
import { FMCG_CATALOG_FAMILIES } from './catalog/fmcgLines';
import { STAPLES_AND_LOOSE_FAMILIES } from './catalog/staplesLooseLines';

export {
  MASTER_CATEGORY_FILTERS,
  type MasterCategory,
  type MasterCategoryFilter,
  type MasterProductSKU,
  type SupplierTierLabel,
};

const ALL_CATALOG_FAMILIES = [...FMCG_CATALOG_FAMILIES, ...STAPLES_AND_LOOSE_FAMILIES];

const CATEGORY_ORDER_MAP = new Map<MasterCategory, number>(
  MASTER_CATEGORY_FILTERS.filter((c): c is MasterCategory => c !== 'All SKUs').map((c, idx) => [c, idx])
);

// Official Indian retail consumer packet MRP denominations (no arbitrary fractional decimals)
const INDIAN_PACKET_MRP_LADDER: number[] = [
  2, 5, 10, 12, 14, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 99, 100,
  110, 115, 120, 125, 130, 135, 140, 145, 150, 160, 165, 175, 180, 190, 199, 200, 210, 220, 225,
  230, 240, 250, 260, 275, 280, 290, 299, 300,
];

/**
 * Snaps a scaled consumer pack value to authentic Indian printed MRP price points.
 */
export function snapToIndianPacketMrp(rawMrp: number): number {
  if (!Number.isFinite(rawMrp) || rawMrp <= 3) return 5;
  if (rawMrp <= 8.2) return 5;
  if (rawMrp <= 300) {
    let best = INDIAN_PACKET_MRP_LADDER[0];
    let bestDist = Math.abs(rawMrp - best);
    for (let i = 1; i < INDIAN_PACKET_MRP_LADDER.length; i++) {
      const candidate = INDIAN_PACKET_MRP_LADDER[i];
      const dist = Math.abs(rawMrp - candidate);
      if (dist < bestDist) {
        best = candidate;
        bestDist = dist;
      }
    }
    return best;
  }
  if (rawMrp <= 600) return Math.max(305, Math.round(rawMrp / 5) * 5);
  if (rawMrp <= 1500) return Math.round(rawMrp / 10) * 10;
  if (rawMrp <= 5000) return Math.round(rawMrp / 25) * 25;
  return Math.round(rawMrp / 50) * 50;
}

function clampNumber(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

function deterministicHash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Shifts a YYYY-MM-DD calendar string cleanly by deltaDays (for 24h cycle comparison).
 */
export function shiftIsoDate(dayIso: string, deltaDays: number): string {
  const match = dayIso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const baseMs = match
    ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : Date.now();
  return new Date(baseMs + deltaDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * Computes realistic daily market variance (+/- %) per 24-hour cycle for a given SKU & category.
 * Loose commodities, oils, and pulses fluctuate up to ~2.6%; fixed-MRP packaged FMCG trade schemes fluctuate tighter (~0.65%).
 */
export function computeDailyVarianceFactor(
  seedKey: string,
  dayIso: string,
  category: MasterCategory
): number {
  const maxSwingPct =
    category === 'Loose Items' || category === 'Edible Oils' || category === 'Pulses'
      ? 2.6
      : category === 'Staple Grains' || category === 'Spices'
        ? 1.8
        : 0.65;

  const h = deterministicHash(`${seedKey}|${dayIso}`);
  const normalizedSigned = (h % 2001) / 1000 - 1; // [-1, +1]
  return 1 + (normalizedSigned * maxSwingPct) / 100;
}

function buildSparkline(seed: string, current: number, prev: number): number[] {
  const h = deterministicHash(seed);
  const pts: number[] = [];
  const start = prev * (0.988 + (h % 20) / 1000);
  for (let idx = 0; idx < 6; idx++) {
    const t = idx / 5;
    const base = start + (prev - start) * t;
    const wobble = (((h >> (idx * 3)) & 7) - 3.5) * 0.004 * prev;
    pts.push(roundCurrency(Math.max(1, base + wobble)));
  }
  pts.push(roundCurrency(current));
  return pts;
}

export interface LiveAgriRateOverride {
  /** Normalized per-kg modal price in INR from data.gov.in */
  pricePerKg: number;
  previousPricePerKg: number;
  arrivalDate: string;
}

const MASTER_CATALOG_CACHE = new Map<string, MasterProductSKU[]>();

function serializeOverridesKey(overrides: Record<string, LiveAgriRateOverride>): string {
  const keys = Object.keys(overrides).sort();
  if (keys.length === 0) return '';
  return keys
    .map((k) => {
      const o = overrides[k];
      return `${k}:${o.pricePerKg}:${o.previousPricePerKg}:${o.arrivalDate}`;
    })
    .join('|');
}

/**
 * Generates the comprehensive 10,000+ SKU Kirana & FMCG Master Product Price Matrix:
 * - Authentic Indian consumer packet MRPs (₹5, ₹10, ₹20, ₹35, ₹40, ₹50, ₹100, ₹130, ₹250, exact Box × MRP)
 * - Accurate wholesale distributor dealer rates derived from official 12%–18% retailer margin tiers
 * - Loose Kirana commodities priced cleanly per kg and up to 50kg wholesale sacks
 * - Daily 24-hour market cycle variance + live data.gov.in agricultural override injection
 */
export function buildMasterCatalogMatrix(
  todayIso: string,
  liveAgriOverrides: Record<string, LiveAgriRateOverride> = {}
): MasterProductSKU[] {
  const cacheKey = `${todayIso}#${serializeOverridesKey(liveAgriOverrides)}`;
  const cached = MASTER_CATALOG_CACHE.get(cacheKey);
  if (cached) return cached;

  const previousDayIso = shiftIsoDate(todayIso, -1);
  const seenKeys = new Set<string>();

  interface RankedSku {
    sku: MasterProductSKU;
    tierRank: number;
    categoryOrder: number;
    withinCategoryOrder: number;
  }

  const rankedList: RankedSku[] = [];
  const categorySeqCounters = new Map<string, number>();
  let seqCounter = 10001;

  for (let fIdx = 0; fIdx < ALL_CATALOG_FAMILIES.length; fIdx++) {
    const family = ALL_CATALOG_FAMILIES[fIdx];
    const catOrder = CATEGORY_ORDER_MAP.get(family.category) ?? 99;
    const isStrictFmcgMargin =
      family.category === 'Packaged FMCG' ||
      family.category === 'Beverages' ||
      family.category === 'Personal Care' ||
      family.category === 'Household Cleaning';

    for (let pIdx = 0; pIdx < family.items.length; pIdx++) {
      const prod = family.items[pIdx];
      const agriOverride = prod.agriCommodityKey
        ? liveAgriOverrides[prod.agriCommodityKey]
        : undefined;

      for (let pkIdx = 0; pkIdx < family.packs.length; pkIdx++) {
        const pack = family.packs[pkIdx];
        const dedupKey = `${prod.title.toLowerCase()}|${family.brand.toLowerCase()}|${pack.label.toLowerCase()}`;
        if (seenKeys.has(dedupKey)) continue;
        seenKeys.add(dedupKey);

        const skuCode = `SKU-${family.prefix}-${seqCounter++}`;
        const seedKey = `${skuCode}:${prod.title}:${pack.label}`;
        const todayFactor = computeDailyVarianceFactor(seedKey, todayIso, family.category);
        const yesterdayFactor = computeDailyVarianceFactor(seedKey, previousDayIso, family.category);

        let wholesaleRate: number;
        let previousWholesaleRate: number;
        let suggestedMrp: number | null;
        let profitMarginPct: number | null;
        let ratePerKg: number | undefined;
        let ratePerQuintal: number | undefined;
        let updatedAt = todayIso;
        const isLoose = family.pricingMode === 'loose_kg';

        if (isLoose) {
          const bulkFactor = pack.bulkDiscount ?? 1;
          const weightKg = pack.weightKg ?? pack.scale;
          const baseWholesalePerKg =
            agriOverride && agriOverride.pricePerKg > 0 ? agriOverride.pricePerKg : prod.refValue;
          const prevWholesalePerKg =
            agriOverride && agriOverride.previousPricePerKg > 0
              ? agriOverride.previousPricePerKg
              : baseWholesalePerKg;

          if (agriOverride && agriOverride.pricePerKg > 0) {
            updatedAt = agriOverride.arrivalDate || todayIso;
          }

          const baselineWholesale = baseWholesalePerKg * weightKg * bulkFactor;
          const prevBaselineWholesale = prevWholesalePerKg * weightKg * bulkFactor;

          wholesaleRate = roundCurrency(
            Math.max(1, agriOverride ? baselineWholesale : baselineWholesale * todayFactor)
          );
          previousWholesaleRate = roundCurrency(
            Math.max(1, agriOverride ? prevBaselineWholesale : prevBaselineWholesale * yesterdayFactor)
          );

          // Strict Rule: Loose open-stock commodities NEVER carry an MRP or retail margin %
          suggestedMrp = null;
          profitMarginPct = null;
          ratePerKg = roundCurrency(wholesaleRate / Math.max(0.01, weightKg));
          ratePerQuintal = roundCurrency(ratePerKg * 100);
        } else {
          // Authentic Indian consumer printed MRP -> reverse wholesale dealer purchase rate
          if (pack.boxUnits && pack.boxUnits > 1) {
            const singleUnitMrp = snapToIndianPacketMrp(prod.refValue * pack.scale);
            suggestedMrp = singleUnitMrp * pack.boxUnits;
          } else {
            suggestedMrp = snapToIndianPacketMrp(prod.refValue * pack.scale);
          }

          const rawMarginPct = prod.targetMarginPct + (pack.tradeMarginBonusPct ?? 0);
          const isHighVelocityStaple =
            family.category === 'Edible Oils' ||
            family.category === 'Staple Grains' ||
            family.category === 'Pulses';

          const effectiveMarginPct = isHighVelocityStaple
            ? clampNumber(rawMarginPct, 8.5, 14.5)
            : clampNumber(rawMarginPct, 11.5, 17.6);

          let baseWholesale = suggestedMrp * (1 - effectiveMarginPct / 100);

          // Realistic Indian shopkeeper margin bounds: strictly 8.0% to 18.0%
          const minWholesale = suggestedMrp * 0.822;
          const maxWholesale = suggestedMrp * 0.918;

          if (agriOverride && pack.weightKg && agriOverride.pricePerKg > 0) {
            const rawRefMargin = effectiveMarginPct / 100;
            const nominalPerKgWholesale = prod.refValue * (1 - rawRefMargin);
            const brandPremium = clampNumber(
              nominalPerKgWholesale / Math.max(25, agriOverride.pricePerKg),
              0.92,
              1.35
            );
            const bulkFactor = pack.bulkDiscount ?? 0.97;
            baseWholesale = agriOverride.pricePerKg * pack.weightKg * bulkFactor * brandPremium;
            const prevBaseWholesale =
              agriOverride.previousPricePerKg * pack.weightKg * bulkFactor * brandPremium;

            // Keep packet MRP cleanly snapped & maintain realistic 8-18% margin if live agri rate moved
            if (baseWholesale >= suggestedMrp * 0.918 || baseWholesale <= suggestedMrp * 0.82) {
              suggestedMrp = snapToIndianPacketMrp(baseWholesale / (1 - effectiveMarginPct / 100));
            }
            const adjMin = suggestedMrp * 0.822;
            const adjMax = suggestedMrp * 0.918;
            wholesaleRate = roundCurrency(clampNumber(baseWholesale, adjMin, adjMax));
            previousWholesaleRate = roundCurrency(clampNumber(prevBaseWholesale, adjMin, adjMax));
            updatedAt = agriOverride.arrivalDate || todayIso;
          } else {
            wholesaleRate = roundCurrency(
              clampNumber(baseWholesale * todayFactor, minWholesale, maxWholesale)
            );
            previousWholesaleRate = roundCurrency(
              clampNumber(baseWholesale * yesterdayFactor, minWholesale, maxWholesale)
            );
          }

          profitMarginPct =
            suggestedMrp > 0
              ? roundCurrency(((suggestedMrp - wholesaleRate) / suggestedMrp) * 100)
              : 0;
        }

        const changePct =
          previousWholesaleRate > 0
            ? roundCurrency(
                ((wholesaleRate - previousWholesaleRate) / previousWholesaleRate) * 100
              )
            : 0;

        const trend: 'up' | 'down' | 'flat' =
          changePct > 0.15 ? 'up' : changePct < -0.15 ? 'down' : 'flat';

        const catCountKey = `${family.category}:${pack.tierRank}`;
        const withinOrder = categorySeqCounters.get(catCountKey) ?? 0;
        categorySeqCounters.set(catCountKey, withinOrder + 1);

        rankedList.push({
          sku: {
            id: skuCode.toLowerCase(),
            skuCode,
            name: prod.title,
            brand: family.brand,
            category: family.category,
            packVariant: pack.label,
            supplierTier: family.supplierTier,
            isLoose,
            wholesaleRate,
            ratePerKg,
            ratePerQuintal,
            suggestedMrp,
            profitMarginPct,
            previousWholesaleRate,
            changePct,
            trend,
            sparkline: buildSparkline(seedKey, wholesaleRate, previousWholesaleRate),
            agriCommodityKey: prod.agriCommodityKey,
            packWeightKg: pack.weightKg,
            updatedAt,
          },
          tierRank: pack.tierRank,
          categoryOrder: catOrder,
          withinCategoryOrder: withinOrder,
        });
      }
    }
  }

  // Interleave flagship shelf packs across all 9 categories so screen 1 shows diverse items immediately
  rankedList.sort((a, b) => {
    if (a.tierRank !== b.tierRank) return a.tierRank - b.tierRank;
    if (a.withinCategoryOrder !== b.withinCategoryOrder) {
      return a.withinCategoryOrder - b.withinCategoryOrder;
    }
    return a.categoryOrder - b.categoryOrder;
  });

  const result = rankedList.map((r) => r.sku);
  if (MASTER_CATALOG_CACHE.size >= 4) {
    const oldestKey = MASTER_CATALOG_CACHE.keys().next().value;
    if (oldestKey !== undefined) MASTER_CATALOG_CACHE.delete(oldestKey);
  }
  MASTER_CATALOG_CACHE.set(cacheKey, result);
  return result;
}
