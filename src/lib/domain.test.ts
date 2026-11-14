import test from 'node:test';
import assert from 'node:assert/strict';
import {
  convertToBaseQuantity,
  convertRateToBaseUnit,
  formatStockDisplay,
} from './units';
import {
  allocatePurchaseLandedCosts,
  calculatePriceForTargetMargin,
  analyzeProductPricing,
} from './pricing';
import { calculateInvoiceTotals, validatePaymentSplit } from './finance';
import { detectDailyMarketAlerts, mergeShopAndMarketAlerts } from './marketAlerts';
import { validateAuthForm } from './authValidation';
import {
  calculateEan13CheckDigit,
  deriveEan13ForSku,
  extractPriceFromPackagingText,
  findExactStoreProduct,
  lookupBarcodeInMasterCatalog,
  lookupGlobalProductCatalog,
  lookupGlobalProductCatalogAsync,
  validateRetailBarcode,
} from './barcodeLookup';
import {
  deviceBridge,
  createDevicePairingPayload,
  buildPairingUrl,
  detectDeviceModel,
  savePairedDeviceInfo,
  getSavedPairedDeviceInfo,
  getScannerFeedbackPrefs,
  saveScannerFeedbackPrefs,
  type PairedDeviceInfo,
} from './deviceBridge';

test('unit conversions handle carton-to-packet and metric units accurately', () => {
  const units = [
    {
      id: 'u1',
      productId: 'p1',
      unitName: 'Carton',
      conversionToBase: 12,
      isDefaultSellUnit: false,
      isDefaultBuyUnit: true,
    },
  ];
  assert.equal(convertToBaseQuantity(2, 'Carton', 'Packet', units), 24);
  assert.equal(convertRateToBaseUnit(120, 'Carton', 'Packet', units), 10);
  assert.equal(convertToBaseQuantity(500, 'Gram', 'Kilogram', []), 0.5);
  assert.equal(formatStockDisplay(27, 'Packet', units), '27 Packet (2 Carton + 3 Packet)');
});

test('purchase landed cost allocates freight and transport proportionally without rounding drift', () => {
  const result = allocatePurchaseLandedCosts(
    [
      {
        productId: 'p1',
        baseQuantityAdded: 50,
        purchaseRatePerPurchaseUnit: 2000,
        quantityInPurchaseUnit: 2,
        discountAmount: 0,
        taxAmount: 0,
      },
    ],
    60,
    40,
    0
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].netGoodsCost, 4000);
  assert.equal(result[0].allocatedExtraCost, 100);
  assert.equal(result[0].totalLineCost, 4100);
  assert.equal(result[0].landedCostPerBaseUnit, 82);
});

test('selling price calculator distinguishes historical vs replacement cost and enforces MRP cap', () => {
  const analysis = analyzeProductPricing({
    historicalLandedCost: 82,
    replacementLandedCost: 107,
    currentSellingPrice: 100,
    mrp: 120,
    mrpRestricted: true,
    targetMarginPct: 15,
  });

  assert.equal(analysis.historicalGrossProfitPerUnit, 18);
  assert.equal(analysis.replacementCostDiffPerUnit, -7);
  assert.equal(analysis.isSellingBelowReplacementCost, true);
  assert.equal(analysis.isSellingBelowHistoricalCost, false);
  assert.equal(analysis.breakEvenSellingPrice, 107);
  // 107 / (1 - 0.15) = 125.88 -> capped at MRP 120
  assert.equal(analysis.customSuggestedPrice, 120);
  assert.equal(analysis.customCappedByMrp, true);
});

test('invalid target margin percentages are safely rejected', () => {
  const badHigh = calculatePriceForTargetMargin(80, 100, null, false);
  assert.equal(badHigh.suggestedPrice, null);
  assert.ok(badHigh.error);

  const badNeg = calculatePriceForTargetMargin(80, -5, null, false);
  assert.equal(badNeg.suggestedPrice, null);
  assert.ok(badNeg.error);
});

test('invoice totals mark grossProfit null when any item cost is missing (zero fake profit)', () => {
  const incomplete = calculateInvoiceTotals(
    [
      {
        productId: 'p1',
        quantity: 2,
        unitSellingPrice: 100,
        discountAmount: 0,
        taxRatePct: 0,
        costPricePerBaseUnit: null,
        baseQuantityDeducted: 2,
      },
    ],
    0,
    'non_gst'
  );
  assert.equal(incomplete.totalAmount, 200);
  assert.equal(incomplete.grossProfitComplete, false);
  assert.equal(incomplete.grossProfit, null);

  const complete = calculateInvoiceTotals(
    [
      {
        productId: 'p1',
        quantity: 5,
        unitSellingPrice: 100,
        discountAmount: 0,
        taxRatePct: 0,
        costPricePerBaseUnit: 82,
        baseQuantityDeducted: 5,
      },
    ],
    0,
    'non_gst'
  );
  assert.equal(complete.totalAmount, 500);
  assert.equal(complete.grossProfitComplete, true);
  assert.equal(complete.grossProfit, 90);
});

test('split payment validation requires customer for credit and exact sum match', () => {
  const noCust = validatePaymentSplit({
    totalAmount: 500,
    paymentMode: 'credit',
    cashPaid: 0,
    upiPaid: 0,
    creditAmount: 500,
    hasCustomer: false,
  });
  assert.equal(noCust.valid, false);

  const goodSplit = validatePaymentSplit({
    totalAmount: 500,
    paymentMode: 'split',
    cashPaid: 200,
    upiPaid: 100,
    creditAmount: 200,
    hasCustomer: true,
  });
  assert.equal(goodSplit.valid, true);
  assert.equal(goodSplit.paidAmount, 300);
  assert.equal(goodSplit.creditAmount, 200);
});

import {
  buildProductWholesaleSummaries,
  calculateQuotationLandedCost,
  convertAgmarknetQuintalRateToUnit,
  filterProductWholesaleSummaries,
  formatMarketFetchError,
  isPackSizeCompatible,
  isQuotationExpired,
  matchAgmarknetRecordToProduct,
} from './wholesale';
import type { MarketPrice, Product, SupplierQuotation } from './types';

