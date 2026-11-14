export type UserRole = 'owner' | 'staff';

export type RetailCategory =
  | 'Grocery'
  | 'Food Products'
  | 'Beverages'
  | 'Personal Care'
  | 'Household'
  | 'Packaged FMCG'
  | 'Loose Products'
  | 'Vegetables'
  | 'Fruits'
  | 'Grains'
  | 'Pulses'
  | 'Other';

export type BaseUnit =
  | 'Piece'
  | 'Packet'
  | 'Box'
  | 'Carton'
  | 'Gram'
  | 'Kilogram'
  | 'Millilitre'
  | 'Litre';

export type PaymentMode = 'cash' | 'upi' | 'credit' | 'split';

export type MarketCoverageStatus =
  | 'available'
  | 'partial'
  | 'historical_only'
  | 'supplier_quote_only'
  | 'manual_only'
  | 'unsupported';

export type HonestRateStatus =
  | 'Verified current rate'
  | 'Supplier quotation available'
  | 'Historical rate only'
  | 'Manual observation'
  | 'Market data unavailable'
  | 'Product matching required';

export type FreshnessStatus =
  | 'live_feed'
  | 'updated_today'
  | 'latest_available'
  | 'yesterday'
  | 'historical'
  | 'supplier_quotation'
  | 'manual_entry'
  | 'unavailable';

export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  preferredLanguage: 'en' | 'hi' | 'mr';
  theme: 'light' | 'dark';
  createdAt: string;
}

export interface Shop {
  id: string;
  ownerId: string;
  name: string;
  businessType: string;
  gstin: string | null;
  address: string | null;
  city: string;
  state: string;
  pincode: string | null;
  phone: string | null;
  taxMode: 'gst_inclusive' | 'gst_exclusive' | 'non_gst';
  currency: string;
  defaultMarginPct: number;
  lowStockAlertEnabled: boolean;
  role: UserRole;
  permissions: Record<string, boolean>;
  createdAt: string;
}

export interface ProductUnit {
  id: string;
  productId: string;
  unitName: string;
  conversionToBase: number;
  isDefaultSellUnit: boolean;
  isDefaultBuyUnit: boolean;
}

export interface Product {
  id: string;
  shopId: string;
  name: string;
  brand: string | null;
  packSize: string | null;
  variety: string | null;
  category: RetailCategory;
  barcode: string | null;
  sku: string | null;
  baseUnit: BaseUnit;
  purchasePrice: number | null;
  landedCost: number | null;
  sellingPrice: number;
  mrp: number | null;
  taxRatePct: number;
  mrpRestricted: boolean;
  currentStock: number;
  minStockLevel: number;
  primarySupplierId: string | null;
  primarySupplierName?: string | null;
  expiryDate: string | null;
  batchNumber: string | null;
  imageUrl: string | null;
  marketCommodityName: string | null;
  marketCoverageStatus: MarketCoverageStatus;
  units: ProductUnit[];
  createdAt: string;
  updatedAt: string;
}

export interface StockMovement {
  id: string;
  shopId: string;
  productId: string;
  productName?: string;
  movementType: 'purchase' | 'sale' | 'return' | 'damaged' | 'expiry' | 'adjustment';
  quantityDelta: number;
  unitName: string;
  unitQuantity: number;
  referenceType: string | null;
  referenceId: string | null;
  note: string | null;
  createdBy: string;
  createdAt: string;
}

export interface Customer {
  id: string;
  shopId: string;
  name: string;
  phone: string | null;
  address: string | null;
  openingBalance: number;
  currentBalance: number;
  creditLimit: number | null;
  notes: string | null;
  createdAt: string;
}

export interface CreditEntry {
  id: string;
  shopId: string;
  customerId: string;
  customerName?: string;
  entryType: 'opening' | 'credit_sale' | 'repayment';
  amount: number;
  balanceAfter: number;
  paymentMode: string | null;
  invoiceId: string | null;
  note: string | null;
  createdBy: string;
  createdAt: string;
}

export interface InvoiceItem {
  id: string;
  invoiceId: string;
  productId: string;
  productNameSnapshot: string;
  brandSnapshot: string | null;
  quantity: number;
  unitName: string;
  baseQuantityDeducted: number;
  unitSellingPrice: number;
  costPriceSnapshot: number | null;
  discountAmount: number;
  taxRatePct: number;
  taxAmount: number;
  lineTotal: number;
}

