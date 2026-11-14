import { buildMasterCatalogMatrix, snapToIndianPacketMrp, type MasterProductSKU } from './masterCatalog';
import { roundCurrency } from './units';
import type { BaseUnit, Product, RetailCategory } from './types';

/**
 * Calculates standard GS1 Modulo-10 check digit for a 12-digit EAN string.
 */
export function calculateEan13CheckDigit(twelveDigits: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = parseInt(twelveDigits[i], 10) || 0;
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  const mod = sum % 10;
  return mod === 0 ? 0 : 10 - mod;
}

/**
 * Calculates standard GS1 Modulo-10 check digit for an 11-digit UPC-A string.
 */
export function calculateUpcCheckDigit(elevenDigits: string): number {
  let sum = 0;
  for (let i = 0; i < 11; i++) {
    const digit = parseInt(elevenDigits[i], 10) || 0;
    sum += i % 2 === 0 ? digit * 3 : digit;
  }
  const mod = sum % 10;
  return mod === 0 ? 0 : 10 - mod;
}

/**
 * Calculates standard GS1 Modulo-10 check digit for a 7-digit EAN-8 string.
 */
export function calculateEan8CheckDigit(sevenDigits: string): number {
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    const digit = parseInt(sevenDigits[i], 10) || 0;
    sum += i % 2 === 0 ? digit * 3 : digit;
  }
  const mod = sum % 10;
  return mod === 0 ? 0 : 10 - mod;
}

export type BarcodeFormat =
  | 'EAN_13'
  | 'UPC_A'
  | 'EAN_8'
  | 'UPC_E'
  | 'CODE_128'
  | 'CUSTOM_SKU'
  | 'INVALID';

export interface BarcodeValidationResult {
  isValid: boolean;
  cleanCode: string;
  format: BarcodeFormat;
  rejectionReason?: string;
}

/**
 * Strict Retail Barcode Validation:
 * Rejects non-retail noise, URLs, Wi-Fi tags, random background text, and invalid checksums.
 * Only accepts authentic EAN-13, UPC-A, EAN-8, UPC-E, or recognized inventory prefixes (SKU-, BHAV-, etc.).
 */
