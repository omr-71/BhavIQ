import { roundCurrency } from './units';

export interface PurchaseAllocationInputItem {
  productId: string;
  baseQuantityAdded: number;
  purchaseRatePerPurchaseUnit: number;
  quantityInPurchaseUnit: number;
  discountAmount: number;
  taxAmount: number;
}

export interface PurchaseAllocationResult {
  productId: string;
  netGoodsCost: number;
  allocatedExtraCost: number;
  totalLineCost: number;
  landedCostPerBaseUnit: number;
}

/**
 * Allocates freight, transport, and additional costs across purchase items
 * proportionally by each line's net merchandise value (or evenly by quantity if value is 0).
 */
export function allocatePurchaseLandedCosts(
  items: PurchaseAllocationInputItem[],
  freightCost: number,
  transportCost: number,
  additionalCosts: number
): PurchaseAllocationResult[] {
  if (items.length === 0) return [];
  const totalExtra = Math.max(0, freightCost) + Math.max(0, transportCost) + Math.max(0, additionalCosts);

  const netValues = items.map((item) =>
    Math.max(0, item.quantityInPurchaseUnit * item.purchaseRatePerPurchaseUnit - item.discountAmount + item.taxAmount)
  );
  const totalMerchandiseValue = netValues.reduce((acc, v) => acc + v, 0);
  const totalBaseQty = items.reduce((acc, item) => acc + item.baseQuantityAdded, 0);

  let allocatedSoFar = 0;

  return items.map((item, idx) => {
    const netGoodsCost = roundCurrency(netValues[idx]);
    let allocatedExtra = 0;

    if (idx === items.length - 1) {
      allocatedExtra = roundCurrency(totalExtra - allocatedSoFar);
    } else if (totalMerchandiseValue > 0) {
      allocatedExtra = roundCurrency((netGoodsCost / totalMerchandiseValue) * totalExtra);
      allocatedSoFar = roundCurrency(allocatedSoFar + allocatedExtra);
    } else if (totalBaseQty > 0) {
      allocatedExtra = roundCurrency((item.baseQuantityAdded / totalBaseQty) * totalExtra);
      allocatedSoFar = roundCurrency(allocatedSoFar + allocatedExtra);
    }

    const totalLineCost = roundCurrency(netGoodsCost + allocatedExtra);
    const landedCostPerBaseUnit =
      item.baseQuantityAdded > 0 ? roundCurrency(totalLineCost / item.baseQuantityAdded) : 0;

    return {
      productId: item.productId,
      netGoodsCost,
      allocatedExtraCost: allocatedExtra,
      totalLineCost,
      landedCostPerBaseUnit,
    };
  });
}

export interface PriceScenario {
  label: 'Competitive' | 'Balanced' | 'Higher Margin';
  targetMarginPct: number;
  uncappedPrice: number | null;
  suggestedPrice: number | null;
  cappedByMrp: boolean;
  resultingMarginPct: number | null;
  profitPerUnit: number | null;
}

export interface PricingAnalysis {
  historicalLandedCost: number | null;
  replacementLandedCost: number | null;
  currentSellingPrice: number;
  mrp: number | null;
  mrpRestricted: boolean;
  historicalGrossProfitPerUnit: number | null;
  historicalMarginPct: number | null;
  replacementCostDiffPerUnit: number | null;
  replacementMarginPct: number | null;
  breakEvenSellingPrice: number | null;
  isSellingBelowReplacementCost: boolean;
  isSellingBelowHistoricalCost: boolean;
  customTargetMarginPct: number;
  customSuggestedPrice: number | null;
  customCappedByMrp: boolean;
  scenarios: PriceScenario[];
  warnings: string[];
}

/**
 * Calculates selling price from landed cost and desired gross margin percentage:
 * Selling Price = Landed Cost / (1 - Target Margin / 100)
 * Enforces MRP ceiling when mrpRestricted is true and mrp > 0.
 */
export function calculatePriceForTargetMargin(
  landedCost: number | null,
  targetMarginPct: number,
  mrp: number | null,
  mrpRestricted: boolean
): { uncappedPrice: number | null; suggestedPrice: number | null; cappedByMrp: boolean; error?: string } {
  if (landedCost === null || !Number.isFinite(landedCost) || landedCost <= 0) {
    return { uncappedPrice: null, suggestedPrice: null, cappedByMrp: false, error: 'Landed cost unavailable' };
  }
  if (!Number.isFinite(targetMarginPct) || targetMarginPct < 0 || targetMarginPct >= 100) {
    return {
      uncappedPrice: null,
      suggestedPrice: null,
      cappedByMrp: false,
      error: 'Target margin must be between 0% and 99.9%',
    };
  }

  const raw = landedCost / (1 - targetMarginPct / 100);
  const uncappedPrice = roundCurrency(raw);

  if (mrpRestricted && mrp !== null && Number.isFinite(mrp) && mrp > 0 && uncappedPrice > mrp) {
    return {
      uncappedPrice,
      suggestedPrice: roundCurrency(mrp),
      cappedByMrp: true,
    };
  }

  return {
    uncappedPrice,
    suggestedPrice: uncappedPrice,
    cappedByMrp: false,
  };
}

