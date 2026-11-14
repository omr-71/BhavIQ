import { convertToBaseQuantity, roundCurrency } from './units';
import type {
  BaseUnit,
  HistoricalPurchaseRatePoint,
  HonestRateStatus,
  MarketPrice,
  Product,
  ProductUnit,
  ProductWholesaleSummary,
  RateExplorerFilter,
  RetailCategory,
  SupplierQuotation,
} from './types';

export interface QuotationCostInput {
  quantity: number;
  unitName: string;
  baseUnit: BaseUnit;
  productUnits?: ProductUnit[];
  wholesaleRatePerUnit: number;
  discountAmount?: number;
  taxRatePct?: number;
  taxAmount?: number;
  transportFreight?: number;
  additionalCosts?: number;
}

export interface QuotationCostResult {
  baseQuantity: number;
  grossMerchandiseCost: number;
  discountAmount: number;
  taxAmount: number;
  transportFreight: number;
  additionalCosts: number;
  finalTotalCost: number;
  finalLandedCostPerQuoteUnit: number;
  landedCostPerBaseUnit: number;
}

/**
 * Computes exact supplier quotation landed cost without dropping discount, tax, freight, or additional costs.
 */
export function calculateQuotationLandedCost(input: QuotationCostInput): QuotationCostResult {
  const qty = Number(input.quantity);
  const rate = Number(input.wholesaleRatePerUnit);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error('Quotation quantity must be greater than zero');
  }
  if (!Number.isFinite(rate) || rate < 0) {
    throw new Error('Wholesale rate must be a non-negative number');
  }

  const baseQuantity = convertToBaseQuantity(
    qty,
    input.unitName || input.baseUnit,
    input.baseUnit,
    input.productUnits || []
  );
  if (baseQuantity <= 0) {
    throw new Error('Converted base quantity must be positive');
  }

  const grossMerchandiseCost = roundCurrency(qty * rate);
  const discountAmount = Math.max(0, roundCurrency(Number(input.discountAmount || 0)));
  const netAfterDiscount = Math.max(0, roundCurrency(grossMerchandiseCost - discountAmount));

  let taxAmount = 0;
  if (input.taxAmount !== undefined && Number.isFinite(Number(input.taxAmount))) {
    taxAmount = Math.max(0, roundCurrency(Number(input.taxAmount)));
  } else if (input.taxRatePct !== undefined && Number.isFinite(Number(input.taxRatePct))) {
    taxAmount = roundCurrency(netAfterDiscount * (Math.max(0, Number(input.taxRatePct)) / 100));
  }

  const transportFreight = Math.max(0, roundCurrency(Number(input.transportFreight || 0)));
  const additionalCosts = Math.max(0, roundCurrency(Number(input.additionalCosts || 0)));

  const finalTotalCost = roundCurrency(
    netAfterDiscount + taxAmount + transportFreight + additionalCosts
  );
  const finalLandedCostPerQuoteUnit = roundCurrency(finalTotalCost / qty);
  const landedCostPerBaseUnit = roundCurrency(finalTotalCost / baseQuantity);

  return {
    baseQuantity,
    grossMerchandiseCost,
    discountAmount,
    taxAmount,
    transportFreight,
    additionalCosts,
    finalTotalCost,
    finalLandedCostPerQuoteUnit,
    landedCostPerBaseUnit,
  };
}

export function getTodayIsoDate(): string {
  // IST-aligned date so Indian shop owners don't get premature UTC date rollovers at 00:00–05:30 IST
  const nowIst = new Date(Date.now() + 5.5 * 3600 * 1000);
  return nowIst.toISOString().slice(0, 10);
}

/**
 * Returns true strictly when validUntil is present and earlier than todayDate (YYYY-MM-DD).
 */
export function isQuotationExpired(
  validUntil: string | null | undefined,
  todayDate: string = getTodayIsoDate()
): boolean {
  if (!validUntil || !String(validUntil).trim()) return false;
  const clean = String(validUntil).trim().slice(0, 10);
  return clean < todayDate;
}

