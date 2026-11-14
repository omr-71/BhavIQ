import {
  buildMasterCatalogMatrix,
  type LiveAgriRateOverride,
  type MasterCategory,
  type MasterProductSKU,
} from './masterCatalog';
import { calculatePriceForTargetMargin } from './pricing';
import type { PriceAlert, Product } from './types';
import { roundCurrency } from './units';

export interface DetectDailyMarketAlertsParams {
  catalog?: MasterProductSKU[];
  todayIso: string;
  liveAgriOverrides?: Record<string, LiveAgriRateOverride>;
  shopProducts?: Product[];
  defaultMarginPct?: number;
  acknowledgedIds?: Set<string>;
  includeAcknowledged?: boolean;
  maxAlerts?: number;
}

const PRIORITY_CATEGORY_WEIGHT: Record<MasterCategory, number> = {
  'Edible Oils': 10,
  'Loose Items': 9.5,
  Pulses: 9,
  'Staple Grains': 8.5,
  Spices: 7,
  Beverages: 6,
  'Packaged FMCG': 5.5,
  'Household Cleaning': 4,
  'Personal Care': 3.5,
};

function isFlagshipAlertPack(sku: MasterProductSKU): boolean {
  const v = sku.packVariant.toLowerCase();
  if (sku.isLoose) {
    return (
      v.includes('1kg loose') ||
      v.includes('25kg trade bag') ||
      v.includes('50kg wholesale sack') ||
      v.includes('1 quintal')
    );
  }
  // Prefer primary consumer retail packs & staple bags rather than mini ₹5 sachets or mega master cartons
  if (v.includes('carton') || v.includes('box') || v.includes('sachet') || v.includes('mini')) {
    return false;
  }
  return (
    v.includes('1l') ||
    v.includes('1kg') ||
    v.includes('5kg') ||
    v.includes('5l') ||
    v.includes('500g') ||
    v.includes('250g') ||
    v.includes('200g') ||
    v.includes('150g') ||
    v.includes('100g')
  );
}

function matchShopProductForSku(
  sku: MasterProductSKU,
  shopProducts: Product[]
): Product | null {
  if (shopProducts.length === 0) return null;
  const skuNameLower = sku.name.toLowerCase();
  const skuBrandLower = sku.brand.toLowerCase();

  for (const p of shopProducts) {
    // Respect loose vs packaged boundary strictly
    const prodIsLoose =
      p.category !== 'Packaged FMCG' &&
      !p.mrpRestricted &&
      (p.baseUnit === 'Kilogram' || p.baseUnit === 'Gram');
    if (sku.isLoose && p.category === 'Packaged FMCG') continue;
    if (!sku.isLoose && prodIsLoose && sku.category === 'Loose Items') continue;

    const pName = p.name.toLowerCase();
    const pBrand = (p.brand || '').toLowerCase();
    const pComm = (p.marketCommodityName || '').toLowerCase();

    if (pBrand && skuBrandLower === pBrand && (skuNameLower.includes(pName) || pName.includes(skuNameLower))) {
      return p;
    }
    if (sku.agriCommodityKey && pComm && skuNameLower.includes(pComm)) {
      return p;
    }
    if (pName === skuNameLower) {
      return p;
    }
  }
  return null;
}