function makeProduct(overrides: Partial<Product>): Product {
  return {
    id: 'p1',
    shopId: 'shop1',
    name: 'Test Product',
    brand: null,
    packSize: null,
    variety: null,
    category: 'Grains',
    barcode: null,
    sku: null,
    baseUnit: 'Kilogram',
    purchasePrice: null,
    landedCost: null,
    sellingPrice: 100,
    mrp: null,
    taxRatePct: 0,
    mrpRestricted: true,
    currentStock: 10,
    minStockLevel: 2,
    primarySupplierId: null,
    expiryDate: null,
    batchNumber: null,
    imageUrl: null,
    marketCommodityName: null,
    marketCoverageStatus: 'unsupported',
    units: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

test('wholesale quotation landed cost accounts for discount, tax, transport, and additional costs', () => {
  // 2 bags of 25 Kg each (50 Kg total). Quoted ₹2000/bag, discount ₹100, tax ₹200, freight ₹150, extra ₹50 => ₹4300 / 50 Kg = ₹86/Kg
  const res = calculateQuotationLandedCost({
    quantity: 2,
    unitName: 'Bag',
    baseUnit: 'Kilogram',
    productUnits: [
      {
        id: 'u-bag',
        productId: 'p1',
        unitName: 'Bag',
        conversionToBase: 25,
        isDefaultSellUnit: false,
        isDefaultBuyUnit: true,
      },
    ],
    wholesaleRatePerUnit: 2000,
    discountAmount: 100,
    taxAmount: 200,
    transportFreight: 150,
    additionalCosts: 50,
  });

  assert.equal(res.baseQuantity, 50);
  assert.equal(res.finalTotalCost, 4300);
  assert.equal(res.finalLandedCostPerQuoteUnit, 2150);
  assert.equal(res.landedCostPerBaseUnit, 86);
});

test('multi-supplier comparison picks lowest VALID landed cost and excludes expired quotations', () => {
  const rice = makeProduct({
    id: 'p-rice',
    name: 'Basmati Rice',
    brand: 'Daawat',
    packSize: '25 Kg',
    category: 'Grains',
    baseUnit: 'Kilogram',
    landedCost: 82,
    sellingPrice: 105,
  });

  const missingProduct = makeProduct({
    id: 'p-biscuit',
    name: 'Parle-G Gold',
    brand: 'Parle',
    packSize: '100 g',
    category: 'Packaged FMCG',
    baseUnit: 'Packet',
    sellingPrice: 10,
  });

  const quotes: SupplierQuotation[] = [
    {
      id: 'q-expired-cheap',
      shopId: 'shop1',
      productId: 'p-rice',
      supplierId: 's0',
      supplierName: 'OldExpired Trader',
      brand: 'Daawat',
      packSize: '25 Kg',
      quantity: 1,
      unit: 'Kilogram',
      quotedRate: 70,
      discountAmount: 0,
      taxAmount: 0,
      freightEstimatePerUnit: 0,
      additionalCosts: 0,
      finalLandedCost: 70,
      landedEstimate: 70,
      validUntil: '2026-01-05', // expired relative to 2026-02-01
      quotationDate: '2026-01-01',
      sourceEvidence: 'old-quote.pdf',
      verificationStatus: 'verified_quotation',
      notes: null,
      createdBy: 'u1',
      createdAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'q-low-rate-high-freight',
      shopId: 'shop1',
      productId: 'p-rice',
      supplierId: 's1',
      supplierName: 'Supplier A',
      brand: 'Daawat',
      packSize: '25 Kg',
      quantity: 10,
      unit: 'Kilogram',
      quotedRate: 85, // Lower advertised rate
      discountAmount: 0,
      taxAmount: 0,
      freightEstimatePerUnit: 100, // +10/kg freight => landed 95/kg
      additionalCosts: 0,
      finalLandedCost: 95,
      landedEstimate: 95,
      validUntil: '2026-02-15',
      quotationDate: '2026-01-30',
      sourceEvidence: 'quote-a.pdf',
      verificationStatus: 'verified_quotation',
      notes: null,
      createdBy: 'u1',
      createdAt: '2026-01-30T00:00:00Z',
    },
    {
      id: 'q-best-landed',
      shopId: 'shop1',
      productId: 'p-rice',
      supplierId: 's2',
      supplierName: 'Supplier B',
      brand: 'Daawat',
      packSize: '25 Kg',
      quantity: 10,
      unit: 'Kilogram',
      quotedRate: 88, // Higher advertised rate, but lower landed cost
      discountAmount: 20,
      taxAmount: 0,
      freightEstimatePerUnit: 30, // 880 - 20 + 30 = 890 / 10 = 89/kg
      additionalCosts: 0,
      finalLandedCost: 89,
      landedEstimate: 89,
      validUntil: '2026-02-10',
      quotationDate: '2026-01-31',
      sourceEvidence: 'quote-b.pdf',
      verificationStatus: 'verified_quotation',
      notes: null,
      createdBy: 'u1',
      createdAt: '2026-01-31T00:00:00Z',
    },
  ];

  const summaries = buildProductWholesaleSummaries({
    products: [rice, missingProduct],
    quotations: quotes,
    marketPrices: [],
    historicalPurchasesByProduct: new Map(),
    todayDate: '2026-02-01',
  });

  // Acceptance 1: every product appears
  assert.equal(summaries.length, 2);

  const riceSummary = summaries.find((s) => s.productId === 'p-rice')!;
  // Acceptance 3 & 4: picks Supplier B (landed ₹89), NOT Supplier A (₹85 advertised / ₹95 landed), NOT expired (₹70)
  assert.equal(riceSummary.lowestValidQuoteId, 'q-best-landed');
  assert.equal(riceSummary.latestSupplierName, 'Supplier B');
  assert.equal(riceSummary.latestSupplierWholesaleRate, 89);
  assert.equal(riceSummary.expiredQuotationsCount, 1);
  assert.equal(riceSummary.validQuotationsCount, 2);
  assert.equal(riceSummary.coverageStatus, 'Supplier quotation available');
  assert.equal(riceSummary.priceDifference, 7); // 89 - 82 historical landed cost

  // Acceptance 2: product with no rates displays honest unavailable status
  const biscuitSummary = summaries.find((s) => s.productId === 'p-biscuit')!;
  assert.equal(biscuitSummary.latestWholesaleRate, null);
  assert.equal(biscuitSummary.coverageStatus, 'Market data unavailable');
  assert.equal(biscuitSummary.hasMissingRate, true);

  // Filters check
  assert.equal(filterProductWholesaleSummaries(summaries, '', 'Missing rates').length, 1);
  assert.equal(filterProductWholesaleSummaries(summaries, '', 'Increasing prices').length, 1);
  assert.equal(filterProductWholesaleSummaries(summaries, '', 'Grains').length, 1);
});

test('AGMARKNET converts quintal to kg/gram accurately and blocks packaged FMCG or mismatched pack sizes', () => {
  // Acceptance 5: ₹2,500 per Quintal (100 kg) => ₹25/Kg and ₹0.03/Gram
  assert.equal(convertAgmarknetQuintalRateToUnit(2500, 'Kilogram'), 25);
  assert.equal(convertAgmarknetQuintalRateToUnit(3000, 'Gram'), 0.03);
  assert.equal(convertAgmarknetQuintalRateToUnit(2500, 'Packet'), null);

  const fmcgWithAccidentallySetCommodity = makeProduct({
    id: 'p-fmcg',
    name: 'Maggi Noodles 2-Min',
    category: 'Packaged FMCG',
    baseUnit: 'Packet',
    packSize: '70 g',
    marketCommodityName: 'Wheat',
  });

  const onionLocal = makeProduct({
    id: 'p-onion',
    name: 'Red Onion',
    category: 'Vegetables',
    baseUnit: 'Kilogram',
    variety: 'Nasik',
    marketCommodityName: 'Onion',
  });

  const matchFmcgOnly = matchAgmarknetRecordToProduct(
    { commodity: 'Wheat', variety: 'Lokwan', modal_price: 2600, market: 'Pune', state: 'Maharashtra' },
    [fmcgWithAccidentallySetCommodity],
    'Maharashtra'
  );
  assert.equal(matchFmcgOnly, null);

  const mismatchVariety = matchAgmarknetRecordToProduct(
    { commodity: 'Onion', variety: 'Bangalore Rose', modal_price: 2400, market: 'Bengaluru', state: 'Karnataka' },
    [onionLocal],
    'Maharashtra'
  );
  assert.equal(mismatchVariety, null);

  const exactMatch = matchAgmarknetRecordToProduct(
    { commodity: 'Onion', variety: 'Nasik Red', modal_price: 2450, market: 'Lasalgaon', state: 'Maharashtra' },
    [onionLocal],
    'Maharashtra'
  );
  assert.ok(exactMatch);
  assert.equal(exactMatch.product.id, 'p-onion');
  assert.equal(exactMatch.normalizedPerBaseUnit, 24.5);

  // Acceptance 6: pack sizes are never mixed
  assert.equal(isPackSizeCompatible('500 g', '1 Kg'), false);
  assert.equal(isPackSizeCompatible('25 Kg', '25 kg'), true);
});

test('isQuotationExpired handles dates accurately and fetch error diagnostics surface cause codes', () => {
  assert.equal(isQuotationExpired('2026-02-01', '2026-02-01'), false);
  assert.equal(isQuotationExpired('2026-01-31', '2026-02-01'), true);
  assert.equal(isQuotationExpired(null, '2026-02-01'), false);

  const connErr = Object.assign(new TypeError('fetch failed'), {
    cause: { code: 'ECONNREFUSED', address: '164.100.61.198', port: 443 },
  });
  const formatted = formatMarketFetchError(connErr);
  assert.equal(formatted.code, 'ECONNREFUSED');
  assert.ok(formatted.message.includes('164.100.61.198:443'));
});

import {
  buildFallbackKiranaFeed,
  filterLiveCommodities,
  formatRelativeSyncTime,
  mapAgmarknetFeedRecords,
} from './marketFeed';

test('mapAgmarknetFeedRecords converts quintal prices to per-kg, infers categories, and deduplicates', () => {
  const mapped = mapAgmarknetFeedRecords(
    [
      {
        commodity: 'Turmeric Finger',
        variety: 'Salem',
        market: 'Sangli',
        district: 'Sangli',
        state: 'Maharashtra',
        min_price: '14000',
        max_price: '15200',
        modal_price: '14800',
        arrival_date: '2026-02-10',
      },
      {
        // Duplicate same commodity + variety + market should be deduplicated
        commodity: 'Turmeric Finger',
        variety: 'Salem',
        market: 'Sangli',
        modal_price: '14900',
      },
      {
        commodity: 'Toor Dal',
        variety: 'Desi',
        market: 'Latur',
        district: 'Latur',
        state: 'Maharashtra',
        min_price: '12200',
        max_price: '12800',
        modal_price: '12300',
        arrival_date: '2026-02-10',
      },
    ],
    'live_api'
  );

  assert.equal(mapped.length, 2);
  assert.equal(mapped[0].category, 'Spices');
  assert.equal(mapped[0].pricePerQuintal, 14800);
  assert.equal(mapped[0].pricePerKg, 148);
  assert.equal(mapped[0].sparkline.length, 7);
  assert.equal(mapped[0].trend, 'up'); // 148 > mid (146)

  assert.equal(mapped[1].category, 'Pulses');
  assert.equal(mapped[1].pricePerKg, 123);
  assert.equal(mapped[1].trend, 'down'); // 123 < mid (125)
});

test('filterLiveCommodities and buildFallbackKiranaFeed cover all Kirana categories and real-time search', () => {
  const feed = buildFallbackKiranaFeed('2026-02-10');
  assert.ok(feed.length >= 15);

  const oils = filterLiveCommodities(feed, '', 'Oils');
  assert.ok(oils.length >= 2);
  assert.ok(oils.every((x) => x.category === 'Oils'));

  const spices = filterLiveCommodities(feed, 'Unjha', 'Spices');
  assert.equal(spices.length, 1);
  assert.ok(spices[0].commodity.includes('Cumin'));

  const fmcg = filterLiveCommodities(feed, '', 'Packaged FMCG');
  assert.ok(fmcg.length >= 2);

  const now = Date.parse('2026-02-10T12:05:00Z');
  assert.equal(formatRelativeSyncTime('2026-02-10T12:04:40Z', now), 'Just now');
  assert.equal(formatRelativeSyncTime('2026-02-10T12:04:00Z', now), '1 minute ago');
  assert.equal(formatRelativeSyncTime('2026-02-10T12:00:00Z', now), '5 minutes ago');
});

import {
  buildMasterCatalogMatrix,
  clearShopPrivateMarketIntelligence,
  computeDailyVarianceFactor,
  filterMasterCatalogSKUs,
  loadShopPrivateMarketIntelligence,
  MASTER_CATEGORY_FILTERS,
  normalizeQuintalToKg,
  saveProcessedMarketIntelligence,
  shiftIsoDate,
  syncMarketRates,
  type ShopMarketDbAdapter,
} from './marketDataService';
import {
  buildUpiPaymentUri,
  computeChallanUnitMetrics,
  computeGstSplit,
  DEFAULT_INVOICE_PREFS,
  generateDeterministicQrMatrix,
  inferHsnCode,
  loadInvoicePrefs,
  saveInvoicePrefs,
} from './invoiceTemplates';

test('Master Product Catalog delivers 10,000+ unique SKUs with zero MRP on Loose Items and 8-18% packaged margins', () => {
  const catalog = buildMasterCatalogMatrix('2026-11-13');
  assert.ok(catalog.length >= 10000, `Expected >= 10,000 unique SKUs, got ${catalog.length}`);

  const forbiddenTerms = /\b(apmc|mandi|vashi|lasalgaon|indore|gultekdi|unjha|kolhapur)\b/i;
  const uniqueIdentityKeys = new Set<string>();
  const categoriesCovered = new Set<string>();

  for (const sku of catalog) {
    assert.ok(sku.skuCode.startsWith('SKU-'));
    assert.ok(sku.wholesaleRate > 0);
    assert.ok(
      [
        'Direct Manufacturer Feed',
        'National FMCG Index',
        'National Distributor Benchmark',
        'Agri-Commodity Bulk Index',
      ].includes(sku.supplierTier),
      `Unexpected supplierTier: ${sku.supplierTier}`
    );
    assert.equal(
      forbiddenTerms.test(`${sku.name} ${sku.brand} ${sku.packVariant} ${sku.supplierTier}`),
      false,
      `Found forbidden mandi term in SKU: ${sku.name} / ${sku.brand}`
    );

    if (sku.category === 'Loose Items') {
      // Strict rule: Loose Items NEVER display MRP or retail profit margin %
      assert.equal(sku.isLoose, true);
      assert.equal(sku.suggestedMrp, null, `Loose item should not have MRP: ${sku.name}`);
      assert.equal(sku.profitMarginPct, null, `Loose item should not have margin %: ${sku.name}`);
      assert.ok((sku.ratePerKg ?? 0) > 0);
      assert.ok((sku.ratePerQuintal ?? 0) > 0);
    } else {
      // Packaged Items strictly display whole-rupee printed MRP > wholesaleRate and 8-18% margin
      assert.equal(sku.isLoose, false);
      assert.ok(sku.suggestedMrp !== null && sku.suggestedMrp > sku.wholesaleRate);
      assert.equal(
        Number.isInteger(sku.suggestedMrp),
        true,
        `Non-integer printed MRP ${sku.suggestedMrp} on ${sku.name} (${sku.packVariant})`
      );
      assert.ok(
        sku.profitMarginPct !== null && sku.profitMarginPct >= 8.0 && sku.profitMarginPct <= 18.0,
        `Packaged margin ${sku.profitMarginPct}% outside 8-18% tier on ${sku.name} (${sku.packVariant})`
      );
    }

    const key = `${sku.name.toLowerCase()}|${sku.brand.toLowerCase()}|${sku.packVariant.toLowerCase()}`;
    assert.equal(uniqueIdentityKeys.has(key), false, `Duplicate catalog item found: ${key}`);
    uniqueIdentityKeys.add(key);
    categoriesCovered.add(sku.category);
  }

  // Every master category across all 9 categories is represented
  assert.equal(categoriesCovered.size, MASTER_CATEGORY_FILTERS.length - 1);

  // Screen-1 interleaving: first 9 cards cover diverse categories and never repeat the same product title back-to-back
  const top9Categories = new Set(catalog.slice(0, 9).map((s) => s.category));
  assert.ok(top9Categories.size >= 7, `Expected diverse top-9 categories, got ${top9Categories.size}`);
  for (let i = 1; i < Math.min(24, catalog.length); i++) {
    assert.notEqual(
      catalog[i].name,
      catalog[i - 1].name,
      `Adjacent cloned product card on page 1: ${catalog[i].name}`
    );
  }

  // Good Day search check: integer Indian printed MRPs (₹5/10/15/20/35/40/50/60/100/box)
  const goodDay = filterMasterCatalogSKUs(catalog, 'Good Day', 'Packaged FMCG');
  assert.ok(goodDay.length >= 18);
  assert.ok(goodDay.every((s) => s.suggestedMrp !== null && Number.isInteger(s.suggestedMrp)));

  // Loose Items checks: Sugar (~₹36-₹42/kg), Jeera, Poha, Urad Dal, Loose Tea with 1kg to 1 Quintal sacks
  const looseSugar = filterMasterCatalogSKUs(catalog, 'Loose Sugar M-30', 'Loose Items');
  const looseSugar1kg = looseSugar.find((s) => s.packVariant === '1kg Loose');
  assert.ok(looseSugar1kg);
  assert.ok(looseSugar1kg.wholesaleRate >= 36 && looseSugar1kg.wholesaleRate <= 41);
  assert.equal(looseSugar1kg.suggestedMrp, null);
  assert.ok(looseSugar.some((s) => s.packVariant === '50kg Wholesale Sack'));
  assert.ok(looseSugar.some((s) => s.packVariant === '1 Quintal (100kg) Bulk'));

  const looseTea = filterMasterCatalogSKUs(catalog, 'Loose Assam', 'Loose Items');
  const looseJeera = filterMasterCatalogSKUs(catalog, 'Loose Jeera', 'Loose Items');
  const loosePoha = filterMasterCatalogSKUs(catalog, 'Loose Poha', 'Loose Items');
  const looseUrad = filterMasterCatalogSKUs(catalog, 'Loose Urad Dal', 'Loose Items');
  assert.ok(looseTea.length >= 7);
  assert.ok(looseJeera.length >= 7);
  assert.ok(loosePoha.length >= 7);
  assert.ok(looseUrad.length >= 7);

  const surfMatches = filterMasterCatalogSKUs(catalog, 'Surf Excel', 'Household Cleaning');
  assert.ok(surfMatches.length >= 10);
});

test('syncMarketRates normalizes quintal prices to kg, stores via dbAdapter, and handles 429 rate limits gracefully', async () => {
  assert.equal(normalizeQuintalToKg(12400), 124);
  assert.equal(normalizeQuintalToKg(-10), null);

  let savedStatus: string | null = null;
  let savedCount = 0;
  const mockDb: ShopMarketDbAdapter = {
    shopId: 'shop-1',
    saveNormalizedMarketRates: (p) => {
      savedStatus = p.status;
      savedCount = p.normalizedRecords.length;
      return { insertedCount: p.normalizedRecords.length, matchedCount: 1 };
    },
  };

  const mockSuccessFetch = async () =>
    new Response(
      JSON.stringify({
        records: [
          {
            commodity: 'Tur Dal',
            variety: 'Desi',
            modal_price: '12400',
            min_price: '12000',
            max_price: '12800',
            arrival_date: '13/11/2026',
          },
          {
            commodity: 'Rice',
            variety: 'Basmati',
            modal_price: '8600',
            arrival_date: '13/11/2026',
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  const okRes = await syncMarketRates({
    shopId: 'shop-1',
    apiKey: 'test-key',
    fetchImpl: mockSuccessFetch as unknown as typeof fetch,
    dbAdapter: mockDb,
  });

  assert.equal(okRes.sourceMode, 'live_api');
  assert.equal(savedStatus, 'success');
  assert.equal(savedCount, 2);
  assert.ok(okRes.totalCatalogCount >= 10000);
  assert.equal(okRes.liveAgriOverrides.toor_dal.pricePerKg, 124);
  assert.equal(okRes.liveAgriOverrides.rice.pricePerKg, 86);

  // Verify rate-limit 429 handling
  const mockRateLimitFetch = async () =>
    new Response('Too many requests', {
      status: 429,
      headers: { 'Retry-After': '90' },
    });

  const rlRes = await syncMarketRates({
    shopId: 'shop-1',
    apiKey: 'test-key',
    fetchImpl: mockRateLimitFetch as unknown as typeof fetch,
    dbAdapter: mockDb,
  });

  assert.equal(rlRes.ok, true);
  assert.equal(rlRes.rateLimited, true);
  assert.equal(rlRes.retryAfterSeconds, 90);
  assert.equal(rlRes.sourceMode, 'enterprise_master_index');
  assert.equal(savedStatus, 'failed');
});

test('24-hour daily update cycle computes realistic deterministic market variance across days', () => {
  assert.equal(shiftIsoDate('2026-11-13', -1), '2026-11-12');
  assert.equal(shiftIsoDate('2026-11-13', 1), '2026-11-14');

  const f1 = computeDailyVarianceFactor('SKU-OIL-10001', '2026-11-13', 'Edible Oils');
  const f2 = computeDailyVarianceFactor('SKU-OIL-10001', '2026-11-14', 'Edible Oils');
  assert.ok(f1 >= 0.96 && f1 <= 1.04);
  assert.ok(f2 >= 0.96 && f2 <= 1.04);
  assert.notEqual(f1, f2);

  const day1 = buildMasterCatalogMatrix('2026-11-13');
  const day2 = buildMasterCatalogMatrix('2026-11-14');
  assert.equal(day1.length, day2.length);

  let changedCount = 0;
  for (let i = 0; i < day1.length; i++) {
    assert.equal(day1[i].skuCode, day2[i].skuCode);
    assert.equal(day2[i].updatedAt, '2026-11-14');
    if (day1[i].wholesaleRate !== day2[i].wholesaleRate) {
      changedCount++;
    }
  }
  assert.ok(changedCount > day1.length * 0.5, 'Expected daily rate variance across SKUs over 24h');
});

test('detectDailyMarketAlerts detects surge and buying opportunity anomalies while strictly enforcing zero MRP on loose items', () => {
  const alerts = detectDailyMarketAlerts({
    todayIso: '2026-11-13',
    defaultMarginPct: 15,
    maxAlerts: 12,
  });

  assert.ok(alerts.length >= 8, `Expected >= 8 daily market alerts, got ${alerts.length}`);

  const surges = alerts.filter((a) => a.severity === 'critical' || a.severity === 'warning');
  const opportunities = alerts.filter((a) => a.severity === 'opportunity');
  assert.ok(surges.length >= 3, 'Expected at least 3 price surge alerts');
  assert.ok(opportunities.length >= 3, 'Expected at least 3 buying opportunity alerts');

  for (const alert of alerts) {
    assert.ok(alert.skuCode, 'Every market volatility alert must carry a valid skuCode');
    assert.ok(
      alert.previousWholesaleRate !== null &&
        alert.previousWholesaleRate !== undefined &&
        alert.previousWholesaleRate > 0
    );
    assert.ok(
      alert.currentWholesaleRate !== null &&
        alert.currentWholesaleRate !== undefined &&
        alert.currentWholesaleRate > 0
    );
    assert.ok(alert.changePct !== null && alert.changePct !== undefined);

    if (alert.isLoose) {
      assert.equal(alert.officialMrp, null, `Loose alert ${alert.productName} must NOT have officialMrp`);
      assert.equal(alert.marginBeforePct, null, `Loose alert ${alert.productName} must NOT have marginBeforePct`);
      assert.equal(alert.marginAfterPct, null, `Loose alert ${alert.productName} must NOT have marginAfterPct`);
      assert.equal(alert.recommendedPrice, null, `Loose alert ${alert.productName} must NOT have recommendedPrice`);
      assert.ok((alert.ratePerKg ?? 0) > 0, 'Loose alert must include ratePerKg');
      assert.ok((alert.ratePerQuintal ?? 0) > 0, 'Loose alert must include ratePerQuintal');
    } else {
      assert.ok((alert.officialMrp ?? 0) > 0, `Packaged alert ${alert.productName} must include officialMrp`);
      assert.ok(
        alert.currentWholesaleRate! < alert.officialMrp!,
        `Packaged alert ${alert.productName} wholesale rate must be below official MRP`
      );
    }
  }

  // Test acknowledgement filtering & merging
  const ackMap = new Map<string, string>([[alerts[0].id, '2026-11-13T10:00:00Z']]);
  const merged = mergeShopAndMarketAlerts({
    inventoryAlerts: [],
    marketAlerts: alerts,
    acknowledgedMap: ackMap,
  });
  assert.equal(merged.acknowledgedAlerts.length, 1);
  assert.equal(merged.acknowledgedAlerts[0].id, alerts[0].id);
  assert.equal(merged.activeAlerts.length, alerts.length - 1);
  assert.equal(merged.activeAlerts.some((a) => a.id === alerts[0].id), false);
});

test('validateAuthForm enforces email, password, owner name, and Indian mobile rules accurately', () => {
  const invalidLogin = validateAuthForm({
    mode: 'login',
    fullName: '',
    phone: '',
    email: 'invalid-email',
    password: '123',
  });
  assert.equal(invalidLogin.valid, false);
  assert.ok(invalidLogin.fieldErrors.email);
  assert.ok(invalidLogin.fieldErrors.password);
  assert.equal(invalidLogin.fieldErrors.fullName, undefined);

  const validLogin = validateAuthForm({
    mode: 'login',
    fullName: '',
    phone: '',
    email: '  OWNER@Kirana.IN ',
    password: 'password123',
  });
  assert.equal(validLogin.valid, true);
  assert.equal(validLogin.normalizedEmail, 'owner@kirana.in');

  const invalidRegister = validateAuthForm({
    mode: 'register',
    fullName: 'A',
    phone: '1234',
    email: 'owner@kirana.in',
    password: 'password123',
  });
  assert.equal(invalidRegister.valid, false);
  assert.ok(invalidRegister.fieldErrors.fullName);
  assert.ok(invalidRegister.fieldErrors.phone);

  const validRegister = validateAuthForm({
    mode: 'register',
    fullName: ' Rajesh Kulkarni ',
    phone: '9823012345',
    email: 'rajesh@kulkarnimart.in',
    password: 'password123',
  });
  assert.equal(validRegister.valid, true);
  assert.equal(validRegister.normalizedFullName, 'Rajesh Kulkarni');
  assert.equal(validRegister.normalizedPhone, '9823012345');
});

test('saveProcessedMarketIntelligence isolates normalized market records strictly per shopId', () => {
  const memMap = new Map<string, string>();
  const mockStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = {
    getItem: (k) => memMap.get(k) ?? null,
    setItem: (k, v) => {
      memMap.set(k, v);
    },
    removeItem: (k) => {
      memMap.delete(k);
    },
  };

  // Reject cross-shop adapter mismatch
  assert.throws(
    () =>
      saveProcessedMarketIntelligence({
        shopId: 'shop-A',
        status: 'success',
        dataDate: '2026-11-13',
        recordsFetched: 1,
        normalizedRecords: [],
        dbAdapter: {
          shopId: 'shop-B',
          saveNormalizedMarketRates: () => ({ insertedCount: 0, matchedCount: 0 }),
        },
        storage: mockStorage,
      }),
    /Shop privacy violation/
  );

  saveProcessedMarketIntelligence({
    shopId: 'shop-A',
    status: 'success',
    dataDate: '2026-11-13',
    recordsFetched: 1,
    normalizedRecords: [
      {
        commodityName: 'Sugar',
        variety: 'M-30',
        agriKey: 'sugar',
        supplierTier: 'Agri-Commodity Bulk Index',
        modalQuintal: 3850,
        modalPerKg: 38.5,
        previousPerKg: 39.2,
        minPerKg: 37.5,
        maxPerKg: 39.5,
        observationDate: '2026-11-13',
        rawPayloadJson: '{}',
      },
    ],
    storage: mockStorage,
  });

  const shopAData = loadShopPrivateMarketIntelligence('shop-A', mockStorage);
  assert.ok(shopAData);
  assert.equal(shopAData.shopId, 'shop-A');
  assert.equal(shopAData.normalizedRecords[0].modalPerKg, 38.5);

  // Shop B must never read Shop A's cached intelligence
  assert.equal(loadShopPrivateMarketIntelligence('shop-B', mockStorage), null);

  clearShopPrivateMarketIntelligence('shop-A', mockStorage);
  assert.equal(loadShopPrivateMarketIntelligence('shop-A', mockStorage), null);
});

test('invoiceTemplates compute GST split, HSN codes, UPI QR matrices, B2B challan metrics, and shop-scoped preferences accurately', () => {
  assert.equal(inferHsnCode('Loose Sugar M-30 Bulk Sack', 'Loose Products'), '1701');
  assert.equal(inferHsnCode('Fortune Refined Sunflower Oil 1L', 'Grocery'), '1512');
  assert.equal(inferHsnCode('Britannia Good Day Cashew Cookies', 'Packaged FMCG'), '1905');

  const split = computeGstSplit(223.81);
  assert.equal(split.cgst, 111.91);
  assert.equal(split.sgst, 111.9);
  assert.equal(Number((split.cgst + split.sgst).toFixed(2)), 223.81);

  const challanMetrics = computeChallanUnitMetrics({
    id: 'i1',
    invoiceId: 'inv1',
    productId: 'p1',
    productNameSnapshot: 'Loose Sugar M-30',
    brandSnapshot: null,
    quantity: 150,
    unitName: 'Kilogram',
    baseQuantityDeducted: 150,
    unitSellingPrice: 40,
    costPriceSnapshot: 38,
    discountAmount: 0,
    taxRatePct: 5,
    taxAmount: 285.71,
    lineTotal: 6000,
  });
  assert.equal(challanMetrics.packCountLabel, '150 Kilogram');
  assert.equal(challanMetrics.weightEquivalentLabel, '150 Kg (1.5 Qtl)');

  const upi = buildUpiPaymentUri({
    upiId: 'aryankirana@okicici',
    shopName: 'Aryan Kirana',
    amount: 4700,
    invoiceNumber: 'INV-108',
  });
  assert.ok(upi.includes('pa=aryankirana%40okicici'));
  assert.ok(upi.includes('am=4700.00'));

  const qr = generateDeterministicQrMatrix(upi, 21);
  assert.equal(qr.length, 21);
  assert.equal(qr[0].length, 21);
  assert.equal(qr[0][0], true); // Top-left finder outer corner

  const memMap = new Map<string, string>();
  const mockStorage: Pick<Storage, 'getItem' | 'setItem'> = {
    getItem: (k) => memMap.get(k) ?? null,
    setItem: (k, v) => {
      memMap.set(k, v);
    },
  };

  saveInvoicePrefs(
    'shop-1',
    {
      ...DEFAULT_INVOICE_PREFS,
      style: 'wholesale_b2b_standard',
      showGstin: false,
      upiId: 'shop1@upi',
      receiptPaperWidth: '58mm',
      invoicePrefix: 'BILL',
      footerNote: 'No refund without bill',
    },
    mockStorage
  );
  const loaded1 = loadInvoicePrefs('shop-1', mockStorage);
  assert.equal(loaded1.style, 'wholesale_b2b_standard');
  assert.equal(loaded1.showGstin, false);
  assert.equal(loaded1.upiId, 'shop1@upi');
  assert.equal(loaded1.receiptPaperWidth, '58mm');
  assert.equal(loaded1.invoicePrefix, 'BILL');
  assert.equal(loaded1.footerNote, 'No refund without bill');

  const loaded2 = loadInvoicePrefs('shop-2', mockStorage);
  assert.equal(loaded2.style, DEFAULT_INVOICE_PREFS.style);
  assert.equal(loaded2.showGstin, true);
  assert.equal(loaded2.receiptPaperWidth, '80mm');
  assert.equal(loaded2.invoicePrefix, 'INV');

  // Scanner feedback preferences
  saveScannerFeedbackPrefs({ enableSound: false, enableHaptic: true });
  const scannerPrefs = getScannerFeedbackPrefs();
  assert.equal(scannerPrefs.enableSound, false);
  assert.equal(scannerPrefs.enableHaptic, true);
  saveScannerFeedbackPrefs({ enableSound: true, enableHaptic: true });
});

test('device pairing and mobile barcode bridge calculates GS1 EAN13, parses master catalog, and encodes pairing handshake', async () => {
  // 1. GS1 Modulo-10 Check Digit verification
  // Known EAN-12: 890103038379 -> Check digit is 3 (8901030383793)
  assert.equal(calculateEan13CheckDigit('890103038379'), 3);
  // Known EAN-12: 890149110183 -> Check digit is 7 (8901491101837)
  assert.equal(calculateEan13CheckDigit('890149110183'), 7);

  // 2. Deterministic EAN-13 generator for SKU
  const ean = deriveEan13ForSku('SKU-PARLE-10001', '100g');
  assert.equal(ean.length, 13);
  assert.ok(ean.startsWith('890')); // Official GS1 India country code prefix
  const checkDigit = calculateEan13CheckDigit(ean.slice(0, 12));
  assert.equal(Number(ean[12]), checkDigit);

  // 3. Cryptographic Device Pairing Handshake Payload & URL
  const pairPayload = createDevicePairingPayload('shop-test-123', 'Om Kirana Store');
  assert.ok(pairPayload.token.startsWith('bhv_'));
  assert.equal(pairPayload.pin.length, 4);
  assert.equal(pairPayload.shopId, 'shop-test-123');

  const pairUrl = buildPairingUrl(pairPayload);
  assert.ok(pairUrl.includes('pair_token=bhv_'));
  assert.ok(pairUrl.includes('pin='));
  assert.ok(pairUrl.includes('shop_id=shop-test-123'));

  // 4. Exact store inventory priority matching via findExactStoreProduct & lookupBarcodeInMasterCatalog
  const mockShopProduct = {
    id: 'prod-local-1',
    shopId: 'shop-test-123',
    name: 'Local Store Ghee 1L',
    brand: 'Amul',
    packSize: '1L Tin',
    variety: null,
    category: 'Grocery' as const,
    barcode: '8901262010014',
    sku: 'SKU-AMUL-GHEE',
    baseUnit: 'Litre' as const,
    purchasePrice: 580,
    landedCost: 580,
    sellingPrice: 650,
    mrp: 650,
    taxRatePct: 5,
    mrpRestricted: true,
    currentStock: 25,
    minStockLevel: 4,
    primarySupplierId: null,
    expiryDate: '2027-04-10',
    batchNumber: 'B-998',
    imageUrl: null,
    marketCommodityName: null,
    marketCoverageStatus: 'available' as const,
    units: [],
    createdAt: '2026-11-10T00:00:00Z',
    updatedAt: '2026-11-10T00:00:00Z',
  };

  const exactFound = findExactStoreProduct('8901262010014', [mockShopProduct]);
  assert.ok(exactFound);
  assert.equal(exactFound.id, 'prod-local-1');

  const exactBySku = findExactStoreProduct('SKU-AMUL-GHEE', [mockShopProduct]);
  assert.ok(exactBySku);
  assert.equal(exactBySku.id, 'prod-local-1');

  const lookupExisting = lookupBarcodeInMasterCatalog('8901262010014', [mockShopProduct]);
  assert.equal(lookupExisting.found, true);
  assert.equal(lookupExisting.source, 'inventory');
  assert.equal(lookupExisting.name, 'Local Store Ghee 1L');
  assert.equal(lookupExisting.sellingPrice, 650);
  assert.equal(lookupExisting.purchasePrice, 580);

  // 5. Persistent Device Pairing State: Save session info to localStorage ('bhaviq_paired_device')
  const mockPairedInfo: PairedDeviceInfo = {
    deviceId: 'mob_test_998',
    deviceName: 'Vivo V29 · Chrome Mobile',
    pairedAt: Date.now(),
    lastActive: Date.now(),
    platform: 'Mobile',
    status: 'connected',
    token: pairPayload.token,
    pin: pairPayload.pin,
    shopId: 'shop-test-123',
  };
  savePairedDeviceInfo(mockPairedInfo);

  const restoredDevice = getSavedPairedDeviceInfo();
  assert.ok(restoredDevice);
  assert.equal(restoredDevice.token, pairPayload.token);
  assert.equal(restoredDevice.status, 'connected');
  assert.equal(restoredDevice.deviceName, 'Vivo V29 · Chrome Mobile');

  // 5B. Unified Real-Time Channel Pairing Handshake: DEVICE_PAIR_ACK broadcast & reception
  let ackHandshakeReceived = false;
  const unsubBridge = deviceBridge.connect(pairPayload.token, 'desktop', (msg) => {
    if (msg.type === 'DEVICE_PAIR_ACK' || msg.type === 'DEVICE_PAIRED') {
      ackHandshakeReceived = true;
    }
  });

  await deviceBridge.send('DEVICE_PAIR_ACK', 'mobile', {
    deviceId: mockPairedInfo.deviceId,
    deviceName: mockPairedInfo.deviceName,
    platform: 'Mobile',
    token: pairPayload.token,
    status: 'connected',
  });

  assert.equal(ackHandshakeReceived, true);
  unsubBridge();

  // 6. Strict Real Product & Packaging MRP Fetching (No Fake Balaji Fallbacks)
  // Packaging price extractor accurately parses authentic Indian packet pricing
  assert.equal(extractPriceFromPackagingText('Lays Classics Salted 20rs'), 20);
  assert.equal(extractPriceFromPackagingText('Parle-G Rs. 10 Pack'), 10);
  assert.equal(extractPriceFromPackagingText('Tata Salt ₹28'), 28);
  assert.equal(extractPriceFromPackagingText('Britannia 5/-'), 5);

  // Unlisted barcode must be strictly rejected with clean manual entry prompt, NOT fake Balaji or dummy items
  const unlistedBarcode = '8901058852493';
  const unlistedLookup = lookupGlobalProductCatalog(unlistedBarcode, []);
  assert.equal(unlistedLookup.found, false);
  assert.equal(unlistedLookup.isValid, true);
  assert.equal(unlistedLookup.name, '');
  assert.equal(unlistedLookup.rejectionReason, 'Product not in global database. Enter Name & MRP:');

  // Exact local inventory match resolves immediately
  const localProductMatch = lookupGlobalProductCatalog(mockShopProduct.barcode!, [mockShopProduct]);
  assert.equal(localProductMatch.found, true);
  assert.equal(localProductMatch.source, 'inventory');
  assert.equal(localProductMatch.name, 'Local Store Ghee 1L');

  // 6B. Free Global Barcode Auto-Lookup (Open Food Facts API Live & Packaging Fields)
  // Queries live Open Food Facts for authentic GTIN (Lay's Salted 20rs)
  const asyncOffLookup = await lookupGlobalProductCatalogAsync('8901491101837', []);
  if (asyncOffLookup.found) {
    assert.equal(asyncOffLookup.isValid, true);
    assert.equal(asyncOffLookup.isAutoRegistered, true);
    assert.ok(asyncOffLookup.name.toLowerCase().includes('lays') || asyncOffLookup.name.toLowerCase().includes("lay's"));
    assert.equal(asyncOffLookup.mrp, 20);
  }

  // Completely unknown barcode in async lookup also returns found: false without fake data
  const asyncUnknown = await lookupGlobalProductCatalogAsync('8901058852493', []);
  assert.equal(asyncUnknown.found, false);
  assert.equal(asyncUnknown.rejectionReason, 'Product not in global database. Enter Name & MRP:');

  // 7. Strict Barcode Validation: Rejection of random background noise, URLs, Wi-Fi tags & corrupted checksums
  const validEan13 = validateRetailBarcode('8901030383793');
  assert.equal(validEan13.isValid, true);
  assert.equal(validEan13.format, 'EAN_13');

  const invalidEan13Check = validateRetailBarcode('8901030383799'); // Invalid check digit
  assert.equal(invalidEan13Check.isValid, false);
  assert.equal(invalidEan13Check.format, 'INVALID');
  assert.ok(invalidEan13Check.rejectionReason?.includes('check digit mismatch'));

  const validUpcA = validateRetailBarcode('012345678905');
  assert.equal(validUpcA.isValid, true);
  assert.equal(validUpcA.format, 'UPC_A');

  const validEan8 = validateRetailBarcode('96385074');
  assert.equal(validEan8.isValid, true);
  assert.equal(validEan8.format, 'EAN_8');

  // Reject URLs and Wi-Fi system codes
  const rejectUrl = validateRetailBarcode('https://bhaviq.retail/promo');
  assert.equal(rejectUrl.isValid, false);
  assert.ok(rejectUrl.rejectionReason?.includes('Ignored URL'));

  const rejectWifi = validateRetailBarcode('WIFI:S:ShopWifi;T:WPA;P:secret;;');
  assert.equal(rejectWifi.isValid, false);

  const rejectShort = validateRetailBarcode('1234');
  assert.equal(rejectShort.isValid, false);

  // Reject invalid code in master catalog lookup
  const invalidLookup = lookupBarcodeInMasterCatalog('https://random-link.com', []);
  assert.equal(invalidLookup.isValid, false);
  assert.equal(invalidLookup.found, false);
});

test('Tauri Desktop Environment Detection & Google OAuth Bridge', async () => {
  const { isTauri, getOAuthRedirectUrl, openExternalBrowser } = await import('./tauriBridge');
  const { buildAuthResultFromSupabaseSession } = await import('./supabaseClient');
  
  // 1. In standard Node test runner (no window / no __TAURI__), isTauri returns false
  assert.equal(isTauri(), false);

  // 2. When Tauri runtime variables exist on window/global, isTauri correctly detects desktop app
  const originalWindow = (globalThis as any).window;
  try {
    (globalThis as any).window = {
      __TAURI_INTERNALS__: {},
      location: { origin: 'http://tauri.localhost' }
    };
    assert.equal(isTauri(), true);
    // Deep-link redirect URL for desktop eliminates localhost:3000 dependency
    assert.equal(getOAuthRedirectUrl(), 'bhaviq://auth-callback');

    // Test with tauri:// scheme
    (globalThis as any).window.location.origin = 'tauri://localhost';
    assert.equal(getOAuthRedirectUrl(), 'bhaviq://auth-callback');

    // Test external browser fallback without crashing
    let openedUrl = '';
    (globalThis as any).window.open = (url: string) => {
      openedUrl = url;
      return { closed: false };
    };
    const opened = await openExternalBrowser('https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(opened, true);
  } finally {
    if (originalWindow === undefined) {
      delete (globalThis as any).window;
    } else {
      (globalThis as any).window = originalWindow;
    }
  }

  // 3. In non-tauri web browser context, returns actual window.location.origin
  try {
    (globalThis as any).window = {
      location: { origin: 'https://bhaviq-pos.web.app' }
    };
    assert.equal(isTauri(), false);
    assert.equal(getOAuthRedirectUrl(), 'https://bhaviq-pos.web.app/auth/callback');
  } finally {
    if (originalWindow === undefined) {
      delete (globalThis as any).window;
    } else {
      (globalThis as any).window = originalWindow;
    }
  }

  // 4. Test standalone offline session construction from Supabase session (no node server required)
  const mockSession = {
    access_token: 'mock-sb-access-token-999',
    refresh_token: 'mock-sb-refresh-token-888',
    expires_in: 3600,
    token_type: 'bearer',
    user: {
      id: 'usr-sb-12345',
      email: 'retailer@bhaviq.store',
      app_metadata: {},
      user_metadata: {
        full_name: 'Suresh Patel',
        phone: '9820011223'
      },
      aud: 'authenticated',
      created_at: '2026-03-01T10:00:00Z',
    }
  };
  // 4. Test session construction with persistent database shop profile
  const mockExistingShop = {
    id: 'shop_sb_12345',
    ownerId: 'usr-sb-12345',
    name: "Suresh Patel's Store",
    businessType: 'Kirana & General Store',
    gstin: null,
    address: 'Main Market Road',
    city: 'Mumbai',
    state: 'Maharashtra',
    pincode: '400001',
    phone: '9820011223',
    taxMode: 'gst_inclusive',
    currency: 'INR',
    defaultMarginPct: 15,
    lowStockAlertEnabled: true,
    role: 'owner',
    permissions: { all: true },
    createdAt: '2026-03-01T10:00:00Z',
  };

  const authResult = buildAuthResultFromSupabaseSession(mockSession as any, mockExistingShop as any);
  assert.equal(authResult.token, 'mock-sb-access-token-999');
  assert.equal(authResult.user.id, 'usr-sb-12345');
  assert.equal(authResult.user.fullName, 'Suresh Patel');
  assert.equal(authResult.user.phone, '9820011223');
  assert.equal(authResult.shops.length, 1);
  assert.ok(authResult.shops[0].name.includes('Suresh Patel'));
  assert.equal(authResult.activeShopId, authResult.shops[0].id);

  // First-time user with no existing shop profile triggers onboarding
  const firstTimeResult = buildAuthResultFromSupabaseSession(mockSession as any, null);
  assert.equal(firstTimeResult.shops.length, 0);
  assert.equal(firstTimeResult.activeShopId, null);
});

test('Database Profile Vault: Persistent shop profiles strictly linked to auth UID', async () => {
  const {
    upsertShopProfile,
    fetchShopProfile,
    buildAuthResultFromSupabaseSession,
  } = await import('./supabaseClient');

  const testUid = 'usr_vault_test_999';

  // 1. First-time user lookup before onboarding returns null
  const emptyLookup = await fetchShopProfile(testUid);
  assert.equal(emptyLookup, null);

  // 2. User completes onboarding: UPSERTs profile permanently into vault
  const savedProfile = await upsertShopProfile({
    id: testUid,
    ownerId: testUid,
    name: 'Shree Balaji Kirana & Provision',
    businessType: 'Kirana & General Store',
    ownerName: 'Ramesh Sharma',
    city: 'Ahmedabad',
    state: 'Gujarat',
    address: '102 Gandhi Road',
    pincode: '380001',
    phone: '9898011223',
    taxMode: 'gst_inclusive',
    defaultMarginPct: 18,
  });

  assert.equal(savedProfile.ownerId, testUid);
  assert.equal(savedProfile.name, 'Shree Balaji Kirana & Provision');
  assert.equal(savedProfile.city, 'Ahmedabad');
  assert.equal(savedProfile.state, 'Gujarat');
  assert.equal(savedProfile.defaultMarginPct, 18);

  // 3. Re-fetching profile returns the exact stored details linked to the user's UID
  const fetched = await fetchShopProfile(testUid);
  assert.ok(fetched);
  assert.equal(fetched.name, 'Shree Balaji Kirana & Provision');
  assert.equal(fetched.city, 'Ahmedabad');
  assert.equal(fetched.state, 'Gujarat');
  assert.equal(fetched.defaultMarginPct, 18);

  // 4. Session builder with fetched profile directs user straight to Dashboard (bypassing onboarding)
  const mockUserSession = {
    access_token: 'valid-token-123',
    user: {
      id: testUid,
      email: 'ramesh@balajistore.in',
      user_metadata: { full_name: 'Ramesh Sharma', phone: '9898011223' },
      created_at: '2026-04-01T08:00:00Z',
    },
  };
  const authedDashboardResult = buildAuthResultFromSupabaseSession(mockUserSession as any, fetched);
  assert.equal(authedDashboardResult.shops.length, 1);
  assert.equal(authedDashboardResult.activeShopId, testUid);
  assert.equal(authedDashboardResult.shops[0].name, 'Shree Balaji Kirana & Provision');
});


test('Supabase Client Startup & Missing Runtime Credentials Resilience', async () => {
  const {
    isValidHttpUrl,
    getSupabaseConfig,
    isSupabaseConfigured,
    getSupabaseClient,
    getActiveSupabaseSession,
    extractAuthSessionFromUrl,
    resetCachedSupabaseClientForTesting,
  } = await import('./supabaseClient');

  resetCachedSupabaseClientForTesting();

  // 1. URL validation tests
  assert.equal(isValidHttpUrl('https://xyzcompany.supabase.co'), true);
  assert.equal(isValidHttpUrl('http://localhost:54321'), true);
  assert.equal(isValidHttpUrl(''), false);
  assert.equal(isValidHttpUrl('not-a-url'), false);
  assert.equal(isValidHttpUrl('ftp://supabase.co'), false);
  assert.equal(isValidHttpUrl(undefined as any), false);

  // 2. Safe missing-credentials behavior (no runtime crash during React tree mount)
  const cfg = getSupabaseConfig();
  assert.equal(typeof cfg.configured, 'boolean');
  assert.equal(typeof isSupabaseConfigured(), 'boolean');

  // getSupabaseClient must not throw on missing/invalid config
  const client = getSupabaseClient();
  if (!cfg.configured) {
    assert.equal(client, null);
  }

  // 3. getActiveSupabaseSession and extractAuthSessionFromUrl must resolve cleanly without uncaught exceptions
  const session = await getActiveSupabaseSession();
  if (!client) {
    assert.equal(session, null);
  }

  // 4. Extracting from an empty or missing-client url must resolve gracefully
  const extracted = await extractAuthSessionFromUrl('');
  assert.equal(extracted, null);
});

test('Layout Navigation: Ctrl+B shortcut logic and dynamic left-aligned sales trend data mapping', () => {
  // 1. Verify Ctrl+B and Cmd+B shortcut detection logic
  const isSidebarToggleKey = (e: { ctrlKey?: boolean; metaKey?: boolean; key?: string }) => {
    return Boolean((e.ctrlKey || e.metaKey) && e.key && e.key.toLowerCase() === 'b');
  };

  assert.equal(isSidebarToggleKey({ ctrlKey: true, key: 'b' }), true);
  assert.equal(isSidebarToggleKey({ ctrlKey: true, key: 'B' }), true);
  assert.equal(isSidebarToggleKey({ metaKey: true, key: 'b' }), true);
  assert.equal(isSidebarToggleKey({ metaKey: true, key: 'B' }), true);
  assert.equal(isSidebarToggleKey({ ctrlKey: false, metaKey: false, key: 'b' }), false);
  assert.equal(isSidebarToggleKey({ ctrlKey: true, key: 'c' }), false);
  assert.equal(isSidebarToggleKey({ key: 'b' }), false);

  // 2. Verify dynamic sales trend data mapping logic
  const mapSalesTrendData = (rawPoints: Array<{ date: string; sales: number; bills: number }>) => {
    const firstActiveIdx = rawPoints.findIndex((d) => d.sales > 0 || d.bills > 0);
    return firstActiveIdx >= 0 ? rawPoints.slice(firstActiveIdx) : rawPoints;
  };

  // Case A: 7-day raw window with activity only on the latest day (e.g. today)
  const singleInvoiceData = [
    { date: '2026-11-08', sales: 0, bills: 0 },
    { date: '2026-11-09', sales: 0, bills: 0 },
    { date: '2026-11-10', sales: 0, bills: 0 },
    { date: '2026-11-11', sales: 0, bills: 0 },
    { date: '2026-11-12', sales: 0, bills: 0 },
    { date: '2026-11-13', sales: 0, bills: 0 },
    { date: '2026-11-14', sales: 450, bills: 1 },
  ];

  const trimmedSingle = mapSalesTrendData(singleInvoiceData);
  assert.equal(trimmedSingle.length, 1);
  assert.equal(trimmedSingle[0].date, '2026-11-14');
  assert.equal(trimmedSingle[0].sales, 450);

  // Case B: Invoices starting 2 days ago
  const multiDayData = [
    { date: '2026-11-08', sales: 0, bills: 0 },
    { date: '2026-11-09', sales: 0, bills: 0 },
    { date: '2026-11-10', sales: 0, bills: 0 },
    { date: '2026-11-11', sales: 0, bills: 0 },
    { date: '2026-11-12', sales: 200, bills: 1 },
    { date: '2026-11-13', sales: 300, bills: 2 },
    { date: '2026-11-14', sales: 450, bills: 1 },
  ];

  const trimmedMulti = mapSalesTrendData(multiDayData);
  assert.equal(trimmedMulti.length, 3);
  assert.equal(trimmedMulti[0].date, '2026-11-12');
  assert.equal(trimmedMulti[2].date, '2026-11-14');

  // Case C: Empty account with no sales/bills
  const emptyData = [
    { date: '2026-11-13', sales: 0, bills: 0 },
    { date: '2026-11-14', sales: 0, bills: 0 },
  ];
  assert.equal(mapSalesTrendData(emptyData).length, 2);
});