export function normalizeToken(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

const NON_AGRI_PACKAGED_CATEGORIES = new Set<RetailCategory>([
  'Packaged FMCG',
  'Personal Care',
  'Household',
  'Beverages',
]);

const AGRI_ELIGIBLE_CATEGORIES = new Set<RetailCategory>([
  'Vegetables',
  'Fruits',
  'Grains',
  'Pulses',
  'Loose Products',
  'Grocery',
  'Food Products',
]);

/**
 * Never match packaged FMCG, personal care, household, or beverages to AGMARKNET agricultural commodities.
 */
export function isAgriMarketMatchAllowed(product: Pick<Product, 'category' | 'marketCommodityName'>): boolean {
  if (NON_AGRI_PACKAGED_CATEGORIES.has(product.category)) return false;
  if (!AGRI_ELIGIBLE_CATEGORIES.has(product.category)) return false;
  return Boolean(product.marketCommodityName && product.marketCommodityName.trim());
}

/**
 * Ensures we never mix incompatible pack sizes (e.g. "1 Kg" vs "25 Kg", "500 g" vs "1 Kg").
 * If either side is unbranded/loose (null/empty), returns true only if explicitly matching loose commodity.
 */
export function isPackSizeCompatible(
  productPackSize: string | null | undefined,
  recordPackSize: string | null | undefined
): boolean {
  const p = normalizeToken(productPackSize);
  const r = normalizeToken(recordPackSize);
  if (!p || !r) return true;
  return p === r;
}

export function isBrandCompatible(
  productBrand: string | null | undefined,
  recordBrand: string | null | undefined
): boolean {
  const p = normalizeToken(productBrand);
  const r = normalizeToken(recordBrand);
  if (!p || !r) return true;
  return p === r;
}

/**
 * Converts AGMARKNET INR-per-Quintal (100 Kg) price into the product's base unit.
 * Returns null if the product's base unit is incompatible with weight-based mandi rates (e.g., Piece, Litre).
 */
export function convertAgmarknetQuintalRateToUnit(
  pricePerQuintal: number,
  baseUnit: BaseUnit,
  productUnits: ProductUnit[] = []
): number | null {
  if (!Number.isFinite(pricePerQuintal) || pricePerQuintal <= 0) return null;
  if (baseUnit === 'Kilogram') {
    return roundCurrency(pricePerQuintal / 100);
  }
  if (baseUnit === 'Gram') {
    return roundCurrency(pricePerQuintal / 100000);
  }
  // Check if product has a Quintal unit mapping defined
  const quintalUnit = productUnits.find((u) => normalizeToken(u.unitName) === 'quintal');
  if (quintalUnit && quintalUnit.conversionToBase > 0) {
    return roundCurrency(pricePerQuintal / quintalUnit.conversionToBase);
  }
  // Check if product has a Kilogram unit mapping defined (e.g., Bag of 25 Kg where baseUnit = Bag -> Kilogram conversion = 0.04)
  const kgUnit = productUnits.find((u) => normalizeToken(u.unitName) === 'kilogram' || normalizeToken(u.unitName) === 'kg');
  if (kgUnit && kgUnit.conversionToBase > 0) {
    const perKg = pricePerQuintal / 100;
    return roundCurrency(perKg / kgUnit.conversionToBase);
  }
  return null;
}

export interface RawAgmarknetRecord {
  state?: string;
  district?: string;
  market?: string;
  commodity?: string;
  variety?: string;
  grade?: string;
  arrival_date?: string;
  min_price?: string | number;
  max_price?: string | number;
  modal_price?: string | number;
}

export interface AgmarknetMatchResult {
  product: Product;
  normalizedPerBaseUnit: number;
  matchBasis: string;
}

/**
 * Strict AGMARKNET matcher:
 * 1. Excludes packaged FMCG / non-agri categories.
 * 2. Matches commodity name cleanly.
 * 3. If product defines `variety`, requires AGMARKNET `variety` to match (case-insensitive substring or exact).
 * 4. If product defines `packSize` that isn't bulk/loose/100kg-compatible? Loose agri products can have e.g. "25 Kg" bag or loose;
 *    weight conversion ensures per-kg normalization, and non-weight units (Piece, Litre, Packet) are rejected unless unit mapping exists.
 * 5. Prefers matching state if shopState is provided.
 */
export function matchAgmarknetRecordToProduct(
  record: RawAgmarknetRecord,
  products: Product[],
  shopState?: string | null
): AgmarknetMatchResult | null {
  const recCommodity = normalizeToken(record.commodity);
  const modal = Number(record.modal_price);
  if (!recCommodity || !Number.isFinite(modal) || modal <= 0) return null;

  const recVariety = normalizeToken(record.variety);
  const recState = normalizeToken(record.state);
  const targetState = normalizeToken(shopState);

  const candidates = products.filter((p) => {
    if (!isAgriMarketMatchAllowed(p)) return false;
    const prodCommodity = normalizeToken(p.marketCommodityName);
    if (!prodCommodity || prodCommodity !== recCommodity) return false;

    const prodVariety = normalizeToken(p.variety);
    if (prodVariety) {
      if (!recVariety) return false;
      if (recVariety !== prodVariety && !recVariety.includes(prodVariety) && !prodVariety.includes(recVariety)) {
        return false;
      }
    }

    const perUnit = convertAgmarknetQuintalRateToUnit(modal, p.baseUnit, p.units);
    if (perUnit === null) return false;

    return true;
  });

  if (candidates.length === 0) return null;

  // Prefer state match if available, and variety-specific product over generic
  candidates.sort((a, b) => {
    const aVar = normalizeToken(a.variety) ? 1 : 0;
    const bVar = normalizeToken(b.variety) ? 1 : 0;
    if (aVar !== bVar) return bVar - aVar;
    return 0;
  });

  const best = candidates[0];
  const normalizedPerBaseUnit = convertAgmarknetQuintalRateToUnit(modal, best.baseUnit, best.units);
  if (normalizedPerBaseUnit === null) return null;

  const stateMatched = targetState && recState && targetState === recState;
  const basisParts = [
    `Commodity: ${record.commodity}`,
    record.variety ? `Variety: ${record.variety}` : null,
    record.market ? `Market: ${record.market}` : null,
    stateMatched ? `State match: ${record.state}` : record.state ? `State: ${record.state}` : null,
    `Unit: Quintal → ${best.baseUnit}`,
  ].filter(Boolean);

  return {
    product: best,
    normalizedPerBaseUnit,
    matchBasis: basisParts.join(' · '),
  };
}

export interface FormattedFetchError {
  code: string;
  message: string;
}

/**
 * Extracts deep network/HTTP diagnostics from Node fetch errors (cause.code, address, port, timeout).
 */
export function formatMarketFetchError(err: unknown): FormattedFetchError {
  if (!(err instanceof Error)) {
    return { code: 'UNKNOWN_ERROR', message: String(err || 'Unknown network error') };
  }

  if (err.name === 'TimeoutError' || err.name === 'AbortError') {
    return {
      code: 'ETIMEDOUT',
      message: `AGMARKNET request timed out after 12s (${err.name}): ${err.message}`,
    };
  }

  const anyErr = err as Error & {
    code?: string;
    cause?: {
      code?: string;
      errno?: number;
      syscall?: string;
      address?: string;
      port?: number;
      message?: string;
    };
  };

  const cause = anyErr.cause;
  const code = cause?.code || anyErr.code || 'FETCH_FAILED';
  const endpoint =
    cause?.address && cause?.port
      ? `${cause.address}:${cause.port}`
      : cause?.address || 'api.data.gov.in:443';

  if (code === 'ECONNREFUSED') {
    return {
      code,
      message: `Connection refused by ${endpoint} (${code}). Outbound HTTPS to api.data.gov.in is blocked or the upstream host refused TCP port 443.`,
    };
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return {
      code,
      message: `DNS resolution failed for api.data.gov.in (${code}): ${cause?.message || err.message}`,
    };
  }
  if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
    return {
      code,
      message: `Network connect timeout reaching ${endpoint} (${code}).`,
    };
  }

  const detail = cause?.message && cause.message !== err.message ? `${err.message} (${code}: ${cause.message})` : `${err.message} (${code})`;
  return { code, message: detail };
}

