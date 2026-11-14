import { roundCurrency } from './units';
import type { Customer, Invoice, InvoiceItem, Product, Shop } from './types';

export type InvoiceThemeArchetype =
  | 'minimalist'
  | 'thermal_pos'
  | 'enterprise_gst'
  | 'wholesale_challan'
  | 'boutique_luxury'
  | 'regional_vernacular';

export interface InvoiceLayoutDefinition {
  id: string;
  name: string;
  tagline: string;
  archetype: InvoiceThemeArchetype;
  paperSize: '80mm' | '58mm' | 'A4' | 'Letter';
  language?: 'en' | 'mr' | 'hi';
  accentColor: string;
  badge: string;
  description: string;
}

export const INVOICE_LAYOUT_CATALOG: InvoiceLayoutDefinition[] = [
  // ==========================================
  // 1. MODERN & MINIMALIST (10 Variants)
  // ==========================================
  {
    id: 'apple_clean_sheet',
    name: 'Apple Clean Sheet',
    tagline: 'Ultra-refined typography with airy whitespace and subtle dividers',
    archetype: 'minimalist',
    paperSize: 'A4',
    accentColor: '#0F172A',
    badge: 'Flagship',
    description: 'Generous padding, delicate hairline dividers, floating totals card.',
  },
  {
    id: 'nordic_monochrome',
    name: 'Nordic Monochrome',
    tagline: 'Pure black & white Scandinavian minimalist layout',
    archetype: 'minimalist',
    paperSize: 'A4',
    accentColor: '#18181B',
    badge: 'Clean',
    description: 'High-contrast typography, zero tint, architectural grid structure.',
  },
  {
    id: 'slate_glassmorphic',
    name: 'Slate Glassmorphic',
    tagline: 'Subtle slate borders with frosted total pill',
    archetype: 'minimalist',
    paperSize: 'A4',
    accentColor: '#334155',
    badge: 'Modern',
    description: 'Translucent summary boxes, soft backdrop borders, modern SaaS aesthetic.',
  },
  {
    id: 'swiss_grid_studio',
    name: 'Swiss Grid Studio',
    tagline: 'Strict Josef Müller-Brockmann inspired asymmetrical layout',
    archetype: 'minimalist',
    paperSize: 'A4',
    accentColor: '#09090B',
    badge: 'Studio',
    description: 'Bold numeral kickers, offset metadata column, balanced negative space.',
  },
  {
    id: 'tokyo_quiet_craft',
    name: 'Tokyo Quiet Craft',
    tagline: 'Delicate light lines, calm balance, serene typography',
    archetype: 'minimalist',
    paperSize: 'A4',
    accentColor: '#52525B',
    badge: 'Zen',
    description: 'Quiet metadata headers, centered shop mark, unobtrusive line items.',
  },
  {
    id: 'berlin_industrial_clean',
    name: 'Berlin Industrial Clean',
    tagline: 'Sturdy sans headers with tight clean tabular figures',
    archetype: 'minimalist',
    paperSize: 'A4',
    accentColor: '#27272A',
    badge: 'Bauhaus',
    description: 'Monospace tabular figures paired with architectural display type.',
  },
  {
    id: 'california_modernist',
    name: 'California Modernist',
    tagline: 'Warm sand neutral canvas with deep indigo accents',
    archetype: 'minimalist',
    paperSize: 'A4',
    accentColor: '#4338CA',
    badge: 'Warm Sans',
    description: 'Subtle ivory surface, rounded card groupings, friendly modern look.',
  },
  {
    id: 'fintech_neo_receipt',
    name: 'Fintech Neo-Receipt',
    tagline: 'Stripe & Linear-inspired card geometry and border strokes',
    archetype: 'minimalist',
    paperSize: 'A4',
    accentColor: '#4F46E5',
    badge: 'Fintech',
    description: 'Crisp 1px border container, dedicated QR dock, smooth hierarchy.',
  },
  {
    id: 'compact_executive_memo',
    name: 'Compact Executive Memo',
    tagline: 'Compact single-page letter format with horizontal stat split',
    archetype: 'minimalist',
    paperSize: 'Letter',
    accentColor: '#1E293B',
    badge: 'Executive',
    description: 'Dual-column header summary with full-width tabular item list.',
  },
  {
    id: 'monochrome_hairline',
    name: 'Monochrome Hairline',
    tagline: '0.5px ultra-fine borders and high legibility text',
    archetype: 'minimalist',
    paperSize: 'A4',
    accentColor: '#71717A',
    badge: 'Airy',
    description: 'Whisper-quiet borders that look exceptionally sharp when printed on paper.',
  },

  // ==========================================
  // 2. HIGH-DENSITY THERMAL POS (10 Variants)
  // ==========================================
  {
    id: 'pos_80mm_standard',
    name: '80mm Standard Kirana Roll',
    tagline: 'The daily staple for high-speed ESC/POS 80mm thermal printers',
    archetype: 'thermal_pos',
    paperSize: '80mm',
    accentColor: '#000000',
    badge: '80mm POS',
    description: 'Dotted cut guidelines, bold centered header, compact item row metrics.',
  },
  {
    id: 'pos_80mm_dual_line',
    name: '80mm Item/Rate Stacked',
    tagline: 'Title on line 1, Qty × Rate on line 2 with right-aligned line total',
    archetype: 'thermal_pos',
    paperSize: '80mm',
    accentColor: '#000000',
    badge: 'Zero Clip',
    description: 'Eliminates column squishing for long FMCG and grocery item names.',
  },
  {
    id: 'pos_80mm_compact_summary',
    name: '80mm Express Quick Bill',
    tagline: 'Super-dense line spacing designed for rapid counter queues',
    archetype: 'thermal_pos',
    paperSize: '80mm',
    accentColor: '#000000',
    badge: 'Fast Counter',
    description: 'Minimizes paper roll usage with ultra-compact tabular rows.',
  },
  {
    id: 'pos_80mm_qr_dock',
    name: '80mm Instant UPI QR',
    tagline: 'Prominent bottom UPI QR code for fast scanner payments',
    archetype: 'thermal_pos',
    paperSize: '80mm',
    accentColor: '#000000',
    badge: 'UPI QR',
    description: 'Centered 21x21 QR code at the bill footer with payment instructions.',
  },
  {
    id: 'pos_80mm_gst_breakdown',
    name: '80mm Thermal GST Summary',
    tagline: 'Compact CGST/SGST percentage split table at receipt footer',
    archetype: 'thermal_pos',
    paperSize: '80mm',
    accentColor: '#000000',
    badge: 'GST Split',
    description: 'Tax breakdown on thermal roll for compliance-ready retail sales.',
  },
  {
    id: 'pos_58mm_pocket_roll',
    name: '58mm Pocket Bluetooth POS',
    tagline: 'Slim 2-inch roll layout for portable handheld Bluetooth printers',
    archetype: 'thermal_pos',
    paperSize: '58mm',
    accentColor: '#000000',
    badge: '58mm Slim',
    description: 'Narrow 384-dot layout optimized for van delivery and handheld POS terminals.',
  },
  {
    id: 'pos_58mm_stacked_ledger',
    name: '58mm Handheld with Khata Due',
    tagline: 'Slim receipt highlighting customer previous vs closing credit balance',
    archetype: 'thermal_pos',
    paperSize: '58mm',
    accentColor: '#000000',
    badge: '58mm Khata',
    description: 'Displays party name and outstanding balance clearly on a narrow strip.',
  },
  {
    id: 'pos_80mm_barcode_footer',
    name: '80mm Barcode Return Slip',
    tagline: 'Generates return/verification code bar at the ticket bottom',
    archetype: 'thermal_pos',
    paperSize: '80mm',
    accentColor: '#000000',
    badge: 'Audit Bar',
    description: 'Machine-readable invoice tracking line for fast audit and returns.',
  },
  {
    id: 'pos_80mm_store_policy',
    name: '80mm Full Terms Policy',
    tagline: 'Includes complete return, exchange, and warranty policy notes',
    archetype: 'thermal_pos',
    paperSize: '80mm',
    accentColor: '#000000',
    badge: 'Policy Note',
    description: 'Extended bottom policy section for consumer electronics and apparel.',
  },
  {
    id: 'pos_80mm_heavy_border',
    name: '80mm Double Rule Classic',
    tagline: 'Traditional double-dashed separator lines for clear section division',
    archetype: 'thermal_pos',
    paperSize: '80mm',
    accentColor: '#000000',
    badge: 'Classic POS',
    description: 'Crisp double border rules distinguishing header, items, and settlement.',
  },

  // ==========================================
  // 3. ENTERPRISE TAX INVOICES (10 Variants)
  // ==========================================
  {
    id: 'enterprise_gst_standard',
    name: 'A4 Enterprise GST Master',
    tagline: 'Official Indian GST tax invoice with full CGST/SGST/IGST compliance',
    archetype: 'enterprise_gst',
    paperSize: 'A4',
    accentColor: '#1E3A8A',
    badge: 'GST Standard',
    description: 'Dual-box seller/buyer layout, HSN codes, tax tables, bank details & signatory.',
  },
  {
    id: 'enterprise_hsn_matrix',
    name: 'A4 HSN/SAC Tax Matrix',
    tagline: 'Detailed tax breakdown table grouped strictly by HSN 4-digit code',
    archetype: 'enterprise_gst',
    paperSize: 'A4',
    accentColor: '#0F766E',
    badge: 'HSN Matrix',
    description: 'Dedicated bottom tax schedule detailing taxable values and rates per HSN.',
  },
  {
    id: 'enterprise_dual_tax_split',
    name: 'A4 Dual-Tax Split (CGST/SGST)',
    tagline: 'Dedicated separate columns for CGST rate/amt and SGST rate/amt',
    archetype: 'enterprise_gst',
    paperSize: 'A4',
    accentColor: '#1D4ED8',
    badge: 'Dual Column',
    description: 'Transparent split per line item satisfying stringent accountant audits.',
  },
  {
    id: 'enterprise_igst_interstate',
    name: 'A4 Interstate IGST Supply',
    tagline: 'Configured for inter-state supply with integrated GST tax lines',
    archetype: 'enterprise_gst',
    paperSize: 'A4',
    accentColor: '#4338CA',
    badge: 'IGST Out-of-State',
    description: 'Clear state code indication and single IGST levy calculation.',
  },
  {
    id: 'enterprise_bank_qr_showcase',
    name: 'A4 Bank Wire & UPI Showcase',
    tagline: 'Prominent bank wire transfer box with IFSC, Account, and dynamic UPI QR',
    archetype: 'enterprise_gst',
    paperSize: 'A4',
    accentColor: '#0369A1',
    badge: 'Bank Wire',
    description: 'Complete RTGS/NEFT/IMPS and UPI instructions for corporate accounts.',
  },
  {
    id: 'enterprise_dual_signatory',
    name: 'A4 Dual Signatory (Issuer & Receiver)',
    tagline: 'Side-by-side formal signature blocks with stamp boxes',
    archetype: 'enterprise_gst',
    paperSize: 'A4',
    accentColor: '#1E293B',
    badge: 'Signatory Box',
    description: 'Official acknowledgement blocks for commercial delivery contracts.',
  },
  {
    id: 'enterprise_letter_format',
    name: 'Letter Corporate GST Bill',
    tagline: 'US Letter page proportions for multinational distributor compliance',
    archetype: 'enterprise_gst',
    paperSize: 'Letter',
    accentColor: '#2563EB',
    badge: 'US Letter',
    description: 'Formatted strictly within 8.5 x 11 inch dimensions with zero margin bleed.',
  },
  {
    id: 'enterprise_bold_header',
    name: 'A4 Navy Header Corporate',
    tagline: 'Deep navy executive header band with crisp white typography',
    archetype: 'enterprise_gst',
    paperSize: 'A4',
    accentColor: '#1E3A8A',
    badge: 'Navy Header',
    description: 'Stately company letterhead bar giving invoices institutional weight.',
  },
  {
    id: 'enterprise_emerald_audit',
    name: 'A4 Emerald Compliance Sheet',
    tagline: 'Forest emerald accents with clear verification stamps',
    archetype: 'enterprise_gst',
    paperSize: 'A4',
    accentColor: '#047857',
    badge: 'Verified',
    description: 'Fresh emerald accenting paired with formal tabular compliance rows.',
  },
  {
    id: 'enterprise_condensed_ledger',
    name: 'A4 40-Line High Capacity Bill',
    tagline: 'High-density row format fitting up to 35-40 items on a single sheet',
    archetype: 'enterprise_gst',
    paperSize: 'A4',
    accentColor: '#334155',
    badge: 'High Density',
    description: 'Engineered for wholesale grocery bills with massive SKU line counts.',
  },

  // ==========================================
  // 4. WHOLESALE B2B DELIVERY CHALLANS (10 Variants)
  // ==========================================
  {
    id: 'wholesale_b2b_standard',
    name: 'B2B Wholesale Delivery Challan',
    tagline: 'Dispatches, quintal weights, pack counts, and Khata balance',
    archetype: 'wholesale_challan',
    paperSize: 'A4',
    accentColor: '#B45309',
    badge: 'Flagship B2B',
    description: 'Quintal conversions, previous vs closing Khata balance, dispatch tempo info.',
  },
  {
    id: 'wholesale_quintal_sacks',
    name: 'Mandi Sack & Quintal Register',
    tagline: 'Columns tailored for 50kg sacks, quintal weights, and gross tare net',
    archetype: 'wholesale_challan',
    paperSize: 'A4',
    accentColor: '#D97706',
    badge: 'Gross/Tare/Net',
    description: 'Ideal for raw grain, sugar sacks, pulses, and oil tins dispatching.',
  },
  {
    id: 'wholesale_khata_credit_focus',
    name: 'Khata Ledger Settlement Challan',
    tagline: 'Dedicated gold card summarizing customer credit history and terms',
    archetype: 'wholesale_challan',
    paperSize: 'A4',
    accentColor: '#92400E',
    badge: 'Khata Due',
    description: 'Highlights previous balance, credit added today, and due date prominently.',
  },
  {
    id: 'wholesale_transporter_consignment',
    name: 'Transporter Goods Consignment Note',
    tagline: 'Contains LR/GR Number, Vehicle No, Driver Phone, and E-Way Bill Ref',
    archetype: 'wholesale_challan',
    paperSize: 'A4',
    accentColor: '#78350F',
    badge: 'E-Way Bill Ref',
    description: 'Standard carrier dispatch note for inter-district commercial transport.',
  },
  {
    id: 'wholesale_multi_tier_packaging',
    name: 'Multi-Tier Pack Hierarchy',
    tagline: 'Cartons × Inner Packets × Base Units multi-unit breakdown',
    archetype: 'wholesale_challan',
    paperSize: 'A4',
    accentColor: '#B45309',
    badge: 'Carton/Pack',
    description: 'Calculates carton count alongside equivalent loose packet counts.',
  },
  {
    id: 'wholesale_warehouse_dispatch',
    name: 'Warehouse Dispatch Gate Pass',
    tagline: 'Includes security checkpoint inspection stamp and loader initials',
    archetype: 'wholesale_challan',
    paperSize: 'A4',
    accentColor: '#451A03',
    badge: 'Gate Pass',
    description: 'Warehouse outgoing gatepass verification format.',
  },
  {
    id: 'wholesale_triplicate_carbon_layout',
    name: 'Triplicate B2B Trade Bill',
    tagline: 'Marked clearly: Original for Buyer, Duplicate for Transporter, Triplicate for Supplier',
    archetype: 'wholesale_challan',
    paperSize: 'A4',
    accentColor: '#9A3412',
    badge: 'Triplicate',
    description: 'Official statutory 3-copy wholesale transaction layout.',
  },
  {
    id: 'wholesale_heavy_staples_sheet',
    name: 'Heavy Staples Bulk Invoice',
    tagline: 'Formulated for Rice, Wheat, Sugar, and Edible Oil bulk distributors',
    archetype: 'wholesale_challan',
    paperSize: 'A4',
    accentColor: '#C2410C',
    badge: 'Staples Bulk',
    description: 'Pre-formatted unit headers matching Indian wholesale grain mandis.',
  },
  {
    id: 'wholesale_credit_aging_warning',
    name: 'Challan with Payment Aging Terms',
    tagline: 'Includes 7-day, 15-day, and 30-day payment interest schedule',
    archetype: 'wholesale_challan',
    paperSize: 'A4',
    accentColor: '#7C2D12',
    badge: 'Payment Terms',
    description: 'Protects supplier margins with explicit delayed payment interest notices.',
  },
  {
    id: 'wholesale_receipt_counter_stub',
    name: 'Challan with Perforated Counter Stub',
    tagline: 'Tear-off bottom receipt for customer payment acknowledgement',
    archetype: 'wholesale_challan',
    paperSize: 'A4',
    accentColor: '#B45309',
    badge: 'Tear Stub',
    description: 'Dotted cutline separating customer receipt from warehouse file copy.',
  },

  // ==========================================
  // 5. BOUTIQUE & LUXURY RETAIL (6 Variants)
  // ==========================================
  {
    id: 'boutique_royal_gold',
    name: 'Royal Gold & Champagne',
    tagline: 'Warm amber-gold borders with refined serif typography',
    archetype: 'boutique_luxury',
    paperSize: 'A4',
    accentColor: '#B45309',
    badge: 'Gold Accent',
    description: 'Gourmet foods, dry fruit gifting, artisanal tea and luxury hampers.',
  },
  {
    id: 'boutique_slate_executive',
    name: 'Dark Slate Executive',
    tagline: 'Sophisticated dark slate border frame with crisp interior grid',
    archetype: 'boutique_luxury',
    paperSize: 'A4',
    accentColor: '#0F172A',
    badge: 'Slate Corp',
    description: 'Premium electronics, organic lifestyle stores, modern supermarkets.',
  },
  {
    id: 'boutique_vibrant_indigo',
    name: 'Vibrant Indigo Neon',
    tagline: 'Energetic indigo headers with luminous accent tags',
    archetype: 'boutique_luxury',
    paperSize: 'A4',
    accentColor: '#4F46E5',
    badge: 'Neon Indigo',
    description: 'Trendy retail, modern supermarkets, urban convenience stores.',
  },
  {
    id: 'boutique_emerald_gourmet',
    name: 'Emerald Gourmet Organic',
    tagline: 'Deep forest green framing for organic and natural wellness stores',
    archetype: 'boutique_luxury',
    paperSize: 'A4',
    accentColor: '#065F46',
    badge: 'Organic',
    description: 'Eco-certified stores, cold-pressed oils, organic honey & spices.',
  },
  {
    id: 'boutique_rose_confectionery',
    name: 'Rose & Crimson Confectionery',
    tagline: 'Warm ruby-rose palette for sweet shops, bakeries, and festive gifting',
    archetype: 'boutique_luxury',
    paperSize: 'A4',
    accentColor: '#BE123C',
    badge: 'Sweet & Bakery',
    description: 'Festive Mithai, bakery treats, premium dry fruits and celebration gift boxes.',
  },
  {
    id: 'boutique_bronze_vintage',
    name: 'Vintage Bronze Letterpress',
    tagline: 'Artisanal bronze tones with classic boxed title frame',
    archetype: 'boutique_luxury',
    paperSize: 'A4',
    accentColor: '#78350F',
    badge: 'Heritage',
    description: 'Old-world Kirana heritage branding, brass-trimmed borders, storied trust.',
  },

  // ==========================================
  // 6. REGIONAL MULTI-LINGUAL SUPPORT (4 Variants)
  // ==========================================
  {
    id: 'regional_marathi_kirana',
    name: 'मराठी किराणा पावती (Marathi Kirana)',
    tagline: 'स्थानिक मराठी शीर्षके आणि अधिकृत कर पावती (कर बीजक)',
    archetype: 'regional_vernacular',
    paperSize: 'A4',
    language: 'mr',
    accentColor: '#C2410C',
    badge: 'मराठी',
    description: 'मराठी शीर्षके: कर बीजक, ग्राहकाचे नाव, तपशील, दर, एकूण रक्कम, सही व शिक्का.',
  },
  {
    id: 'regional_marathi_thermal_80mm',
    name: 'मराठी 80mm काउंटर पावती (Marathi POS)',
    tagline: '80mm थर्मल प्रिंटरसाठी संपूर्ण मराठी पावती रूपरेषा',
    archetype: 'regional_vernacular',
    paperSize: '80mm',
    language: 'mr',
    accentColor: '#000000',
    badge: '80mm मराठी',
    description: 'थर्मल काउंटरसाठी मराठी अक्षरांमध्ये देयक क्रमांक, तारीख, वस्तू आणि एकूण देय.',
  },
  {
    id: 'regional_hindi_vyapar',
    name: 'हिंदी व्यापार बीजक (Hindi Tax Invoice)',
    tagline: 'पारंपरिक भारतीय व्यापार बीजक हिंदी व इंग्रजी संयुक्त भाषेत',
    archetype: 'regional_vernacular',
    paperSize: 'A4',
    language: 'hi',
    accentColor: '#1D4ED8',
    badge: 'हिंदी',
    description: 'हिंदी शीर्षके: कर बीजक, विक्रेता व क्रेता विवरण, वस्तु विवरण, दर, कुल राशि.',
  },
  {
    id: 'regional_hindi_thermal_80mm',
    name: 'हिंदी 80mm थर्मल पर्ची (Hindi POS)',
    tagline: 'काउंटर प्रिंटर हेतु शुद्ध हिंदी बिल प्रारूप',
    archetype: 'regional_vernacular',
    paperSize: '80mm',
    language: 'hi',
    accentColor: '#000000',
    badge: '80mm हिंदी',
    description: 'तेज काउंटर बिलिंग हेतु हिंदी में रसीद, वस्तु, दर, जीएसटी और भुगतान विवरण.',
  },
];