export interface Invoice {
  id: string;
  shopId: string;
  clientTxId: string;
  invoiceNumber: string;
  customerId: string | null;
  customerNameSnapshot: string | null;
  subtotal: number;
  discountAmount: number;
  discountAuthorizedBy: string | null;
  taxAmount: number;
  totalAmount: number;
  paidAmount: number;
  creditAmount: number;
  paymentMode: PaymentMode;
  status: string;
  createdBy: string;
  createdAt: string;
  items: InvoiceItem[];
}

export interface Supplier {
  id: string;
  shopId: string;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  location: string | null;
  categories: string[];
  gstin: string | null;
  notes: string | null;
  createdAt: string;
}

export interface PurchaseItem {
  id: string;
  purchaseId: string;
  productId: string;
  productName?: string;
  brand: string | null;
  packSize: string | null;
  quantity: number;
  unitName: string;
  baseQuantityAdded: number;
  purchaseRate: number;
  discountAmount: number;
  taxAmount: number;
  allocatedExtraCost: number;
  landedCostPerBaseUnit: number;
  lineTotal: number;
}

export interface Purchase {
  id: string;
  shopId: string;
  clientTxId: string;
  supplierId: string;
  supplierName?: string;
  supplierInvoiceNo: string | null;
  purchaseDate: string;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  freightCost: number;
  transportCost: number;
  additionalCosts: number;
  totalAmount: number;
  paidAmount: number;
  paymentStatus: 'paid' | 'partial' | 'unpaid';
  notes: string | null;
  createdBy: string;
  createdAt: string;
  items: PurchaseItem[];
}

export interface Expense {
  id: string;
  shopId: string;
  category: string;
  description: string;
  amount: number;
  paymentMode: string;
  expenseDate: string;
  receiptRef: string | null;
  createdBy: string;
  createdAt: string;
}

export interface PriceSource {
  id: string;
  shopId: string;
  sourceKey: string;
  name: string;
  sourceType: 'official_api' | 'supplier_feed' | 'manual_observation';
  endpointUrl: string | null;
  isConfigured: boolean;
  updateFrequency: string;
  lastSyncAt: string | null;
  lastAttemptedAt: string | null;
  lastDataDate: string | null;
  lastRecordsFetched: number;
  lastRecordsMatched: number;
  lastSyncStatus: 'idle' | 'success' | 'failed' | 'not_configured';
  lastError: string | null;
  coverageNotes: string;
}

export interface MarketSyncRun {
  id: string;
  shopId: string;
  sourceKey: string;
  sourceName: string;
  triggerType: 'manual' | 'scheduled';
  status: 'success' | 'failed' | 'not_configured';
  attemptedAt: string;
  completedAt: string | null;
  dataDate: string | null;
  recordsFetched: number;
  recordsInserted: number;
  recordsMatched: number;
  httpStatus: number | null;
  errorCode: string | null;
  errorDetails: string | null;
}

export interface MarketPrice {
  id: string;
  shopId: string;
  sourceId: string;
  sourceName?: string;
  productId: string | null;
  commodityOrProductName: string;
  brand: string | null;
  packSize: string | null;
  unit: string;
  marketName: string;
  state: string | null;
  district: string | null;
  location: string;
  minPrice: number | null;
  maxPrice: number | null;
  modalPrice: number;
  previousPrice: number | null;
  priceUnitBasis: string;
  normalizedPerBaseUnit: number | null;
  observationDate: string;
  freshnessStatus: FreshnessStatus;
  verificationStatus: 'verified_official' | 'verified_supplier' | 'owner_observed' | 'unverified';
  confidenceLevel: 'high' | 'medium' | 'low';
  createdAt: string;
}

export interface SupplierQuotation {
  id: string;
  shopId: string;
  productId: string;
  productName?: string;
  supplierId: string;
  supplierName?: string;
  brand: string | null;
  packSize: string | null;
  quantity: number;
  unit: string;
  quotedRate: number;
  discountAmount: number;
  taxAmount: number;
  freightEstimatePerUnit: number;
  additionalCosts: number;
  finalLandedCost: number;
  landedEstimate: number;
  validUntil: string | null;
  isExpired?: boolean;
  quotationDate: string;
  sourceEvidence: string | null;
  verificationStatus: 'verified_quotation' | 'verbal_quote' | 'price_list';
  notes: string | null;
  createdBy: string;
  createdAt: string;
}