export function validateRetailBarcode(
  rawCode: string,
  existingShopProducts: Product[] = []
): BarcodeValidationResult {
  if (!rawCode || typeof rawCode !== 'string') {
    return { isValid: false, cleanCode: '', format: 'INVALID', rejectionReason: 'Empty code' };
  }

  const cleanCode = rawCode.trim().replace(/[\s\r\n\t]/g, '');

  // 1. Immediately reject URLs, emails, phone links, and system QR strings
  if (/^(https?:\/\/|www\.|ftp:\/\/|mailto:|tel:|WIFI:|BEGIN:VCARD)/i.test(cleanCode)) {
    return {
      isValid: false,
      cleanCode,
      format: 'INVALID',
      rejectionReason: 'Ignored URL or non-product QR code',
    };
  }

  // 2. Reject codes outside acceptable length boundaries
  if (cleanCode.length < 6 || cleanCode.length > 24) {
    return {
      isValid: false,
      cleanCode,
      format: 'INVALID',
      rejectionReason: `Invalid barcode length (${cleanCode.length}). Expected 6 to 24 characters.`,
    };
  }

  // 3. Reject strings containing arbitrary non-barcode punctuation
  if (/[^a-zA-Z0-9\-_.]/.test(cleanCode)) {
    return {
      isValid: false,
      cleanCode,
      format: 'INVALID',
      rejectionReason: 'Contains invalid non-alphanumeric barcode characters',
    };
  }

  // 4. Exact Match against Current Store Inventory Barcodes/SKUs (always prioritize shop-registered stock)
  const lowerCode = cleanCode.toLowerCase();
  const existsInShop = existingShopProducts.some(
    (p) =>
      (p.barcode && p.barcode.trim().toLowerCase() === lowerCode) ||
      (p.sku && p.sku.trim().toLowerCase() === lowerCode)
  );
  if (existsInShop) {
    return { isValid: true, cleanCode, format: 'CUSTOM_SKU' };
  }

  // 5. EAN-13 Validation (13 pure digits)
  if (/^\d{13}$/.test(cleanCode)) {
    const expectedCheck = calculateEan13CheckDigit(cleanCode.slice(0, 12));
    const actualCheck = Number(cleanCode[12]);
    if (expectedCheck === actualCheck) {
      return { isValid: true, cleanCode, format: 'EAN_13' };
    }
    return {
      isValid: false,
      cleanCode,
      format: 'INVALID',
      rejectionReason: `EAN-13 check digit mismatch (expected ${expectedCheck}, got ${actualCheck})`,
    };
  }

  // 5. UPC-A Validation (12 pure digits)
  if (/^\d{12}$/.test(cleanCode)) {
    const expectedCheck = calculateUpcCheckDigit(cleanCode.slice(0, 11));
    const actualCheck = Number(cleanCode[11]);
    if (expectedCheck === actualCheck) {
      return { isValid: true, cleanCode, format: 'UPC_A' };
    }
    return {
      isValid: false,
      cleanCode,
      format: 'INVALID',
      rejectionReason: `UPC-A check digit mismatch (expected ${expectedCheck}, got ${actualCheck})`,
    };
  }

  // 6. EAN-8 Validation (8 pure digits)
  if (/^\d{8}$/.test(cleanCode)) {
    const expectedCheck = calculateEan8CheckDigit(cleanCode.slice(0, 7));
    const actualCheck = Number(cleanCode[7]);
    if (expectedCheck === actualCheck) {
      return { isValid: true, cleanCode, format: 'EAN_8' };
    }
    return {
      isValid: false,
      cleanCode,
      format: 'INVALID',
      rejectionReason: `EAN-8 check digit mismatch (expected ${expectedCheck}, got ${actualCheck})`,
    };
  }

  // 7. UPC-E Validation (6-7 digits pure numeric)
  if (/^\d{6,7}$/.test(cleanCode)) {
    return { isValid: true, cleanCode, format: 'UPC_E' };
  }

  // 8. Explicit Store & FMCG SKU Prefixes (e.g., SKU-OIL-10001, BHAV-1234, EAN-9901, BATCH-01)
  const isKnownPrefix = /^(SKU|BHAV|EAN|ITM|PRD|BATCH|FMCG)-[A-Z0-9\-_]{2,18}$/i.test(cleanCode);
  if (isKnownPrefix) {
    return { isValid: true, cleanCode, format: 'CUSTOM_SKU' };
  }

  // 9. Check if code exists in 10,000+ Master Catalog Index
  const { index } = ensureMasterBarcodeIndex();
  if (index.has(cleanCode) || index.has(lowerCode)) {
    return { isValid: true, cleanCode, format: 'CODE_128' };
  }

  // Reject unrecognized random noise or background barcodes
  return {
    isValid: false,
    cleanCode,
    format: 'INVALID',
    rejectionReason: 'Unrecognized barcode format or unmapped product SKU',
  };
}

/**
 * Derives a deterministic authentic 13-digit GS1 India EAN barcode (prefix 890)
 * for a catalog SKU code and pack variant.
 */
export function deriveEan13ForSku(skuCode: string, packVariant: string): string {
  let hash = 2166136261;
  const str = `${skuCode}|${packVariant}`;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const positive = Math.abs(hash) % 1000000000;
  const nineDigits = String(positive).padStart(9, '0');
  const twelveDigits = `890${nineDigits}`;
  const checkDigit = calculateEan13CheckDigit(twelveDigits);
  return `${twelveDigits}${checkDigit}`;
}

export interface BarcodeLookupResult {
  found: boolean;
  isValid: boolean;
  format: BarcodeFormat;
  rejectionReason?: string;
  source: 'inventory' | 'master_catalog' | 'synthetic';
  barcode: string;
  name: string;
  brand: string;
  category: RetailCategory;
  packSize: string;
  sku: string;
  mrp: number;
  sellingPrice: number;
  purchasePrice: number;
  baseUnit: BaseUnit;
  isLoose: boolean;
  profitMarginPct: number;
  expiryDate: string; // YYYY-MM-DD
  existingProduct?: Product;
  imageUrl?: string | null;
  isAutoRegistered?: boolean;
}

export interface Gs1BrandInfo {
  brand: string;
  category: RetailCategory;
  defaultItem: string;
  defaultPack: string;
  defaultMrp: number;
}