function buildDriverNarrative(sku: MasterProductSKU, direction: 'up' | 'down'): string {
  const absPct = Math.abs(sku.changePct).toFixed(1);
  const name = sku.name;
  const pack = sku.packVariant;

  if (direction === 'up') {
    if (sku.category === 'Edible Oils') {
      return `${name} (${pack}) wholesale up by +${absPct}% today due to tight port inventories; adjust retail pack prices immediately to protect profit margins.`;
    }
    if (sku.isLoose && (sku.agriCommodityKey === 'sugar' || name.toLowerCase().includes('sugar'))) {
      return `${name} wholesale firmed +${absPct}% today (₹${Math.round(sku.ratePerQuintal ?? sku.wholesaleRate * 100).toLocaleString('en-IN')}/qtl) on mill quota tightening; review loose counter pricing.`;
    }
    if (sku.category === 'Pulses' || sku.agriCommodityKey?.includes('dal')) {
      return `${name} (${pack}) wholesale surged +${absPct}% today on tighter mandi arrivals; re-check replacement landed cost before next supplier indent.`;
    }
    if (sku.category === 'Staple Grains' || sku.agriCommodityKey === 'wheat') {
      return `${name} (${pack}) wholesale rose +${absPct}% today amid firm northern mill wheat procurement; safeguard retail margin on new stock.`;
    }
    if (sku.isLoose && name.toLowerCase().includes('tea')) {
      return `${name} bulk wholesale increased +${absPct}% today following garden auction grade tightening; update loose tea shelf margin.`;
    }
    return `${name} (${pack}) wholesale rate increased +${absPct}% vs yesterday's benchmark; verify replacement cost before restocking.`;
  }

  // Price Drop / Buying Opportunity
  if (sku.isLoose && (sku.agriCommodityKey === 'sugar' || name.toLowerCase().includes('sugar'))) {
    const qtlFormatted = Math.round(
      sku.ratePerQuintal ?? (sku.ratePerKg ?? sku.wholesaleRate) * 100
    ).toLocaleString('en-IN');
    return `${name} wholesale softened by -${absPct}% (₹${qtlFormatted}/qtl); favorable time for bulk stock replenishment.`;
  }
  if (sku.category === 'Pulses' || sku.agriCommodityKey?.includes('dal')) {
    return `${name} (${pack}) wholesale dropped -${absPct}% today on improved mill arrivals; attractive window for forward inventory booking.`;
  }
  if (sku.category === 'Edible Oils') {
    return `${name} (${pack}) wholesale eased -${absPct}% today on softer refined oil quotes; lock bulk distributor cartons at lower cost.`;
  }
  if (sku.category === 'Staple Grains' || sku.agriCommodityKey === 'wheat' || sku.agriCommodityKey === 'rice') {
    return `${name} (${pack}) wholesale dipped -${absPct}% today on steady mill supply; favorable window to replenish staple sacks.`;
  }
  if (sku.isLoose) {
    const qtlFormatted = Math.round(
      sku.ratePerQuintal ?? (sku.ratePerKg ?? sku.wholesaleRate) * 100
    ).toLocaleString('en-IN');
    return `${name} bulk wholesale softened by -${absPct}% (₹${qtlFormatted}/qtl); strong opportunity for bulk replenishment.`;
  }
  return `${name} (${pack}) wholesale softened by -${absPct}% today; favorable opportunity to replenish retail stock with wider margin.`;
}

function scoreCandidate(sku: MasterProductSKU): number {
  const catWeight = PRIORITY_CATEGORY_WEIGHT[sku.category] ?? 3;
  const bellwetherBoost =
    sku.agriCommodityKey === 'sunflower_oil' ||
    sku.agriCommodityKey === 'sugar' ||
    sku.agriCommodityKey === 'toor_dal' ||
    sku.agriCommodityKey === 'wheat' ||
    sku.name.toLowerCase().includes('assam ctc')
      ? 2.2
      : 0;
  const packOneKgBoost =
    sku.packVariant.toLowerCase().includes('1kg') ||
    sku.packVariant.toLowerCase().includes('1l') ||
    sku.packVariant.toLowerCase().includes('5kg')
      ? 1.1
      : 0;
  return Math.abs(sku.changePct) * 2.5 + catWeight + bellwetherBoost + packOneKgBoost;
}