export interface InvoiceCustomizationPrefs {
  style: string;
  showShopName: boolean;
  showAddress: boolean;
  showGstin: boolean;
  showLogo: boolean;
  customLogoDataUrl: string | null;
  upiId: string;
  bankName: string;
  bankAccountNumber: string;
  bankIfscCode: string;
  signatureNote: string;
  challanTransportNote: string;
  receiptPaperWidth?: '58mm' | '80mm';
  invoicePrefix?: string;
  footerNote?: string;
}

export const DEFAULT_INVOICE_PREFS: InvoiceCustomizationPrefs = {
  style: 'enterprise_gst_standard',
  showShopName: true,
  showAddress: true,
  showGstin: true,
  showLogo: true,
  customLogoDataUrl: null,
  upiId: '',
  bankName: '',
  bankAccountNumber: '',
  bankIfscCode: '',
  signatureNote: 'Goods once sold will not be taken back. Subject to local jurisdiction.',
  challanTransportNote: 'Standard Local Kirana Tempo / Counter Dispatch',
  receiptPaperWidth: '80mm',
  invoicePrefix: 'INV',
  footerNote: 'Thank you for shopping with us! Please visit again.',
};

const INVOICE_PREFS_PREFIX = 'bhaviq_invoice_prefs:';

export function loadInvoicePrefs(
  shopId: string,
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null
): InvoiceCustomizationPrefs {
  const cleanShopId = shopId?.trim();
  const store = storage ?? (typeof window !== 'undefined' ? window.localStorage : null);
  if (!cleanShopId || !store) {
    return { ...DEFAULT_INVOICE_PREFS };
  }
  try {
    const raw = store.getItem(`${INVOICE_PREFS_PREFIX}${cleanShopId}`);
    if (!raw) return { ...DEFAULT_INVOICE_PREFS };
    const parsed = JSON.parse(raw) as Partial<InvoiceCustomizationPrefs> & { shopId?: string };
    if (parsed.shopId && parsed.shopId !== cleanShopId) {
      return { ...DEFAULT_INVOICE_PREFS };
    }

    // Support backward compatibility with older style IDs:
    let resolvedStyle = parsed.style ?? DEFAULT_INVOICE_PREFS.style;
    if (resolvedStyle === 'a4_tax_invoice') resolvedStyle = 'enterprise_gst_standard';
    if (resolvedStyle === 'thermal_80mm') resolvedStyle = 'pos_80mm_standard';
    if (resolvedStyle === 'modern_minimalist') resolvedStyle = 'apple_clean_sheet';
    if (resolvedStyle === 'wholesale_challan') resolvedStyle = 'wholesale_b2b_standard';

    const exists = INVOICE_LAYOUT_CATALOG.some((l) => l.id === resolvedStyle);

    return {
      style: exists ? resolvedStyle : DEFAULT_INVOICE_PREFS.style,
      showShopName: parsed.showShopName ?? DEFAULT_INVOICE_PREFS.showShopName,
      showAddress: parsed.showAddress ?? DEFAULT_INVOICE_PREFS.showAddress,
      showGstin: parsed.showGstin ?? DEFAULT_INVOICE_PREFS.showGstin,
      showLogo: parsed.showLogo ?? DEFAULT_INVOICE_PREFS.showLogo,
      customLogoDataUrl:
        typeof parsed.customLogoDataUrl === 'string' &&
        parsed.customLogoDataUrl.startsWith('data:image/')
          ? parsed.customLogoDataUrl
          : null,
      upiId: typeof parsed.upiId === 'string' ? parsed.upiId : DEFAULT_INVOICE_PREFS.upiId,
      bankName: typeof parsed.bankName === 'string' ? parsed.bankName : DEFAULT_INVOICE_PREFS.bankName,
      bankAccountNumber:
        typeof parsed.bankAccountNumber === 'string'
          ? parsed.bankAccountNumber
          : DEFAULT_INVOICE_PREFS.bankAccountNumber,
      bankIfscCode:
        typeof parsed.bankIfscCode === 'string'
          ? parsed.bankIfscCode
          : DEFAULT_INVOICE_PREFS.bankIfscCode,
      signatureNote:
        typeof parsed.signatureNote === 'string'
          ? parsed.signatureNote
          : DEFAULT_INVOICE_PREFS.signatureNote,
      challanTransportNote:
        typeof parsed.challanTransportNote === 'string'
          ? parsed.challanTransportNote
          : DEFAULT_INVOICE_PREFS.challanTransportNote,
      receiptPaperWidth:
        parsed.receiptPaperWidth === '58mm' ? '58mm' : '80mm',
      invoicePrefix:
        typeof parsed.invoicePrefix === 'string' && parsed.invoicePrefix.trim()
          ? parsed.invoicePrefix.trim().toUpperCase()
          : DEFAULT_INVOICE_PREFS.invoicePrefix,
      footerNote:
        typeof parsed.footerNote === 'string'
          ? parsed.footerNote
          : DEFAULT_INVOICE_PREFS.footerNote,
    };
  } catch {
    return { ...DEFAULT_INVOICE_PREFS };
  }
}