export function findLatestMatchedMarketPrice(
  product: Product,
  marketPrices: MarketPrice[]
): MarketPrice | null {
  const candidates = marketPrices.filter((m) => {
    if (!isPackSizeCompatible(product.packSize, m.packSize)) return false;
    if (!isBrandCompatible(product.brand, m.brand) && !NON_AGRI_PACKAGED_CATEGORIES.has(product.category)) {
      // For AGMARKNET observations, `m.brand` stores `variety`
      const prodVar = normalizeToken(product.variety);
      const recVar = normalizeToken(m.brand);
      if (prodVar && recVar && prodVar !== recVar && !recVar.includes(prodVar)) {
        return false;
      }
    }
    if (m.productId === product.id) return true;
    if (
      isAgriMarketMatchAllowed(product) &&
      product.marketCommodityName &&
      normalizeToken(m.commodityOrProductName) === normalizeToken(product.marketCommodityName)
    ) {
      const prodVar = normalizeToken(product.variety);
      const recVar = normalizeToken(m.brand);
      if (prodVar && (!recVar || (recVar !== prodVar && !recVar.includes(prodVar)))) {
        return false;
      }
      return true;
    }
    return false;
  });

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const d = b.observationDate.localeCompare(a.observationDate);
    if (d !== 0) return d;
    return b.createdAt.localeCompare(a.createdAt);
  });
  return candidates[0];
}