export interface HistoricalPurchaseRatePoint {
  purchaseId: string;
  purchaseDate: string;
  supplierId: string;
  supplierName: string;
  brand: string | null;
  packSize: string | null;
  quantity: number;
  unitName: string;
  purchaseRate: number;
  landedCostPerBaseUnit: number;
  invoiceNo: string | null;
  createdAt: string;
}

export interface ProductWholesaleSummary {
  productId: string;
  productName: string;
  brand: string | null;
  category: RetailCategory;
  packSize: string | null;
  variety: string | null;
  baseUnit: BaseUnit;
  marketCommodityName: string | null;
  historicalPurchaseRate: number | null;
  historicalPurchaseDate: string | null;
  latestSupplierWholesaleRate: number | null;
  latestSupplierAdvertisedRate: number | null;
  latestSupplierId: string | null;
  latestSupplierName: string | null;
  latestMarketRate: number | null;
  latestMarketLabel: string | null;
  latestMarketDate: string | null;
  latestWholesaleRate: number | null;
  previousWholesaleRate: number | null;
  priceDifference: number | null;
  priceChangePct: number | null;
  currentLandedCost: number | null;
  currentSellingPrice: number;
  mrp: number | null;
  mrpRestricted: boolean;
  sourceLabel: string;
  lastUpdated: string | null;
  verificationStatus: string;
  coverageStatus: HonestRateStatus;
  validQuotationsCount: number;
  expiredQuotationsCount: number;
  lowestValidQuoteId: string | null;
  hasMissingRate: boolean;
}

export type RateExplorerFilter =
  | 'All products'
  | 'Packaged FMCG'
  | 'Grocery'
  | 'Vegetables'
  | 'Fruits'
  | 'Grains'
  | 'Pulses'
  | 'Household'
  | 'Personal Care'
  | 'Beverages'
  | 'Available rates'
  | 'Missing rates'
  | 'Increasing prices'
  | 'Decreasing prices';

export interface PriceAlert {
  id: string;
  alertKind?: 'inventory_replacement' | 'market_volatility';
  productId: string | null;
  skuCode?: string | null;
  category?: string;
  packVariant?: string | null;
  isLoose?: boolean;
  productName: string;
  brand: string | null;
  severity: 'critical' | 'warning' | 'opportunity';
  movementDirection?: 'up' | 'down';
  changePct?: number | null;
  previousWholesaleRate?: number | null;
  currentWholesaleRate?: number | null;
  ratePerKg?: number | null;
  previousRatePerKg?: number | null;
  ratePerQuintal?: number | null;
  previousRatePerQuintal?: number | null;
  officialMrp?: number | null;
  marginBeforePct?: number | null;
  marginAfterPct?: number | null;
  replacementImpactSummary?: string;
  acknowledged?: boolean;
  acknowledgedAt?: string | null;
  title: string;
  reason: string;
  source: string;
  timestamp: string;
  historicalLandedCost: number | null;
  replacementLandedCost: number | null;
  currentSellingPrice: number;
  recommendedPrice: number | null;
  calculationDetail: string;
}

export interface AuditLog {
  id: string;
  shopId: string;
  userId: string;
  userName?: string;
  action: string;
  entityType: string;
  entityId: string;
  detailsJson: string;
  createdAt: string;
}

export interface DashboardSummary {
  todaySales: number;
  todayBillsCount: number;
  todayGrossProfit: number | null;
  grossProfitDataComplete: boolean;
  creditOutstanding: number;
  stockValue: number | null;
  stockValuationCompleteCount: number;
  totalProductsCount: number;
  lowStockProducts: Product[];
  todayExpenses: number;
  monthExpenses: number;
  paymentCollection: {
    cash: number;
    upi: number;
    credit: number;
  };
  recentInvoices: Invoice[];
  recentPurchases: Purchase[];
  dailyTrend: Array<{
    date: string;
    sales: number;
    bills: number;
    grossProfit: number | null;
  }>;
  priceAlerts: PriceAlert[];
}