function buildAlertFromSku(params: {
  sku: MasterProductSKU;
  todayIso: string;
  shopProducts: Product[];
  defaultMarginPct: number;
  acknowledgedAt?: string | null;
}): PriceAlert {
  const { sku, todayIso, shopProducts, defaultMarginPct, acknowledgedAt } = params;
  const direction: 'up' | 'down' = sku.changePct >= 0 ? 'up' : 'down';
  const absPct = Math.abs(sku.changePct);
  const severity: PriceAlert['severity'] =
    direction === 'up' ? (absPct >= 2.8 ? 'critical' : 'warning') : 'opportunity';

  const matched = matchShopProductForSku(sku, shopProducts);
  const alertId = `mkt-vol-${todayIso}-${sku.skuCode}`;

  const prevRate = roundCurrency(sku.previousWholesaleRate);
  const currRate = roundCurrency(sku.wholesaleRate);
  const rateDelta = roundCurrency(currRate - prevRate);

  if (sku.isLoose) {
    // STRICT RULE: Loose commodities NEVER display MRP or retail profit margin %
    const weightKg = Math.max(0.01, sku.packWeightKg ?? 1);
    const currPerKg = sku.ratePerKg ?? roundCurrency(currRate / weightKg);
    const prevPerKg = roundCurrency(prevRate / weightKg);
    const currPerQtl = sku.ratePerQuintal ?? roundCurrency(currPerKg * 100);
    const prevPerQtl = roundCurrency(prevPerKg * 100);
    const deltaPerKg = roundCurrency(currPerKg - prevPerKg);
    const deltaPerQtl = Math.round(currPerQtl - prevPerQtl);

    const replacementImpactSummary =
      direction === 'up'
        ? `Wholesale up +₹${Math.abs(deltaPerKg).toFixed(2)}/kg (+₹${Math.abs(deltaPerQtl).toLocaleString('en-IN')}/qtl) vs yesterday`
        : `Bulk savings ₹${Math.abs(deltaPerKg).toFixed(2)}/kg (₹${Math.abs(deltaPerQtl).toLocaleString('en-IN')}/qtl) vs yesterday`;

    return {
      id: alertId,
      alertKind: 'market_volatility',
      productId: matched?.id ?? null,
      skuCode: sku.skuCode,
      category: sku.category,
      packVariant: sku.packVariant,
      isLoose: true,
      productName: sku.name,
      brand: null,
      severity,
      movementDirection: direction,
      changePct: sku.changePct,
      previousWholesaleRate: prevRate,
      currentWholesaleRate: currRate,
      ratePerKg: currPerKg,
      previousRatePerKg: prevPerKg,
      ratePerQuintal: currPerQtl,
      previousRatePerQuintal: prevPerQtl,
      officialMrp: null,
      marginBeforePct: null,
      marginAfterPct: null,
      replacementImpactSummary,
      acknowledged: Boolean(acknowledgedAt),
      acknowledgedAt: acknowledgedAt ?? null,
      title:
        direction === 'up'
          ? `Price surge +${absPct.toFixed(1)}% · ₹${Math.round(currPerQtl).toLocaleString('en-IN')}/qtl`
          : `Buying opportunity -${absPct.toFixed(1)}% · ₹${Math.round(currPerQtl).toLocaleString('en-IN')}/qtl`,
      reason: buildDriverNarrative(sku, direction),
      source: `${sku.supplierTier} · Live Volatility Engine`,
      timestamp: sku.updatedAt || todayIso,
      historicalLandedCost: matched?.landedCost ?? prevPerKg,
      replacementLandedCost: currPerKg,
      currentSellingPrice: matched?.sellingPrice ?? 0,
      recommendedPrice: null,
      calculationDetail: `Prev ₹${prevPerKg.toFixed(2)}/kg (₹${Math.round(prevPerQtl).toLocaleString('en-IN')}/qtl) → Live ₹${currPerKg.toFixed(2)}/kg (₹${Math.round(currPerQtl).toLocaleString('en-IN')}/qtl)`,
    };
  }

  // Packaged item: official printed MRP + exact shopkeeper margin impact
  const officialMrp = sku.suggestedMrp ?? Math.round(currRate * 1.15);
  const sellBaseline = matched ? matched.sellingPrice : officialMrp;
  const marginBeforePct =
    sellBaseline > 0 ? roundCurrency(((sellBaseline - prevRate) / sellBaseline) * 100) : null;
  const marginAfterPct =
    sellBaseline > 0 ? roundCurrency(((sellBaseline - currRate) / sellBaseline) * 100) : null;

  const targetCalc = calculatePriceForTargetMargin(
    currRate,
    defaultMarginPct,
    officialMrp,
    true
  );

  const replacementImpactSummary =
    direction === 'up'
      ? `Replacement +₹${Math.abs(rateDelta).toFixed(2)}/pack · Margin ${marginBeforePct?.toFixed(1) ?? '—'}% → ${marginAfterPct?.toFixed(1) ?? '—'}%`
      : `Replacement -₹${Math.abs(rateDelta).toFixed(2)}/pack · Margin ${marginBeforePct?.toFixed(1) ?? '—'}% → ${marginAfterPct?.toFixed(1) ?? '—'}%`;

  return {
    id: alertId,
    alertKind: 'market_volatility',
    productId: matched?.id ?? null,
    skuCode: sku.skuCode,
    category: sku.category,
    packVariant: sku.packVariant,
    isLoose: false,
    productName: sku.name,
    brand: sku.brand,
    severity,
    movementDirection: direction,
    changePct: sku.changePct,
    previousWholesaleRate: prevRate,
    currentWholesaleRate: currRate,
    ratePerKg: null,
    previousRatePerKg: null,
    ratePerQuintal: null,
    previousRatePerQuintal: null,
    officialMrp,
    marginBeforePct,
    marginAfterPct,
    replacementImpactSummary,
    acknowledged: Boolean(acknowledgedAt),
    acknowledgedAt: acknowledgedAt ?? null,
    title:
      direction === 'up'
        ? `Price surge +${absPct.toFixed(1)}% · Protect shelf margin`
        : `Price drop -${absPct.toFixed(1)}% · Restock opportunity`,
    reason: buildDriverNarrative(sku, direction),
    source: `${sku.supplierTier} · Live Volatility Engine`,
    timestamp: sku.updatedAt || todayIso,
    historicalLandedCost: matched?.landedCost ?? prevRate,
    replacementLandedCost: currRate,
    currentSellingPrice: sellBaseline,
    recommendedPrice: targetCalc.suggestedPrice,
    calculationDetail: `Prev ₹${prevRate.toFixed(2)} → Live ₹${currRate.toFixed(2)} · Official MRP ₹${officialMrp.toFixed(2)}`,
  };
}