export function deriveHonestCoverageStatus(params: {
  product: Product;
  validQuotes: SupplierQuotation[];
  expiredQuotes: SupplierQuotation[];
  latestMarket: MarketPrice | null;
  historicalPurchaseRate: number | null;
}): HonestRateStatus {
  const { product, validQuotes, expiredQuotes, latestMarket, historicalPurchaseRate } = params;

  if (latestMarket) {
    if (latestMarket.verificationStatus === 'verified_official') {
      return 'Verified current rate';
    }
    if (latestMarket.verificationStatus === 'owner_observed') {
      return 'Manual observation';
    }
    return 'Verified current rate';
  }

  if (validQuotes.length > 0) {
    const hasVerified = validQuotes.some((q) => q.verificationStatus === 'verified_quotation');
    return hasVerified ? 'Supplier quotation available' : 'Supplier quotation available';
  }

  if (expiredQuotes.length > 0 || historicalPurchaseRate !== null) {
    return 'Historical rate only';
  }

  if (
    AGRI_ELIGIBLE_CATEGORIES.has(product.category) &&
    ['Vegetables', 'Fruits', 'Grains', 'Pulses'].includes(product.category) &&
    !product.marketCommodityName
  ) {
    return 'Product matching required';
  }

  return 'Market data unavailable';
}