export function saveInvoicePrefs(
  shopId: string,
  prefs: InvoiceCustomizationPrefs,
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null
): void {
  const cleanShopId = shopId?.trim();
  const store = storage ?? (typeof window !== 'undefined' ? window.localStorage : null);
  if (!cleanShopId || !store) return;
  try {
    store.setItem(
      `${INVOICE_PREFS_PREFIX}${cleanShopId}`,
      JSON.stringify({ ...prefs, shopId: cleanShopId })
    );
  } catch {
    // ignore quota error
  }
}

/**
 * Deterministic Indian GST HSN classification for kirana & wholesale items.
 */
export function inferHsnCode(productName: string, category?: string | null): string {
  const text = `${productName} ${category ?? ''}`.toLowerCase();
  if (/\b(sugar|jaggery|gur)\b/.test(text)) return '1701';
  if (/\b(rice|basmati|poha)\b/.test(text)) return '1006';
  if (/\b(atta|wheat|maida|suji|sooji|rava|flour)\b/.test(text)) return '1101';
  if (/\b(sunflower|soyabean|oil|ghee)\b/.test(text)) return '1512';
  if (/\b(mustard oil|groundnut oil)\b/.test(text)) return '1514';
  if (/\b(dal|toor|tur|moong|urad|chana|masoor|rajma|pulses|gram)\b/.test(text)) return '0713';
  if (/\b(tea|chai|assam)\b/.test(text)) return '0902';
  if (/\b(coffee|nescafe|bru)\b/.test(text)) return '0901';
  if (/\b(jeera|cumin|turmeric|haldi|chilli|coriander|masala|spice|pepper|cardamom)\b/.test(text))
    return '0910';
  if (/\b(salt|tata salt|namak)\b/.test(text)) return '2501';
  if (/\b(biscuit|cookie|good day|parle|marie|cracker|rusk|namkeen|bhujia)\b/.test(text))
    return '1905';
  if (/\b(noodle|maggi|pasta|vermicelli)\b/.test(text)) return '1902';
  if (/\b(soap|detergent|surf|ariel|vim|harpic|lizol|shampoo|clean)\b/.test(text)) return '3401';
  if (/\b(milk|paneer|butter|curd|cheese)\b/.test(text)) return '0401';
  if (/\b(chocolate|dairy milk|candy|toffee)\b/.test(text)) return '1806';
  if (/\b(beverage|cola|juice|soda|water|drink)\b/.test(text)) return '2202';
  return '2106';
}