/**
 * Real-time daily anomaly & price shock detector across India Kirana & FMCG SKUs.
 * Monitors wholesale spikes (Edible Oils, Atta, Dal, Sugar) and drops/buying opportunities,
 * returning balanced, actionable alerts with exact replacement-cost math.
 */
export function detectDailyMarketAlerts(
  params: DetectDailyMarketAlertsParams
): PriceAlert[] {
  const {
    todayIso,
    liveAgriOverrides = {},
    shopProducts = [],
    defaultMarginPct = 15,
    acknowledgedIds,
    includeAcknowledged = false,
    maxAlerts = 12,
  } = params;

  const catalog = params.catalog ?? buildMasterCatalogMatrix(todayIso, liveAgriOverrides);

  const surgeCandidates: MasterProductSKU[] = [];
  const dropCandidates: MasterProductSKU[] = [];

  for (const sku of catalog) {
    if (!isFlagshipAlertPack(sku)) continue;
    if (sku.changePct >= 1.45) {
      surgeCandidates.push(sku);
    } else if (sku.changePct <= -1.45) {
      dropCandidates.push(sku);
    }
  }

  surgeCandidates.sort((a, b) => scoreCandidate(b) - scoreCandidate(a));
  dropCandidates.sort((a, b) => scoreCandidate(b) - scoreCandidate(a));

  const pickDistinct = (pool: MasterProductSKU[], limit: number): MasterProductSKU[] => {
    const picked: MasterProductSKU[] = [];
    const seenNames = new Set<string>();
    const categoryCount = new Map<string, number>();

    // Pass 1: strictly 1 flagship item per category so Overview surfaces Oils, Loose Sugar, Pulses, Atta, Spices
    for (const sku of pool) {
      if (picked.length >= limit) break;
      const nameKey = sku.name.toLowerCase();
      if (seenNames.has(nameKey)) continue;
      if ((categoryCount.get(sku.category) ?? 0) >= 1) continue;
      seenNames.add(nameKey);
      categoryCount.set(sku.category, 1);
      picked.push(sku);
    }

    // Pass 2: allow up to 2 per category if more slots remain
    if (picked.length < limit) {
      for (const sku of pool) {
        if (picked.length >= limit) break;
        const nameKey = sku.name.toLowerCase();
        if (seenNames.has(nameKey)) continue;
        const cCount = categoryCount.get(sku.category) ?? 0;
        if (cCount >= 2) continue;
        seenNames.add(nameKey);
        categoryCount.set(sku.category, cCount + 1);
        picked.push(sku);
      }
    }

    // Pass 3: fill remaining slots if needed
    if (picked.length < limit) {
      for (const sku of pool) {
        if (picked.length >= limit) break;
        const nameKey = sku.name.toLowerCase();
        if (seenNames.has(nameKey)) continue;
        seenNames.add(nameKey);
        picked.push(sku);
      }
    }
    return picked;
  };

  const half = Math.ceil(maxAlerts / 2);
  const topSurges = pickDistinct(surgeCandidates, half + 2);
  const topDrops = pickDistinct(dropCandidates, half + 2);

  // Interleave surges and drops cleanly so the top feed surfaces both urgent margin protections and buying opportunities
  const selectedSkus: MasterProductSKU[] = [];
  const maxLen = Math.max(topSurges.length, topDrops.length);
  for (let i = 0; i < maxLen && selectedSkus.length < maxAlerts; i++) {
    if (i < topSurges.length) selectedSkus.push(topSurges[i]);
    if (selectedSkus.length < maxAlerts && i < topDrops.length) selectedSkus.push(topDrops[i]);
  }

  const alerts = selectedSkus.map((sku) =>
    buildAlertFromSku({
      sku,
      todayIso,
      shopProducts,
      defaultMarginPct,
    })
  );

  if (includeAcknowledged || !acknowledgedIds || acknowledgedIds.size === 0) {
    return alerts;
  }
  return alerts.filter((a) => !acknowledgedIds.has(a.id));
}

