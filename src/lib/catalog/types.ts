export type MasterCategory =
  | 'Packaged FMCG'
  | 'Staple Grains'
  | 'Pulses'
  | 'Edible Oils'
  | 'Spices'
  | 'Beverages'
  | 'Personal Care'
  | 'Household Cleaning'
  | 'Loose Items';

export type MasterCategoryFilter = 'All SKUs' | MasterCategory;

export type SupplierTierLabel =
  | 'Direct Manufacturer Feed'
  | 'National FMCG Index'
  | 'National Distributor Benchmark'
  | 'Agri-Commodity Bulk Index';

export interface MasterProductSKU {
  id: string;
  skuCode: string;
  name: string;
  brand: string;
  category: MasterCategory;
  packVariant: string;
  supplierTier: SupplierTierLabel;
  /** True for open-stock loose commodities (zero MRP, quoted strictly per Kg / Quintal) */
  isLoose: boolean;
  wholesaleRate: number;
  /** Normalized per-Kg wholesale rate (set on loose & weight-tracked items) */
  ratePerKg?: number;
  /** Normalized per-Quintal (100 kg) wholesale rate for open-stock commodities */
  ratePerQuintal?: number;
  /** Exact consumer MRP printed on physical packaging; strictly null for Loose Items */
  suggestedMrp: number | null;
  /** Retailer profit margin % on MRP; strictly null for Loose Items */
  profitMarginPct: number | null;
  previousWholesaleRate: number;
  changePct: number;
  trend: 'up' | 'down' | 'flat';
  sparkline: number[];
  /** Optional agricultural commodity linkage key for live data.gov.in per-kg overlay */
  agriCommodityKey?: string;
  /** Weight multiplier in kg/L when applying agri commodity per-kg delta */
  packWeightKg?: number;
  updatedAt: string;
}

export const MASTER_CATEGORY_FILTERS: MasterCategoryFilter[] = [
  'All SKUs',
  'Packaged FMCG',
  'Staple Grains',
  'Pulses',
  'Edible Oils',
  'Spices',
  'Beverages',
  'Personal Care',
  'Household Cleaning',
  'Loose Items',
];

export interface CatalogPackSpec {
  label: string;
  /** Relative MRP/price scale vs the product's standard reference consumer pack */
  scale: number;
  /** Tier rank: 0 = flagship shelf pack, 1 = pocket/single retail, 2 = family/value, 3 = wholesale outer/box/sack */
  tierRank: 0 | 1 | 2 | 3;
  /** For wholesale multipacks/boxes: unit multiplier on printed consumer pack MRP (e.g. 12 or 24 units) */
  boxUnits?: number;
  /** Extra trade margin points (e.g. +0.8%) offered on wholesale cartons/sacks */
  tradeMarginBonusPct?: number;
  /** Weight in kg/L for live data.gov.in agri commodity rate syncing & loose bulk sacks */
  weightKg?: number;
  /** Bulk trade discount factor applied to loose/commodity sacks */
  bulkDiscount?: number;
}

export interface CompactProductItem {
  /** Product variant title (unique with brand & pack) */
  title: string;
  /** For packaged goods: authentic reference pack MRP (₹); for loose/agri commodities: reference ₹/kg wholesale rate */
  refValue: number;
  /** Official retailer profit margin % on MRP (e.g. 15.5%) */
  targetMarginPct: number;
  /** Optional linkage key for live data.gov.in agricultural commodity override */
  agriCommodityKey?: string;
}

export interface ProductFamilySpec {
  prefix: string;
  category: MasterCategory;
  brand: string;
  supplierTier: SupplierTierLabel;
  /** 'packet_mrp' derives wholesale rate from authentic Indian printed packet MRP; 'loose_kg' derives from ₹/kg wholesale benchmark with no MRP */
  pricingMode: 'packet_mrp' | 'loose_kg';
  items: CompactProductItem[];
  packs: CatalogPackSpec[];
}