/**
 * Splits total GST amount cleanly into exact CGST (50%) and SGST (50%)
 * ensuring cgst + sgst === totalTax with zero penny rounding drift.
 */
export function computeGstSplit(totalTax: number): {
  cgst: number;
  sgst: number;
  totalTax: number;
} {
  const safeTax = Number.isFinite(totalTax) && totalTax > 0 ? roundCurrency(totalTax) : 0;
  const cgst = roundCurrency(safeTax / 2);
  const sgst = roundCurrency(safeTax - cgst);
  return { cgst, sgst, totalTax: safeTax };
}

export interface ChallanUnitSummary {
  packCountLabel: string;
  weightEquivalentLabel: string;
}

export function computeChallanUnitMetrics(item: InvoiceItem): ChallanUnitSummary {
  const unitLower = item.unitName.toLowerCase();
  const baseQty = roundCurrency(item.baseQuantityDeducted || item.quantity);
  const packCountLabel = `${item.quantity} ${item.unitName}`;

  if (unitLower.includes('kg') || unitLower.includes('kilo')) {
    if (baseQty >= 100) {
      const quintals = roundCurrency(baseQty / 100);
      return {
        packCountLabel,
        weightEquivalentLabel: `${baseQty} Kg (${quintals} Qtl)`,
      };
    }
    return {
      packCountLabel,
      weightEquivalentLabel: `${baseQty} Kg`,
    };
  }

  if (unitLower.includes('gram') || unitLower === 'g') {
    return {
      packCountLabel,
      weightEquivalentLabel: `${roundCurrency(baseQty / 1000)} Kg (${baseQty} g)`,
    };
  }

  if (unitLower.includes('litre') || unitLower.includes('ltr') || unitLower === 'l') {
    return {
      packCountLabel,
      weightEquivalentLabel: `${baseQty} Ltr`,
    };
  }

  return {
    packCountLabel,
    weightEquivalentLabel: `${baseQty} Base Units`,
  };
}