/**
 * Distinguishes Historical Profit vs. Replacement-Cost Economics cleanly.
 */
export function analyzeProductPricing(params: {
  historicalLandedCost: number | null;
  replacementLandedCost: number | null;
  currentSellingPrice: number;
  mrp: number | null;
  mrpRestricted: boolean;
  targetMarginPct?: number;
}): PricingAnalysis {
  const {
    historicalLandedCost,
    replacementLandedCost,
    currentSellingPrice,
    mrp,
    mrpRestricted,
    targetMarginPct = 15,
  } = params;

  const warnings: string[] = [];

  const historicalGrossProfitPerUnit =
    historicalLandedCost !== null && historicalLandedCost > 0
      ? roundCurrency(currentSellingPrice - historicalLandedCost)
      : null;

  const historicalMarginPct =
    historicalGrossProfitPerUnit !== null && currentSellingPrice > 0
      ? roundCurrency((historicalGrossProfitPerUnit / currentSellingPrice) * 100)
      : null;

  const effectiveReplacementCost =
    replacementLandedCost !== null && replacementLandedCost > 0
      ? replacementLandedCost
      : historicalLandedCost;

  const replacementCostDiffPerUnit =
    effectiveReplacementCost !== null && effectiveReplacementCost > 0
      ? roundCurrency(currentSellingPrice - effectiveReplacementCost)
      : null;

  const replacementMarginPct =
    replacementCostDiffPerUnit !== null && currentSellingPrice > 0
      ? roundCurrency((replacementCostDiffPerUnit / currentSellingPrice) * 100)
      : null;

  const breakEvenSellingPrice =
    effectiveReplacementCost !== null && effectiveReplacementCost > 0
      ? roundCurrency(effectiveReplacementCost)
      : null;

  const isSellingBelowHistoricalCost =
    historicalGrossProfitPerUnit !== null && historicalGrossProfitPerUnit < 0;

  const isSellingBelowReplacementCost =
    replacementCostDiffPerUnit !== null && replacementCostDiffPerUnit < 0;

  if (isSellingBelowReplacementCost) {
    warnings.push(
      `Current selling price (₹${currentSellingPrice.toFixed(2)}) is ₹${Math.abs(
        replacementCostDiffPerUnit!
      ).toFixed(2)} below current replacement landed cost (₹${effectiveReplacementCost!.toFixed(2)}).`
    );
  }

  if (mrpRestricted && mrp !== null && mrp > 0 && currentSellingPrice > mrp) {
    warnings.push(`Current selling price exceeds MRP (₹${mrp.toFixed(2)}).`);
  }

  const customCalc = calculatePriceForTargetMargin(
    effectiveReplacementCost,
    targetMarginPct,
    mrp,
    mrpRestricted
  );
  if (customCalc.error && effectiveReplacementCost !== null) {
    warnings.push(customCalc.error);
  }

  const scenarioConfigs: Array<{ label: PriceScenario['label']; margin: number }> = [
    { label: 'Competitive', margin: 8 },
    { label: 'Balanced', margin: targetMarginPct },
    { label: 'Higher Margin', margin: Math.min(45, Math.max(22, targetMarginPct + 7)) },
  ];

  const scenarios: PriceScenario[] = scenarioConfigs.map((cfg) => {
    const calc = calculatePriceForTargetMargin(
      effectiveReplacementCost,
      cfg.margin,
      mrp,
      mrpRestricted
    );
    const profitPerUnit =
      calc.suggestedPrice !== null && effectiveReplacementCost !== null
        ? roundCurrency(calc.suggestedPrice - effectiveReplacementCost)
        : null;
    const resultingMarginPct =
      calc.suggestedPrice !== null && calc.suggestedPrice > 0 && profitPerUnit !== null
        ? roundCurrency((profitPerUnit / calc.suggestedPrice) * 100)
        : null;

    return {
      label: cfg.label,
      targetMarginPct: cfg.margin,
      uncappedPrice: calc.uncappedPrice,
      suggestedPrice: calc.suggestedPrice,
      cappedByMrp: calc.cappedByMrp,
      resultingMarginPct,
      profitPerUnit,
    };
  });

  return {
    historicalLandedCost,
    replacementLandedCost: effectiveReplacementCost,
    currentSellingPrice,
    mrp,
    mrpRestricted,
    historicalGrossProfitPerUnit,
    historicalMarginPct,
    replacementCostDiffPerUnit,
    replacementMarginPct,
    breakEvenSellingPrice,
    isSellingBelowReplacementCost,
    isSellingBelowHistoricalCost,
    customTargetMarginPct: targetMarginPct,
    customSuggestedPrice: customCalc.suggestedPrice,
    customCappedByMrp: customCalc.cappedByMrp,
    scenarios,
    warnings,
  };
}