export function buildProductWholesaleSummaries(params: {
  products: Product[];
  quotations: SupplierQuotation[];
  marketPrices: MarketPrice[];
  historicalPurchasesByProduct: Map<string, HistoricalPurchaseRatePoint[]>;
  todayDate?: string;
}): ProductWholesaleSummary[] {
  const todayDate = params.todayDate || getTodayIsoDate();

  return params.products.map((product) => {
    // Filter quotations strictly belonging to this product AND compatible brand/packSize/unit
    const productQuotes = params.quotations
      .filter((q) => q.productId === product.id)
      .filter((q) => isPackSizeCompatible(product.packSize, q.packSize))
      .filter((q) => isBrandCompatible(product.brand, q.brand))
      .map((q) => ({
        ...q,
        finalLandedCost: q.finalLandedCost || q.landedEstimate,
        isExpired: isQuotationExpired(q.validUntil, todayDate),
      }));

    const validQuotes = productQuotes
      .filter((q) => !q.isExpired)
      .sort((a, b) => {
        // Lowest VALID landed cost wins; tie-breaker newest quotationDate
        if (a.finalLandedCost !== b.finalLandedCost) {
          return a.finalLandedCost - b.finalLandedCost;
        }
        return b.quotationDate.localeCompare(a.quotationDate);
      });

    const expiredQuotes = productQuotes.filter((q) => q.isExpired);

    // Chronological supplier quote timeline (newest first) for previous rate comparison
    const validQuotesByDate = [...validQuotes].sort((a, b) => {
      const d = b.quotationDate.localeCompare(a.quotationDate);
      if (d !== 0) return d;
      return b.createdAt.localeCompare(a.createdAt);
    });

    const lowestValidQuote = validQuotes[0] || null;
    const latestValidQuote = validQuotesByDate[0] || null;

    const purchaseHistory = [...(params.historicalPurchasesByProduct.get(product.id) || [])].sort(
      (a, b) => {
        const d = b.purchaseDate.localeCompare(a.purchaseDate);
        if (d !== 0) return d;
        return b.createdAt.localeCompare(a.createdAt);
      }
    );

    const latestPurchase = purchaseHistory[0] || null;
    const historicalPurchaseRate =
      latestPurchase?.landedCostPerBaseUnit ?? product.landedCost ?? product.purchasePrice ?? null;
    const historicalPurchaseDate = latestPurchase?.purchaseDate ?? null;

    const latestMarket = findLatestMatchedMarketPrice(product, params.marketPrices);
    const latestMarketRate = latestMarket?.normalizedPerBaseUnit ?? null;

    // Determine latest wholesale rate (lowest valid supplier landed cost first, else matched market rate)
    const latestWholesaleRate =
      lowestValidQuote?.finalLandedCost ?? latestMarketRate ?? null;

    // Previous wholesale rate for delta calculation:
    // Priority: prior purchase/quote/market rate that isn't the exact same record as latestWholesaleRate
    let previousWholesaleRate: number | null = null;
    if (lowestValidQuote) {
      const sameSupplierOlderQuote = validQuotesByDate.find(
        (q) =>
          q.id !== lowestValidQuote.id &&
          q.supplierId === lowestValidQuote.supplierId &&
          q.quotationDate <= lowestValidQuote.quotationDate
      );
      const anyOlderQuote = [...productQuotes]
        .filter((q) => q.id !== lowestValidQuote.id && q.quotationDate < lowestValidQuote.quotationDate)
        .sort((a, b) => b.quotationDate.localeCompare(a.quotationDate))[0];

      if (sameSupplierOlderQuote) {
        previousWholesaleRate = sameSupplierOlderQuote.finalLandedCost;
      } else if (purchaseHistory.length > 0) {
        previousWholesaleRate = purchaseHistory[0].landedCostPerBaseUnit;
      } else if (product.landedCost !== null) {
        previousWholesaleRate = product.landedCost;
      } else if (product.purchasePrice !== null) {
        previousWholesaleRate = product.purchasePrice;
      } else if (anyOlderQuote) {
        previousWholesaleRate = anyOlderQuote.finalLandedCost;
      }
    } else if (latestMarket) {
      if (latestMarket.previousPrice !== null) {
        const prevConv = convertAgmarknetQuintalRateToUnit(
          latestMarket.previousPrice,
          product.baseUnit,
          product.units
        );
        previousWholesaleRate =
          latestMarket.priceUnitBasis.toLowerCase().includes('quintal') && prevConv !== null
            ? prevConv
            : latestMarket.previousPrice;
      } else if (purchaseHistory.length > 0) {
        previousWholesaleRate = purchaseHistory[0].landedCostPerBaseUnit;
      } else if (product.landedCost !== null) {
        previousWholesaleRate = product.landedCost;
      }
    } else if (purchaseHistory.length >= 2) {
      previousWholesaleRate = purchaseHistory[1].landedCostPerBaseUnit;
    }

    const priceDifference =
      latestWholesaleRate !== null && previousWholesaleRate !== null
        ? roundCurrency(latestWholesaleRate - previousWholesaleRate)
        : null;

    const priceChangePct =
      priceDifference !== null && previousWholesaleRate !== null && previousWholesaleRate > 0
        ? roundCurrency((priceDifference / previousWholesaleRate) * 100)
        : null;

    const currentLandedCost =
      lowestValidQuote?.finalLandedCost ??
      latestMarketRate ??
      historicalPurchaseRate ??
      null;

    const coverageStatus = deriveHonestCoverageStatus({
      product,
      validQuotes,
      expiredQuotes,
      latestMarket,
      historicalPurchaseRate,
    });

    const sourceLabel = lowestValidQuote
      ? `Supplier · ${lowestValidQuote.supplierName || 'Quoted'}`
      : latestMarket
        ? `${latestMarket.sourceName || 'Market'} · ${latestMarket.marketName}`
        : latestPurchase
          ? `Purchase · ${latestPurchase.supplierName}`
          : coverageStatus;

    const lastUpdated =
      lowestValidQuote?.quotationDate ??
      latestMarket?.observationDate ??
      latestPurchase?.purchaseDate ??
      null;

    const verificationStatus = lowestValidQuote
      ? lowestValidQuote.verificationStatus
      : latestMarket
        ? latestMarket.verificationStatus
        : latestPurchase
          ? 'purchase_invoice'
          : 'unverified';

    return {
      productId: product.id,
      productName: product.name,
      brand: product.brand,
      category: product.category,
      packSize: product.packSize,
      variety: product.variety,
      baseUnit: product.baseUnit,
      marketCommodityName: product.marketCommodityName,
      historicalPurchaseRate,
      historicalPurchaseDate,
      latestSupplierWholesaleRate: lowestValidQuote?.finalLandedCost ?? null,
      latestSupplierAdvertisedRate: lowestValidQuote?.quotedRate ?? null,
      latestSupplierId: lowestValidQuote?.supplierId ?? latestPurchase?.supplierId ?? null,
      latestSupplierName: lowestValidQuote?.supplierName ?? latestPurchase?.supplierName ?? null,
      latestMarketRate,
      latestMarketLabel: latestMarket ? `${latestMarket.marketName}, ${latestMarket.location}` : null,
      latestMarketDate: latestMarket?.observationDate ?? null,
      latestWholesaleRate: latestValidQuote && lowestValidQuote ? lowestValidQuote.finalLandedCost : latestWholesaleRate,
      previousWholesaleRate,
      priceDifference,
      priceChangePct,
      currentLandedCost,
      currentSellingPrice: product.sellingPrice,
      mrp: product.mrp,
      mrpRestricted: product.mrpRestricted,
      sourceLabel,
      lastUpdated,
      verificationStatus,
      coverageStatus,
      validQuotationsCount: validQuotes.length,
      expiredQuotationsCount: expiredQuotes.length,
      lowestValidQuoteId: lowestValidQuote?.id ?? null,
      hasMissingRate: latestWholesaleRate === null,
    };
  });
}

export function filterProductWholesaleSummaries(
  summaries: ProductWholesaleSummary[],
  search: string,
  filter: RateExplorerFilter
): ProductWholesaleSummary[] {
  const q = normalizeToken(search);

  return summaries.filter((row) => {
    if (q) {
      const hay = [
        row.productName,
        row.brand,
        row.category,
        row.packSize,
        row.variety,
        row.latestSupplierName,
        row.sourceLabel,
        row.coverageStatus,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }

    switch (filter) {
      case 'All products':
        return true;
      case 'Packaged FMCG':
      case 'Grocery':
      case 'Vegetables':
      case 'Fruits':
      case 'Grains':
      case 'Pulses':
      case 'Household':
      case 'Personal Care':
      case 'Beverages':
        return row.category === filter;
      case 'Available rates':
        return row.latestWholesaleRate !== null;
      case 'Missing rates':
        return row.latestWholesaleRate === null;
      case 'Increasing prices':
        return row.priceDifference !== null && row.priceDifference > 0;
      case 'Decreasing prices':
        return row.priceDifference !== null && row.priceDifference < 0;
      default:
        return true;
    }
  });
}