export function buildUpiPaymentUri(params: {
  upiId: string;
  shopName: string;
  amount: number;
  invoiceNumber: string;
}): string {
  const cleanUpi = params.upiId.trim() || 'merchant@upi';
  const cleanName = encodeURIComponent(params.shopName.trim() || 'BhavIQ Store');
  const cleanAmt = Math.max(0, roundCurrency(params.amount)).toFixed(2);
  const cleanNote = encodeURIComponent(`Bill ${params.invoiceNumber}`);
  return `upi://pay?pa=${encodeURIComponent(cleanUpi)}&pn=${cleanName}&am=${cleanAmt}&cu=INR&tn=${cleanNote}`;
}

export function generateDeterministicQrMatrix(payload: string, size = 21): boolean[][] {
  const grid: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  const placeFinder = (r0: number, c0: number) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const isBorder = r === 0 || r === 6 || c === 0 || c === 6;
        const isCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        grid[r0 + r][c0 + c] = isBorder || isCore;
      }
    }
  };

  const isReserved = (r: number, c: number) => {
    const topLeft = r < 8 && c < 8;
    const topRight = r < 8 && c >= size - 8;
    const bottomLeft = r >= size - 8 && c < 8;
    const timing = r === 6 || c === 6;
    return topLeft || topRight || bottomLeft || timing;
  };

  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  for (let i = 8; i < size - 8; i++) {
    const bit = i % 2 === 0;
    grid[6][i] = bit;
    grid[i][6] = bit;
  }

  let hash = 2166136261;
  for (let i = 0; i < payload.length; i++) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (isReserved(r, c)) continue;
      hash ^= (r * 31 + c * 17 + payload.length) >>> 0;
      hash = Math.imul(hash, 16777619) >>> 0;
      grid[r][c] = (hash & 3) !== 0 && (hash & 1) === 1;
    }
  }

  return grid;
}