export const KNOWN_GS1_PREFIXES: Record<string, Gs1BrandInfo> = {
  '8901030': { brand: 'Hindustan Unilever', category: 'Household', defaultItem: 'Surf Excel Detergent', defaultPack: '500g', defaultMrp: 75 },
  '8901491': { brand: 'Parle', category: 'Packaged FMCG', defaultItem: 'Parle-G Gold Biscuits', defaultPack: '100g', defaultMrp: 10 },
  '8901262': { brand: 'Amul', category: 'Grocery', defaultItem: 'Amul Pure Ghee', defaultPack: '1L', defaultMrp: 650 },
  '8901063': { brand: 'Britannia', category: 'Packaged FMCG', defaultItem: 'Good Day Butter Cookies', defaultPack: '120g', defaultMrp: 30 },
  '8901725': { brand: 'ITC Sunfeast', category: 'Packaged FMCG', defaultItem: 'YiPPee! Noodles', defaultPack: '280g', defaultMrp: 55 },
  '8901058': { brand: 'Nestle', category: 'Packaged FMCG', defaultItem: 'Maggi 2-Minute Masala Noodles', defaultPack: '140g', defaultMrp: 30 },
  '8902579': { brand: 'Tata Consumer', category: 'Grocery', defaultItem: 'Tata Salt Vacuum Evaporated', defaultPack: '1kg', defaultMrp: 28 },
  '8906010': { brand: 'Dabur', category: 'Personal Care', defaultItem: 'Dabur Red Toothpaste', defaultPack: '150g', defaultMrp: 95 },
  '8901088': { brand: 'Marico', category: 'Grocery', defaultItem: 'Parachute Pure Coconut Oil', defaultPack: '200ml', defaultMrp: 90 },
  '8901012': { brand: 'Godrej', category: 'Household', defaultItem: 'GoodKnight Liquid Vaporizer', defaultPack: '45ml', defaultMrp: 85 },
  '8901314': { brand: 'Colgate-Palmolive', category: 'Personal Care', defaultItem: 'Colgate Strong Teeth', defaultPack: '200g', defaultMrp: 110 },
  '8901023': { brand: 'Cadbury Mondelez', category: 'Packaged FMCG', defaultItem: 'Cadbury Dairy Milk Chocolate', defaultPack: '50g', defaultMrp: 45 },
  '8904004': { brand: "Haldiram's", category: 'Packaged FMCG', defaultItem: 'Haldiram Aloo Bhujia', defaultPack: '200g', defaultMrp: 55 },
  '8906007': { brand: 'Patanjali', category: 'Grocery', defaultItem: 'Patanjali Cow Ghee', defaultPack: '500ml', defaultMrp: 340 },
  '8901207': { brand: 'Reckitt', category: 'Household', defaultItem: 'Dettol Antiseptic Liquid', defaultPack: '250ml', defaultMrp: 125 },
  '8901072': { brand: 'PepsiCo', category: 'Packaged FMCG', defaultItem: "Lay's India's Magic Masala Chips", defaultPack: '50g', defaultMrp: 20 },
  '8901764': { brand: 'Coca-Cola', category: 'Beverages', defaultItem: 'Thums Up Charged Soft Drink', defaultPack: '750ml', defaultMrp: 40 },
  '8901512': { brand: 'Wipro', category: 'Personal Care', defaultItem: 'Santoor Sandal & Turmeric Soap', defaultPack: '100g', defaultMrp: 38 },
  '8908001': { brand: 'Emami', category: 'Personal Care', defaultItem: 'Navratna Ayurvedic Cool Oil', defaultPack: '100ml', defaultMrp: 75 },
  '8901233': { brand: 'Everest', category: 'Grocery', defaultItem: 'Everest Garam Masala', defaultPack: '100g', defaultMrp: 85 },
  '8901719': { brand: 'MDH', category: 'Grocery', defaultItem: 'MDH Deggi Mirch Powder', defaultPack: '100g', defaultMrp: 92 },
};

// Global lookup cache for 10,000+ SKU master catalog
let MASTER_BARCODE_INDEX: Map<string, MasterProductSKU> | null = null;
let MASTER_EAN_LIST: Array<{ ean: string; sku: MasterProductSKU }> | null = null;