export function mergeShopAndMarketAlerts(params: {
  inventoryAlerts: PriceAlert[];
  marketAlerts: PriceAlert[];
  acknowledgedMap?: Map<string, string>;
}): { activeAlerts: PriceAlert[]; acknowledgedAlerts: PriceAlert[] } {
  const { inventoryAlerts, marketAlerts, acknowledgedMap } = params;
  const seenProductIds = new Set<string>();
  const combined: PriceAlert[] = [];

  for (const inv of inventoryAlerts) {
    if (inv.productId) seenProductIds.add(inv.productId);
    const ackAt = acknowledgedMap?.get(inv.id) ?? null;
    combined.push({
      ...inv,
      alertKind: 'inventory_replacement',
      acknowledged: Boolean(ackAt),
      acknowledgedAt: ackAt,
    });
  }

  for (const mkt of marketAlerts) {
    if (mkt.productId && seenProductIds.has(mkt.productId)) continue;
    const ackAt = acknowledgedMap?.get(mkt.id) ?? null;
    combined.push({
      ...mkt,
      acknowledged: Boolean(ackAt),
      acknowledgedAt: ackAt,
    });
  }

  return {
    activeAlerts: combined.filter((a) => !a.acknowledged),
    acknowledgedAlerts: combined.filter((a) => a.acknowledged),
  };
}