export interface CartPreviewLine {
  product: Product;
  quantity: number;
  unitName: string;
  unitSellingPrice: number;
  discountAmount: number;
}

export function buildPreviewInvoice(params: {
  shop: Shop;
  cartLines: CartPreviewLine[];
  selectedCustomer?: Customer | null;
  invoiceDiscount?: number;
  paymentMode?: Invoice['paymentMode'];
  totals?: { subtotal: number; taxAmount: number; totalAmount: number };
}): { invoice: Invoice; isSample: boolean } {
  const {
    shop,
    cartLines,
    selectedCustomer,
    invoiceDiscount = 0,
    paymentMode = 'upi',
    totals,
  } = params;
  if (cartLines.length > 0 && totals) {
    return {
      isSample: true,
      invoice: {
        id: 'preview-cart',
        shopId: shop.id,
        clientTxId: 'preview',
        invoiceNumber: `PREVIEW-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}`,
        customerId: selectedCustomer?.id ?? null,
        customerNameSnapshot: selectedCustomer?.name ?? 'Walk-in Customer',
        subtotal: totals.subtotal,
        discountAmount: invoiceDiscount,
        discountAuthorizedBy: null,
        taxAmount: totals.taxAmount,
        totalAmount: totals.totalAmount,
        paidAmount: paymentMode === 'credit' ? 0 : totals.totalAmount,
        creditAmount: paymentMode === 'credit' ? totals.totalAmount : 0,
        paymentMode,
        status: 'preview',
        createdBy: 'owner',
        createdAt: new Date().toISOString(),
        items: cartLines.map((line, idx) => {
          const lineGross = roundCurrency(
            line.quantity * line.unitSellingPrice - line.discountAmount
          );
          const rate = shop.taxMode === 'non_gst' ? 0 : line.product.taxRatePct;
          const lineTax =
            shop.taxMode === 'gst_exclusive'
              ? roundCurrency((lineGross * rate) / 100)
              : shop.taxMode === 'gst_inclusive' && rate > 0
                ? roundCurrency(lineGross - lineGross / (1 + rate / 100))
                : 0;
          return {
            id: `preview-line-${idx}`,
            invoiceId: 'preview-cart',
            productId: line.product.id,
            productNameSnapshot: line.product.name,
            brandSnapshot: line.product.brand,
            quantity: line.quantity,
            unitName: line.unitName,
            baseQuantityDeducted: line.quantity,
            unitSellingPrice: line.unitSellingPrice,
            costPriceSnapshot: line.product.landedCost ?? line.product.purchasePrice,
            discountAmount: line.discountAmount,
            taxRatePct: rate,
            taxAmount: lineTax,
            lineTotal:
              shop.taxMode === 'gst_exclusive' ? roundCurrency(lineGross + lineTax) : lineGross,
          };
        }),
      },
    };
  }

  return {
    isSample: true,
    invoice: {
      id: 'sample-specimen',
      shopId: shop.id,
      clientTxId: 'sample-specimen',
      invoiceNumber: 'INV-2026-0108',
      customerId: selectedCustomer?.id ?? null,
      customerNameSnapshot: selectedCustomer?.name ?? 'Mahalaxmi Super Bazaar',
      subtotal: 4476.19,
      discountAmount: 0,
      discountAuthorizedBy: null,
      taxAmount: 223.81,
      totalAmount: 4700.0,
      paidAmount: 3500.0,
      creditAmount: 1200.0,
      paymentMode: 'split',
      status: 'completed',
      createdBy: 'owner',
      createdAt: new Date().toISOString(),
      items: [
        {
          id: 's-1',
          invoiceId: 'sample-specimen',
          productId: 'p-1',
          productNameSnapshot: 'Loose Sugar M-30 Bulk Sack',
          brandSnapshot: 'Wholesale Mill Grade',
          quantity: 50,
          unitName: 'Kilogram',
          baseQuantityDeducted: 50,
          unitSellingPrice: 40,
          costPriceSnapshot: 38.5,
          discountAmount: 0,
          taxRatePct: 5,
          taxAmount: 95.24,
          lineTotal: 2000.0,
        },
        {
          id: 's-2',
          invoiceId: 'sample-specimen',
          productId: 'p-2',
          productNameSnapshot: 'Fortune Sunlite Refined Sunflower Oil 1L',
          brandSnapshot: 'Fortune',
          quantity: 12,
          unitName: 'Litre',
          baseQuantityDeducted: 12,
          unitSellingPrice: 135,
          costPriceSnapshot: 124,
          discountAmount: 0,
          taxRatePct: 5,
          taxAmount: 77.14,
          lineTotal: 1620.0,
        },
        {
          id: 's-3',
          invoiceId: 'sample-specimen',
          productId: 'p-3',
          productNameSnapshot: 'Britannia Good Day Cashew Pack (Case)',
          brandSnapshot: 'Britannia',
          quantity: 2,
          unitName: 'Box',
          baseQuantityDeducted: 24,
          unitSellingPrice: 540,
          costPriceSnapshot: 472,
          discountAmount: 0,
          taxRatePct: 5,
          taxAmount: 51.43,
          lineTotal: 1080.0,
        },
      ],
    },
  };
}