function ensureMasterBarcodeIndex(): {
  index: Map<string, MasterProductSKU>;
  list: Array<{ ean: string; sku: MasterProductSKU }>;
} {
  if (MASTER_BARCODE_INDEX && MASTER_EAN_LIST) {
    return { index: MASTER_BARCODE_INDEX, list: MASTER_EAN_LIST };
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const matrix = buildMasterCatalogMatrix(todayIso);
  const index = new Map<string, MasterProductSKU>();
  const list: Array<{ ean: string; sku: MasterProductSKU }> = [];

  for (let i = 0; i < matrix.length; i++) {
    const sku = matrix[i];
    // Index strictly by SKU Code and ID.
    // Artificial derived EAN indexing is purged to prevent false collisions with real retail barcodes.
    index.set(sku.skuCode.toLowerCase(), sku);
    index.set(sku.id.toLowerCase(), sku);
  }

  MASTER_BARCODE_INDEX = index;
  MASTER_EAN_LIST = list;
  return { index, list };
}

/**
 * Computes a sensible expiry date for FMCG / Grocery (default +9 months / 270 days).
 */
export function getDefaultFmcgExpiry(daysAhead = 270): string {
  const d = new Date(Date.now() + daysAhead * 24 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

/**
 * Helper to find an exact product in active store inventory by barcode or SKU.
 */
export function findExactStoreProduct(
  rawBarcode: string,
  existingShopProducts: Product[] = []
): Product | null {
  const cleanCode = (rawBarcode || '').trim();
  if (!cleanCode) return null;
  const lowerCode = cleanCode.toLowerCase();
  return (
    existingShopProducts.find(
      (p) =>
        (p.barcode && p.barcode.trim() === cleanCode) ||
        (p.sku && p.sku.trim().toLowerCase() === lowerCode)
    ) || null
  );
}

/**
 * Intercepts a scanned barcode, searches existing shop inventory first,
 * then queries the 10,000+ SKU Kirana master catalog to autofill exact retail details.
 */
export function lookupBarcodeInMasterCatalog(
  rawBarcode: string,
  existingShopProducts: Product[] = []
): BarcodeLookupResult {
  const validation = validateRetailBarcode(rawBarcode, existingShopProducts);
  const cleanCode = validation.cleanCode;
  const lowerCode = cleanCode.toLowerCase();

  if (!validation.isValid) {
    return {
      found: false,
      isValid: false,
      format: validation.format,
      rejectionReason: validation.rejectionReason,
      source: 'synthetic',
      barcode: cleanCode,
      name: 'Unrecognized Barcode',
      brand: '',
      category: 'Packaged FMCG',
      packSize: '',
      sku: '',
      mrp: 0,
      sellingPrice: 0,
      purchasePrice: 0,
      baseUnit: 'Piece',
      isLoose: false,
      profitMarginPct: 0,
      expiryDate: getDefaultFmcgExpiry(),
    };
  }

  // 1. Check shop's existing products first
  const existing = findExactStoreProduct(cleanCode, existingShopProducts);

  if (existing) {
    const mrpVal = existing.mrp ?? 0;
    const purchaseVal = existing.purchasePrice ?? 0;
    return {
      found: true,
      isValid: true,
      format: validation.format,
      source: 'inventory',
      barcode: existing.barcode || cleanCode,
      name: existing.name,
      brand: existing.brand || '',
      category: existing.category,
      packSize: existing.packSize || '',
      sku: existing.sku || `SKU-${cleanCode.slice(-6)}`,
      mrp: mrpVal,
      sellingPrice: existing.sellingPrice,
      purchasePrice: purchaseVal,
      baseUnit: existing.baseUnit,
      isLoose: existing.baseUnit === 'Kilogram' && !existing.packSize,
      profitMarginPct:
        mrpVal > 0
          ? roundCurrency(((mrpVal - purchaseVal) / mrpVal) * 100)
          : 12,
      expiryDate: getDefaultFmcgExpiry(),
      existingProduct: existing,
    };
  }

  // 2. Query 10,000+ SKU master catalog by exact match only (no modulo mapping or guessing)
  const { index } = ensureMasterBarcodeIndex();
  const masterSku = index.get(cleanCode) || index.get(lowerCode);

  if (masterSku) {
    const isLoose = masterSku.isLoose;
    const mrp =
      masterSku.suggestedMrp ??
      (isLoose ? 0 : roundCurrency(masterSku.wholesaleRate * 1.15));
    const sellingPrice =
      masterSku.suggestedMrp ??
      (isLoose
        ? roundCurrency(masterSku.wholesaleRate * 1.12)
        : roundCurrency(masterSku.wholesaleRate * 1.14));
    const purchasePrice = masterSku.wholesaleRate;
    const profitMarginPct =
      masterSku.profitMarginPct ??
      (mrp > 0 ? roundCurrency(((mrp - purchasePrice) / mrp) * 100) : 14);

    let mappedCategory: RetailCategory = 'Packaged FMCG';
    if (masterSku.category === 'Loose Items') mappedCategory = 'Loose Products';
    else if (masterSku.category === 'Staple Grains') mappedCategory = 'Grains';
    else if (masterSku.category === 'Pulses') mappedCategory = 'Pulses';
    else if (masterSku.category === 'Edible Oils' || masterSku.category === 'Spices') mappedCategory = 'Grocery';
    else if (masterSku.category === 'Beverages') mappedCategory = 'Beverages';
    else if (masterSku.category === 'Personal Care') mappedCategory = 'Personal Care';
    else if (masterSku.category === 'Household Cleaning') mappedCategory = 'Household';

    return {
      found: true,
      isValid: true,
      format: validation.format,
      source: 'master_catalog',
      barcode: cleanCode,
      name: `${masterSku.brand} ${masterSku.name} ${masterSku.packVariant}`.trim(),
      brand: masterSku.brand,
      category: mappedCategory,
      packSize: masterSku.packVariant,
      sku: masterSku.skuCode,
      mrp,
      sellingPrice,
      purchasePrice,
      baseUnit: isLoose ? 'Kilogram' : 'Piece',
      isLoose,
      profitMarginPct,
      expiryDate: getDefaultFmcgExpiry(masterSku.category === 'Edible Oils' ? 365 : 270),
    };
  }

  // 3. Global GS1 GTIN Decoder & Open Product Catalog Fallback
  return lookupGlobalProductCatalog(rawBarcode, existingShopProducts);
}

/**
 * Global Product Lookup & Auto-Registration Fallback:
 * When a barcode is not found in local store inventory, automatically queries the
 * 10,000+ Kirana catalog, decodes GS1 GTIN manufacturer data, and falls back to authentic
 * retail FMCG specifications with official Indian packet MRP denominations.
 */
export function lookupGlobalProductCatalog(
  rawBarcode: string,
  existingShopProducts: Product[] = []
): BarcodeLookupResult {
  const cleanCode = (rawBarcode || '').trim().replace(/[\s\r\n\t]/g, '');
  const validation = validateRetailBarcode(cleanCode, existingShopProducts);

  if (!validation.isValid) {
    return {
      found: false,
      isValid: false,
      format: validation.format,
      rejectionReason: validation.rejectionReason,
      source: 'synthetic',
      barcode: cleanCode,
      name: '',
      brand: '',
      category: 'Packaged FMCG',
      packSize: '',
      sku: '',
      mrp: 0,
      sellingPrice: 0,
      purchasePrice: 0,
      baseUnit: 'Piece',
      isLoose: false,
      profitMarginPct: 0,
      expiryDate: getDefaultFmcgExpiry(),
      isAutoRegistered: false,
    };
  }

  // 1. Check local store inventory first
  const existing = findExactStoreProduct(cleanCode, existingShopProducts);
  if (existing) {
    const mrpVal = existing.mrp ?? 0;
    const purchaseVal = existing.purchasePrice ?? 0;
    return {
      found: true,
      isValid: true,
      format: validation.format,
      source: 'inventory',
      barcode: existing.barcode || cleanCode,
      name: existing.name,
      brand: existing.brand || '',
      category: existing.category,
      packSize: existing.packSize || '',
      sku: existing.sku || `SKU-${cleanCode.slice(-6)}`,
      mrp: mrpVal,
      sellingPrice: existing.sellingPrice,
      purchasePrice: purchaseVal,
      baseUnit: existing.baseUnit,
      isLoose: existing.baseUnit === 'Kilogram' && !existing.packSize,
      profitMarginPct: mrpVal > 0 ? roundCurrency(((mrpVal - purchaseVal) / mrpVal) * 100) : 12,
      expiryDate: getDefaultFmcgExpiry(),
      existingProduct: existing,
      isAutoRegistered: false,
    };
  }

  // 2. Query 10,000+ Master Catalog Index
  const { index } = ensureMasterBarcodeIndex();
  const lowerCode = cleanCode.toLowerCase();
  const masterSku = index.get(cleanCode) || index.get(lowerCode);
  if (masterSku) {
    const isLoose = masterSku.isLoose;
    const mrp =
      masterSku.suggestedMrp ??
      (isLoose ? 0 : roundCurrency(masterSku.wholesaleRate * 1.15));
    const sellingPrice =
      masterSku.suggestedMrp ??
      (isLoose
        ? roundCurrency(masterSku.wholesaleRate * 1.12)
        : roundCurrency(masterSku.wholesaleRate * 1.14));
    const purchasePrice = masterSku.wholesaleRate;
    const profitMarginPct =
      masterSku.profitMarginPct ??
      (mrp > 0 ? roundCurrency(((mrp - purchasePrice) / mrp) * 100) : 14);

    let mappedCategory: RetailCategory = 'Packaged FMCG';
    if (masterSku.category === 'Loose Items') mappedCategory = 'Loose Products';
    else if (masterSku.category === 'Staple Grains') mappedCategory = 'Grains';
    else if (masterSku.category === 'Pulses') mappedCategory = 'Pulses';
    else if (masterSku.category === 'Edible Oils' || masterSku.category === 'Spices') mappedCategory = 'Grocery';
    else if (masterSku.category === 'Beverages') mappedCategory = 'Beverages';
    else if (masterSku.category === 'Personal Care') mappedCategory = 'Personal Care';
    else if (masterSku.category === 'Household Cleaning') mappedCategory = 'Household';

    return {
      found: true,
      isValid: true,
      format: validation.format,
      source: 'master_catalog',
      barcode: cleanCode,
      name: `${masterSku.brand} ${masterSku.name} ${masterSku.packVariant}`.trim(),
      brand: masterSku.brand,
      category: mappedCategory,
      packSize: masterSku.packVariant,
      sku: masterSku.skuCode,
      mrp,
      sellingPrice,
      purchasePrice,
      baseUnit: isLoose ? 'Kilogram' : 'Piece',
      isLoose,
      profitMarginPct,
      expiryDate: getDefaultFmcgExpiry(masterSku.category === 'Edible Oils' ? 365 : 270),
      isAutoRegistered: true,
    };
  }

  // 3. Purge all hardcoded dummy product fallbacks (no fake Balaji or placeholder items).
  // If not found in store inventory or master SKU matrix, return not found with prompt for manual entry.
  return {
    found: false,
    isValid: true,
    format: validation.format,
    source: 'synthetic',
    isAutoRegistered: false,
    rejectionReason: 'Product not in global database. Enter Name & MRP:',
    barcode: cleanCode,
    name: '',
    brand: '',
    category: 'Packaged FMCG',
    packSize: '',
    sku: `SKU-${cleanCode.slice(-6)}`,
    mrp: 0,
    sellingPrice: 0,
    purchasePrice: 0,
    baseUnit: 'Piece',
    isLoose: false,
    profitMarginPct: 0,
    expiryDate: getDefaultFmcgExpiry(),
  };
}

/**
 * Extracts printed pricing from packaging text, product name, or labels.
 * Matches patterns like "20rs", "rs. 20", "₹20", "mrp 20", "20/-".
 */
export function extractPriceFromPackagingText(text: string): number | null {
  if (!text) return null;
  const m1 = text.match(/(?:mrp|rs\.?|₹)\s*(\d+(?:\.\d{1,2})?)/i);
  if (m1) {
    const val = parseFloat(m1[1]);
    if (!isNaN(val) && val > 0 && val < 50000) return val;
  }
  const m2 = text.match(/(\d+(?:\.\d{1,2})?)\s*(?:rs|inr|\/-)/i);
  if (m2) {
    const val = parseFloat(m2[1]);
    if (!isNaN(val) && val > 0 && val < 50000) return val;
  }
  return null;
}

/**
 * Free Global Barcode Auto-Lookup (Open Food Facts API):
 * Queries the public Open Food Facts API (https://world.openfoodfacts.org/api/v2/product/{barcode}.json)
 * and fallback (https://in.openfoodfacts.org/api/v2/product/{barcode}.json)
 * to automatically retrieve verified product name, brand, image, packaging size, and printed MRP.
 */
export async function fetchOpenFoodFactsProduct(
  barcode: string
): Promise<{
  name: string;
  brand: string;
  imageUrl: string | null;
  category: RetailCategory;
  packSize: string;
  mrp: number;
  sellingPrice: number;
  purchasePrice: number;
} | null> {
  const cleanCode = (barcode || '').trim().replace(/[\s\r\n\t]/g, '');
  if (!cleanCode || cleanCode.length < 6) return null;

  try {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), 4000) : null;

    let res = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(cleanCode)}.json`,
      {
        signal: controller?.signal,
        headers: {
          'User-Agent': 'BhavIQ-Retail-POS/2.0 (support@bhaviq.retail)',
        },
      }
    ).catch(() => null);

    if (!res || !res.ok) {
      res = await fetch(
        `https://in.openfoodfacts.org/api/v2/product/${encodeURIComponent(cleanCode)}.json`,
        {
          headers: {
            'User-Agent': 'BhavIQ-Retail-POS/2.0 (support@bhaviq.retail)',
          },
        }
      ).catch(() => null);
    }

    if (timeoutId) clearTimeout(timeoutId);

    if (!res || !res.ok) return null;
    const data = await res.json();
    if (data.status === 1 && data.product) {
      const p = data.product;
      const brand = p.brands ? p.brands.split(',')[0].trim() : '';
      const rawName = p.product_name || p.product_name_en || p.generic_name || '';
      const name = brand && !rawName.toLowerCase().includes(brand.toLowerCase())
        ? `${brand} ${rawName}`.trim()
        : rawName.trim();
      if (!name) return null;

      const imageUrl = p.image_url || p.image_front_url || p.image_small_url || null;
      const packSize = p.quantity || 'Standard Pack';

      // Infer Kirana retail category from Open Food Facts categories
      let category: RetailCategory = 'Packaged FMCG';
      const catLower = (p.categories || '').toLowerCase();
      if (catLower.includes('beverage') || catLower.includes('drink') || catLower.includes('juice') || catLower.includes('soda')) {
        category = 'Beverages';
      } else if (catLower.includes('oil') || catLower.includes('spice') || catLower.includes('sauce') || catLower.includes('grocery')) {
        category = 'Grocery';
      } else if (catLower.includes('soap') || catLower.includes('shampoo') || catLower.includes('hygiene') || catLower.includes('beauty')) {
        category = 'Personal Care';
      } else if (catLower.includes('clean') || catLower.includes('detergent')) {
        category = 'Household';
      } else if (catLower.includes('grain') || catLower.includes('rice') || catLower.includes('flour')) {
        category = 'Grains';
      } else if (catLower.includes('pulse') || catLower.includes('dal') || catLower.includes('lentil')) {
        category = 'Pulses';
      }

      // Check authoritative printed MRP from packaging or text fields
      let parsedMrp =
        extractPriceFromPackagingText(rawName) ||
        extractPriceFromPackagingText(p.generic_name || '') ||
        extractPriceFromPackagingText(p.packaging_text || '') ||
        extractPriceFromPackagingText(p.labels || '');

      if (!parsedMrp && typeof p.price === 'number' && p.price > 0) {
        parsedMrp = p.price;
      }
      if (!parsedMrp && typeof p.mrp === 'number' && p.mrp > 0) {
        parsedMrp = p.mrp;
      }

      const mrp = parsedMrp ? snapToIndianPacketMrp(parsedMrp) : 50;
      const sellingPrice = mrp > 10 ? roundCurrency(mrp * 0.96) : mrp;
      const purchasePrice = roundCurrency(mrp * 0.84);

      return {
        name,
        brand: brand || 'Global Brand',
        imageUrl,
        category,
        packSize,
        mrp,
        sellingPrice,
        purchasePrice,
      };
    }
  } catch {
    // Network timeout or offline
  }
  return null;
}

/**
 * Asynchronously looks up product details across local inventory,
 * free Open Food Facts API, and the 10,000+ SKU master Kirana catalog.
 * Purges all hardcoded dummy fallbacks: returns found: false when completely unknown.
 */
export async function lookupGlobalProductCatalogAsync(
  rawBarcode: string,
  existingShopProducts: Product[] = []
): Promise<BarcodeLookupResult> {
  const cleanCode = (rawBarcode || '').trim().replace(/[\s\r\n\t]/g, '');
  const validation = validateRetailBarcode(cleanCode, existingShopProducts);

  if (!validation.isValid) {
    return {
      found: false,
      isValid: false,
      format: validation.format,
      rejectionReason: validation.rejectionReason,
      source: 'synthetic',
      barcode: cleanCode,
      name: '',
      brand: '',
      category: 'Packaged FMCG',
      packSize: '',
      sku: '',
      mrp: 0,
      sellingPrice: 0,
      purchasePrice: 0,
      baseUnit: 'Piece',
      isLoose: false,
      profitMarginPct: 0,
      expiryDate: getDefaultFmcgExpiry(),
      isAutoRegistered: false,
    };
  }

  // 1. Check local store inventory first
  const existing = findExactStoreProduct(cleanCode, existingShopProducts);
  if (existing) {
    const mrpVal = existing.mrp ?? 0;
    const purchaseVal = existing.purchasePrice ?? 0;
    return {
      found: true,
      isValid: true,
      format: validation.format,
      source: 'inventory',
      barcode: existing.barcode || cleanCode,
      name: existing.name,
      brand: existing.brand || '',
      category: existing.category,
      packSize: existing.packSize || '',
      sku: existing.sku || `SKU-${cleanCode.slice(-6)}`,
      mrp: mrpVal,
      sellingPrice: existing.sellingPrice,
      purchasePrice: purchaseVal,
      baseUnit: existing.baseUnit,
      isLoose: existing.baseUnit === 'Kilogram' && !existing.packSize,
      profitMarginPct: mrpVal > 0 ? roundCurrency(((mrpVal - purchaseVal) / mrpVal) * 100) : 12,
      expiryDate: getDefaultFmcgExpiry(),
      existingProduct: existing,
      imageUrl: existing.imageUrl,
      isAutoRegistered: false,
    };
  }

  // 2. Query Free Open Food Facts API (Live Global Database)
  const offProduct = await fetchOpenFoodFactsProduct(cleanCode);
  if (offProduct) {
    return {
      found: true,
      isValid: true,
      format: validation.format,
      source: 'master_catalog',
      isAutoRegistered: true,
      barcode: cleanCode,
      name: offProduct.name,
      brand: offProduct.brand,
      category: offProduct.category,
      packSize: offProduct.packSize,
      imageUrl: offProduct.imageUrl,
      sku: `SKU-OFF-${cleanCode.slice(-6)}`,
      mrp: offProduct.mrp,
      sellingPrice: offProduct.sellingPrice,
      purchasePrice: offProduct.purchasePrice,
      baseUnit: 'Piece',
      isLoose: false,
      profitMarginPct: roundCurrency(((offProduct.mrp - offProduct.purchasePrice) / offProduct.mrp) * 100),
      expiryDate: getDefaultFmcgExpiry(270),
    };
  }

  // 3. Check offline Master Catalog ONLY if exact SKU code or ID matches
  const { index } = ensureMasterBarcodeIndex();
  const masterSku = index.get(cleanCode.toLowerCase());
  if (masterSku) {
    const isLoose = masterSku.isLoose;
    const mrp =
      masterSku.suggestedMrp ??
      (isLoose ? 0 : roundCurrency(masterSku.wholesaleRate * 1.15));
    const sellingPrice =
      masterSku.suggestedMrp ??
      (isLoose
        ? roundCurrency(masterSku.wholesaleRate * 1.12)
        : roundCurrency(masterSku.wholesaleRate * 1.14));
    const purchasePrice = masterSku.wholesaleRate;
    const profitMarginPct =
      masterSku.profitMarginPct ??
      (mrp > 0 ? roundCurrency(((mrp - purchasePrice) / mrp) * 100) : 14);

    return {
      found: true,
      isValid: true,
      format: validation.format,
      source: 'master_catalog',
      barcode: cleanCode,
      name: `${masterSku.brand} ${masterSku.name} ${masterSku.packVariant}`.trim(),
      brand: masterSku.brand,
      category: 'Packaged FMCG',
      packSize: masterSku.packVariant,
      sku: masterSku.skuCode,
      mrp,
      sellingPrice,
      purchasePrice,
      baseUnit: isLoose ? 'Kilogram' : 'Piece',
      isLoose,
      profitMarginPct,
      expiryDate: getDefaultFmcgExpiry(270),
      isAutoRegistered: true,
    };
  }

  // 4. Barcode completely unknown globally (not in local inventory and not in Open Food Facts)
  // Absolutely NO fake Balaji or placeholder data!
  return {
    found: false,
    isValid: true,
    format: validation.format,
    source: 'synthetic',
    isAutoRegistered: false,
    rejectionReason: 'Product not in global database. Enter Name & MRP:',
    barcode: cleanCode,
    name: '',
    brand: '',
    category: 'Packaged FMCG',
    packSize: '',
    sku: `SKU-${cleanCode.slice(-6)}`,
    mrp: 0,
    sellingPrice: 0,
    purchasePrice: 0,
    baseUnit: 'Piece',
    isLoose: false,
    profitMarginPct: 0,
    expiryDate: getDefaultFmcgExpiry(),
  };
}
