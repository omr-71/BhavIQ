import React, { useMemo, useRef, useState } from 'react';
import { BhaviqLogo } from './BhaviqLogo';
import { FieldLabel, TextInput } from './ui';
import { formatINR } from '../lib/finance';
import {
  buildUpiPaymentUri,
  computeChallanUnitMetrics,
  computeGstSplit,
  DEFAULT_INVOICE_PREFS,
  generateDeterministicQrMatrix,
  inferHsnCode,
  INVOICE_LAYOUT_CATALOG,
  type InvoiceCustomizationPrefs,
  type InvoiceLayoutDefinition,
  type InvoiceThemeArchetype,
} from '../lib/invoiceTemplates';
import type { Customer, Invoice, Product, Shop } from '../lib/types';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Filter,
  Palette,
  Printer,
  QrCode,
  Receipt,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';

interface UpiQrCodeSvgProps {
  payload: string;
  sizePx?: number;
}

const UpiQrCodeSvg: React.FC<UpiQrCodeSvgProps> = ({ payload, sizePx = 88 }) => {
  const matrix = useMemo(() => generateDeterministicQrMatrix(payload, 21), [payload]);
  const n = matrix.length;
  return (
    <svg
      width={sizePx}
      height={sizePx}
      viewBox={`0 0 ${n + 2} ${n + 2}`}
      role="img"
      aria-label="UPI Payment QR Code"
      className="bg-white rounded-lg border border-slate-200 p-1 shrink-0"
    >
      <rect x="0" y="0" width={n + 2} height={n + 2} fill="#FFFFFF" />
      {matrix.map((row, r) =>
        row.map((filled, c) =>
          filled ? (
            <rect
              key={`${r}-${c}`}
              x={c + 1}
              y={r + 1}
              width={1}
              height={1}
              fill="#0F172A"
            />
          ) : null
        )
      )}
    </svg>
  );
};

interface InvoiceSuiteProps {
  shop: Shop;
  invoice: Invoice;
  products: Product[];
  customers: Customer[];
  prefs: InvoiceCustomizationPrefs;
  onUpdatePrefs: (next: InvoiceCustomizationPrefs) => void;
  isSamplePreview?: boolean;
  onPrint?: () => void;
}

const CATEGORY_TABS: Array<{ id: 'all' | InvoiceThemeArchetype; label: string; countBadge?: number }> = [
  { id: 'all', label: 'All Layouts (50+)' },
  { id: 'enterprise_gst', label: 'Enterprise GST & Tax' },
  { id: 'thermal_pos', label: 'Thermal POS (80 & 58mm)' },
  { id: 'wholesale_challan', label: 'B2B Wholesale Challan' },
  { id: 'minimalist', label: 'Modern & Minimalist' },
  { id: 'boutique_luxury', label: 'Boutique & Luxury' },
  { id: 'regional_vernacular', label: 'मराठी / हिंदी Regional' },
];

export const InvoiceSuite: React.FC<InvoiceSuiteProps> = ({
  shop,
  invoice,
  products,
  customers,
  prefs,
  onUpdatePrefs,
  isSamplePreview = false,
  onPrint,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Layout Catalog Navigation State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<'all' | InvoiceThemeArchetype>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8;

  const productCategoryMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of products) {
      map.set(p.id, p.category);
    }
    return map;
  }, [products]);

  const matchedCustomer = useMemo(() => {
    if (!invoice.customerId) return null;
    return customers.find((c) => c.id === invoice.customerId) ?? null;
  }, [customers, invoice.customerId]);

  const fullAddress = [shop.address, shop.city, shop.state, shop.pincode]
    .filter(Boolean)
    .join(', ');

  const gstSplit = useMemo(() => computeGstSplit(invoice.taxAmount), [invoice.taxAmount]);

  const upiUri = useMemo(
    () =>
      buildUpiPaymentUri({
        upiId: prefs.upiId || `${shop.name.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bhaviq'}@upi`,
        shopName: shop.name,
        amount: invoice.totalAmount,
        invoiceNumber: invoice.invoiceNumber,
      }),
    [prefs.upiId, shop.name, invoice.totalAmount, invoice.invoiceNumber]
  );

  const khataSummary = useMemo(() => {
    const creditAdded = invoice.creditAmount;
    if (matchedCustomer) {
      const closingBalance = isSamplePreview
        ? matchedCustomer.currentBalance + creditAdded
        : matchedCustomer.currentBalance;
      const previousBalance = Math.max(0, closingBalance - creditAdded);
      return { previousBalance, creditAdded, closingBalance };
    }
    return {
      previousBalance: 0,
      creditAdded,
      closingBalance: creditAdded,
    };
  }, [matchedCustomer, invoice.creditAmount, isSamplePreview]);

  // Filter 50+ templates dynamically
  const filteredLayouts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return INVOICE_LAYOUT_CATALOG.filter((layout) => {
      if (selectedCategory !== 'all' && layout.archetype !== selectedCategory) {
        return false;
      }
      if (!q) return true;
      return (
        layout.name.toLowerCase().includes(q) ||
        layout.tagline.toLowerCase().includes(q) ||
        layout.badge.toLowerCase().includes(q) ||
        layout.description.toLowerCase().includes(q)
      );
    });
  }, [searchQuery, selectedCategory]);

  const totalPages = Math.max(1, Math.ceil(filteredLayouts.length / itemsPerPage));
  const activePage = Math.min(currentPage, totalPages);
  const paginatedLayouts = useMemo(() => {
    const start = (activePage - 1) * itemsPerPage;
    return filteredLayouts.slice(start, start + itemsPerPage);
  }, [filteredLayouts, activePage, itemsPerPage]);

  const activeLayout = useMemo(() => {
    return (
      INVOICE_LAYOUT_CATALOG.find((l) => l.id === prefs.style) ||
      INVOICE_LAYOUT_CATALOG[0]
    );
  }, [prefs.style]);

  const handleLogoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onUpdatePrefs({
          ...prefs,
          showLogo: true,
          customLogoDataUrl: reader.result,
        });
      }
    };
    reader.readAsDataURL(file);
  };

  const renderBrandMark = (compact = false) => {
    if (!prefs.showLogo) return null;
    if (prefs.customLogoDataUrl) {
      return (
        <img
          src={prefs.customLogoDataUrl}
          alt={`${shop.name} logo`}
          className={`${compact ? 'h-8 max-w-[110px]' : 'h-10 max-w-[140px]'} object-contain rounded`}
        />
      );
    }
    return <BhaviqLogo variant="mark" size={compact ? 'sm' : 'md'} />;
  };

  const togglePref = (
    key: keyof Pick<
      InvoiceCustomizationPrefs,
      'showShopName' | 'showAddress' | 'showGstin' | 'showLogo'
    >
  ) => {
    onUpdatePrefs({ ...prefs, [key]: !prefs[key] });
  };

  const formattedDate = new Date(invoice.createdAt).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="space-y-5 pb-2">
      {/* Top 3D Floating Header & Action Bar */}
      <div className="print:hidden rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-4 shadow-xl shadow-slate-200/60 dark:shadow-black/40 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 text-white flex items-center justify-center shadow-md shadow-indigo-500/25">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                  Enterprise Billing Engine · 50+ Layout Studio
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200/60 dark:border-indigo-800">
                  Active: {activeLayout.name}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Switch effortlessly across Thermal rolls (80mm & 58mm), A4 GST Tax schedules, B2B Challans, and Vernacular formats.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {isSamplePreview && (
              <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/50 px-2.5 py-1 rounded-lg">
                Preview Specimen
              </span>
            )}
            <button
              type="button"
              onClick={onPrint ?? (() => window.print())}
              className="bhaviq-btn-primary px-4 py-2 min-h-[40px] rounded-xl text-xs font-bold inline-flex items-center gap-2 whitespace-nowrap shadow-md shadow-indigo-600/25"
            >
              <Printer className="w-4 h-4" />
              <span>Print / Save PDF</span>
            </button>
          </div>
        </div>

        {/* Category Tabs & Quick Search */}
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
            {CATEGORY_TABS.map((tab) => {
              const active = selectedCategory === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setSelectedCategory(tab.id);
                    setCurrentPage(1);
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                    active
                      ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 shadow-sm'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="relative min-w-[220px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Search 50+ layouts..."
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 pl-8 pr-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>
        </div>

        {/* 50+ Template Selector Grid with Pagination */}
        <div className="space-y-2 pt-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
            {paginatedLayouts.map((l) => {
              const isSelected = prefs.style === l.id;
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => onUpdatePrefs({ ...prefs, style: l.id })}
                  className={`text-left p-2.5 rounded-xl border transition-all flex flex-col justify-between gap-1 min-h-[72px] ${
                    isSelected
                      ? 'border-indigo-600 bg-indigo-50/80 dark:bg-indigo-950/40 shadow-sm ring-1 ring-indigo-500/30'
                      : 'border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1.5 w-full">
                    <span className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                      {l.name}
                    </span>
                    <span
                      className="px-1.5 py-0.5 rounded text-[9.5px] font-extrabold uppercase shrink-0"
                      style={{
                        backgroundColor: `${l.accentColor}18`,
                        color: l.accentColor,
                      }}
                    >
                      {l.badge}
                    </span>
                  </div>
                  <p className="text-[10.5px] text-slate-500 dark:text-slate-400 line-clamp-1 leading-snug">
                    {l.tagline}
                  </p>
                </button>
              );
            })}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-1 text-xs text-slate-500">
              <span>
                Showing {(activePage - 1) * itemsPerPage + 1}–{Math.min(activePage * itemsPerPage, filteredLayouts.length)} of {filteredLayouts.length} templates
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={activePage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40 text-xs font-semibold inline-flex items-center gap-1 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span>Prev</span>
                </button>
                <span className="font-mono-num text-xs px-2 font-bold text-slate-700 dark:text-slate-300">
                  {activePage} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={activePage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40 text-xs font-semibold inline-flex items-center gap-1 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <span>Next</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Main Split: Left 3D Floating Customization Sidebar, Right Live Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* 3D Floating Customization Controls Panel */}
        <div className="lg:col-span-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-4 space-y-4 shadow-xl shadow-slate-200/50 dark:shadow-black/40 print:hidden">
          <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-900 dark:text-slate-100">
                Invoice Customizer
              </h4>
            </div>
            <button
              type="button"
              onClick={() => onUpdatePrefs({ ...DEFAULT_INVOICE_PREFS })}
              className="text-[11px] font-semibold text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 inline-flex items-center gap-1"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset</span>
            </button>
          </div>

          {/* Visibility Toggles */}
          <div className="space-y-1.5">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              Display Fields
            </p>
            {(
              [
                { key: 'showShopName', label: 'Store Name' },
                { key: 'showAddress', label: 'Physical Store Address' },
                { key: 'showGstin', label: 'GSTIN Registration ID' },
                { key: 'showLogo', label: 'BhavIQ / Custom Logo Mark' },
              ] as const
            ).map((item) => (
              <label
                key={item.key}
                className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-800 text-xs font-medium text-slate-800 dark:text-slate-200 cursor-pointer hover:bg-slate-100/70"
              >
                <span>{item.label}</span>
                <input
                  type="checkbox"
                  checked={prefs[item.key]}
                  onChange={() => togglePref(item.key)}
                  className="h-4 w-4 rounded accent-indigo-600"
                />
              </label>
            ))}
          </div>

          {/* Logo Upload & Reset */}
          <div className="space-y-2 pt-1 border-t border-slate-100 dark:border-slate-800">
            <FieldLabel>Storefront Brand Logo</FieldLabel>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleLogoFileChange}
              className="hidden"
            />
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 text-xs font-semibold inline-flex items-center gap-1.5 shadow-xs"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>{prefs.customLogoDataUrl ? 'Replace Logo' : 'Upload Store Logo'}</span>
              </button>
              {prefs.customLogoDataUrl && (
                <button
                  type="button"
                  onClick={() => onUpdatePrefs({ ...prefs, customLogoDataUrl: null })}
                  className="px-2.5 py-2 rounded-xl border border-rose-200 text-rose-600 text-xs font-semibold inline-flex items-center gap-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Use BhavIQ</span>
                </button>
              )}
            </div>
          </div>

          {/* UPI ID for Dynamic QR Payment */}
          <div>
            <FieldLabel htmlFor="inv-upi-id">Instant UPI ID (Dynamic Bank QR)</FieldLabel>
            <TextInput
              id="inv-upi-id"
              value={prefs.upiId}
              onChange={(e) => onUpdatePrefs({ ...prefs, upiId: e.target.value })}
              placeholder="e.g. aryankirana@okicici"
              className="min-h-[38px] text-xs"
            />
          </div>

          {/* Custom Bank Account Transfer Details */}
          <div className="space-y-2">
            <FieldLabel>Bank Transfer Details (NEFT / RTGS / IMPS)</FieldLabel>
            <div className="space-y-1.5">
              <TextInput
                value={prefs.bankName}
                onChange={(e) => onUpdatePrefs({ ...prefs, bankName: e.target.value })}
                placeholder="Bank Name (e.g. State Bank of India)"
                className="min-h-[36px] text-xs"
              />
              <div className="grid grid-cols-2 gap-1.5">
                <TextInput
                  value={prefs.bankAccountNumber}
                  onChange={(e) =>
                    onUpdatePrefs({ ...prefs, bankAccountNumber: e.target.value })
                  }
                  placeholder="A/C Number"
                  className="min-h-[36px] text-xs font-mono-num"
                />
                <TextInput
                  value={prefs.bankIfscCode}
                  onChange={(e) =>
                    onUpdatePrefs({ ...prefs, bankIfscCode: e.target.value.toUpperCase() })
                  }
                  placeholder="IFSC Code"
                  className="min-h-[36px] text-xs font-mono-num uppercase"
                />
              </div>
            </div>
          </div>

          {/* Custom Terms & Signature */}
          <div>
            <FieldLabel htmlFor="inv-sig-note">Footer Terms & Declarations</FieldLabel>
            <textarea
              id="inv-sig-note"
              rows={2}
              value={prefs.signatureNote}
              onChange={(e) => onUpdatePrefs({ ...prefs, signatureNote: e.target.value })}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/25"
              placeholder="Return policy or compliance note..."
            />
          </div>

          {/* B2B Transport note */}
          <div>
            <FieldLabel htmlFor="inv-challan-note">Dispatch / Transporter Vehicle</FieldLabel>
            <TextInput
              id="inv-challan-note"
              value={prefs.challanTransportNote}
              onChange={(e) =>
                onUpdatePrefs({ ...prefs, challanTransportNote: e.target.value })
              }
              placeholder="e.g. Tempo MH-15-AB-2214"
              className="min-h-[38px] text-xs"
            />
          </div>

          <button
            type="button"
            onClick={onPrint ?? (() => window.print())}
            className="bhaviq-btn-primary w-full py-2.5 min-h-[42px] rounded-xl text-xs font-bold inline-flex items-center justify-center gap-2 whitespace-nowrap shadow-md shadow-indigo-600/30"
          >
            <Printer className="w-4 h-4" />
            <span>Print / Save PDF</span>
          </button>
        </div>

        {/* Live Rendered Invoice Sheet Canvas */}
        <div className="lg:col-span-8 rounded-2xl bg-slate-200/70 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 p-3 sm:p-6 overflow-x-auto shadow-inner">
          <div
            id="bhaviq-printable-invoice"
            data-print-style={
              activeLayout.paperSize === '80mm'
                ? 'thermal_80mm'
                : activeLayout.paperSize === '58mm'
                  ? 'thermal_58mm'
                  : 'a4_sheet'
            }
            className="text-slate-900"
          >
            {/* 1. THERMAL POS RENDERER (80mm & 58mm) */}
            {activeLayout.archetype === 'thermal_pos' || activeLayout.paperSize === '80mm' || activeLayout.paperSize === '58mm' ? (
              <div
                className={`mx-auto bg-white text-slate-900 p-3.5 sm:p-4 rounded-xl border border-slate-300 shadow-xl font-mono text-[11px] leading-relaxed ${
                  activeLayout.paperSize === '58mm' ? 'max-w-[240px]' : 'max-w-[320px]'
                }`}
              >
                <div className="text-center space-y-1 pb-2 border-b border-dashed border-slate-400">
                  {prefs.showLogo && (
                    <div className="flex justify-center pb-1">{renderBrandMark(true)}</div>
                  )}
                  {prefs.showShopName && (
                    <p className="text-sm font-black tracking-tight uppercase">
                      {shop.name}
                    </p>
                  )}
                  {prefs.showAddress && fullAddress && (
                    <p className="text-[9.5px] text-slate-600 leading-tight">{fullAddress}</p>
                  )}
                  {shop.phone && (
                    <p className="text-[9.5px] text-slate-600">Tel: {shop.phone}</p>
                  )}
                  {prefs.showGstin && (
                    <p className="text-[9.5px] font-bold text-slate-800">
                      GSTIN: {shop.gstin || 'UNREGISTERED'}
                    </p>
                  )}
                </div>

                <div className="py-1.5 border-b border-dashed border-slate-400 space-y-0.5 text-[9.5px]">
                  <div className="flex justify-between">
                    <span>BILL NO:</span>
                    <span className="font-bold">{invoice.invoiceNumber}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>DATE:</span>
                    <span>{formattedDate}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>PARTY:</span>
                    <span className="font-bold truncate max-w-[160px]">
                      {invoice.customerNameSnapshot || 'Walk-in Cash'}
                    </span>
                  </div>
                </div>

                <table className="w-full my-2 text-[10px]">
                  <thead>
                    <tr className="border-b border-dashed border-slate-400 text-left">
                      <th className="py-1 pr-2 font-bold">ITEM / QTY × RATE</th>
                      <th className="py-1 pl-2 text-right font-bold">AMT</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-dotted divide-slate-300">
                    {invoice.items.map((it) => (
                      <tr key={it.id}>
                        <td className="py-1.5 pr-2 align-top">
                          <p className="font-bold leading-tight text-slate-900">
                            {it.productNameSnapshot}
                          </p>
                          <p className="text-[9px] text-slate-600">
                            {it.quantity} {it.unitName} × ₹{it.unitSellingPrice.toFixed(2)}
                          </p>
                        </td>
                        <td className="py-1.5 pl-2 text-right font-bold whitespace-nowrap align-top">
                          ₹{it.lineTotal.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="pt-2 border-t border-dashed border-slate-400 space-y-1 text-[10.5px]">
                  <div className="flex justify-between">
                    <span>SUBTOTAL</span>
                    <span>{formatINR(invoice.subtotal)}</span>
                  </div>
                  {invoice.discountAmount > 0 && (
                    <div className="flex justify-between">
                      <span>DISCOUNT</span>
                      <span>-{formatINR(invoice.discountAmount)}</span>
                    </div>
                  )}
                  {invoice.taxAmount > 0 && (
                    <div className="flex justify-between">
                      <span>GST TOTAL</span>
                      <span>{formatINR(invoice.taxAmount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm font-black pt-1 border-t border-dashed border-slate-400">
                    <span>TOTAL</span>
                    <span>{formatINR(invoice.totalAmount)}</span>
                  </div>
                  <div className="flex justify-between text-[10px]">
                    <span>PAID ({invoice.paymentMode.toUpperCase()})</span>
                    <span>{formatINR(invoice.paidAmount)}</span>
                  </div>
                  {invoice.creditAmount > 0 && (
                    <div className="flex justify-between text-[10px] font-bold text-slate-900">
                      <span>KHATA DUE</span>
                      <span>{formatINR(invoice.creditAmount)}</span>
                    </div>
                  )}
                </div>

                {/* Instant UPI QR on Thermal */}
                <div className="my-2.5 pt-2 border-t border-dashed border-slate-400 flex flex-col items-center justify-center text-center">
                  <UpiQrCodeSvg payload={upiUri} sizePx={78} />
                  <p className="text-[9px] font-bold text-slate-800 mt-1">SCAN TO PAY VIA UPI</p>
                </div>

                <div className="pt-1.5 border-t border-dashed border-slate-400 text-center text-[9.5px] text-slate-600 space-y-0.5">
                  {prefs.signatureNote && <p>{prefs.signatureNote}</p>}
                  <p className="font-extrabold text-slate-900">{prefs.footerNote || 'THANK YOU · VISIT AGAIN'}</p>
                </div>
              </div>
            ) : activeLayout.archetype === 'wholesale_challan' ? (
              /* 2. WHOLESALE B2B DELIVERY CHALLAN RENDERER */
              <div
                className="bg-white text-slate-900 rounded-2xl border-2 shadow-2xl p-6 sm:p-8 space-y-5"
                style={{ borderColor: activeLayout.accentColor }}
              >
                <div
                  className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-4 border-b-2"
                  style={{ borderColor: activeLayout.accentColor }}
                >
                  <div className="flex items-start gap-3">
                    {renderBrandMark(false)}
                    <div>
                      <span
                        className="text-[10.5px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded"
                        style={{
                          backgroundColor: `${activeLayout.accentColor}18`,
                          color: activeLayout.accentColor,
                        }}
                      >
                        {activeLayout.name}
                      </span>
                      {prefs.showShopName && (
                        <h3 className="font-display text-xl font-black text-slate-900 mt-1">
                          {shop.name}
                        </h3>
                      )}
                      {prefs.showAddress && fullAddress && (
                        <p className="text-xs text-slate-600">{fullAddress}</p>
                      )}
                      {prefs.showGstin && shop.gstin && (
                        <p className="font-mono-num text-xs font-bold text-slate-800">
                          GSTIN: {shop.gstin}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="sm:text-right font-mono-num text-xs space-y-0.5">
                    <p className="font-black text-sm">CHALLAN #{invoice.invoiceNumber}</p>
                    <p className="text-slate-600">Date: {formattedDate}</p>
                    <p className="text-slate-800 font-bold">
                      Consignee: {invoice.customerNameSnapshot || 'Cash Trade Buyer'}
                    </p>
                  </div>
                </div>

                {/* Dispatch & Transport Banner */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                  <div>
                    <span className="text-slate-500 block">Dispatch Transporter & Notes</span>
                    <span className="font-bold text-slate-900">
                      {prefs.challanTransportNote || 'Standard Tempo Dispatch'}
                    </span>
                  </div>
                  <div className="sm:text-right">
                    <span className="text-slate-500 block">Total Goods Package Count</span>
                    <span className="font-mono-num font-bold text-slate-900">
                      {invoice.items.length} Line SKUs · {invoice.items.reduce((s, x) => s + x.quantity, 0)} Units/Packs
                    </span>
                  </div>
                </div>

                {/* Bulk Item Table with Pack Count + Weight/Quintal Metrics */}
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="border-b-2 border-slate-300 text-slate-700 text-left">
                        <th className="py-2.5 pr-2 font-bold">Commodity / SKU</th>
                        <th className="py-2.5 px-2 text-right font-bold">Pack Count</th>
                        <th className="py-2.5 px-2 text-right font-bold">Weight / Vol</th>
                        <th className="py-2.5 px-2 text-right font-bold">Trade Rate</th>
                        <th className="py-2.5 pl-2 text-right font-bold">Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {invoice.items.map((it) => {
                        const metrics = computeChallanUnitMetrics(it);
                        return (
                          <tr key={it.id}>
                            <td className="py-2.5 pr-2">
                              <p className="font-bold text-slate-900">{it.productNameSnapshot}</p>
                              {it.brandSnapshot && (
                                <p className="text-[11px] text-slate-500">{it.brandSnapshot}</p>
                              )}
                            </td>
                            <td className="py-2.5 px-2 text-right font-mono-num whitespace-nowrap">
                              {metrics.packCountLabel}
                            </td>
                            <td className="py-2.5 px-2 text-right font-mono-num font-semibold text-slate-700 whitespace-nowrap">
                              {metrics.weightEquivalentLabel}
                            </td>
                            <td className="py-2.5 px-2 text-right font-mono-num whitespace-nowrap">
                              {formatINR(it.unitSellingPrice)}
                            </td>
                            <td className="py-2.5 pl-2 text-right font-mono-num font-bold whitespace-nowrap">
                              {formatINR(it.lineTotal)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Khata Credit Ledger & Settlement */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-slate-200 text-xs">
                  <div className="p-3.5 rounded-xl bg-amber-50/80 border border-amber-200 space-y-1.5">
                    <p className="font-bold text-amber-950">Khata Credit Ledger Tracking</p>
                    <div className="flex justify-between text-slate-700">
                      <span>Previous Khata Balance</span>
                      <span className="font-mono-num">{formatINR(khataSummary.previousBalance)}</span>
                    </div>
                    <div className="flex justify-between text-slate-700">
                      <span>Credit Added (This Challan)</span>
                      <span className="font-mono-num">+{formatINR(khataSummary.creditAdded)}</span>
                    </div>
                    <div className="flex justify-between font-bold text-amber-950 pt-1 border-t border-amber-200">
                      <span>Closing Khata Balance Due</span>
                      <span className="font-mono-num">{formatINR(khataSummary.closingBalance)}</span>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                    <div className="flex justify-between text-slate-600">
                      <span>Challan Goods Value</span>
                      <span className="font-mono-num">{formatINR(invoice.subtotal)}</span>
                    </div>
                    {invoice.taxAmount > 0 && (
                      <div className="flex justify-between text-slate-600">
                        <span>Total GST</span>
                        <span className="font-mono-num">{formatINR(invoice.taxAmount)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm font-bold text-slate-900 pt-1 border-t border-slate-200">
                      <span>Total Payable</span>
                      <span className="font-mono-num">{formatINR(invoice.totalAmount)}</span>
                    </div>
                    <div className="flex justify-between text-emerald-700 font-semibold">
                      <span>Received ({invoice.paymentMode.toUpperCase()})</span>
                      <span className="font-mono-num">{formatINR(invoice.paidAmount)}</span>
                    </div>
                  </div>
                </div>

                {/* Receiver & Dispatcher Acknowledgement */}
                <div className="grid grid-cols-2 gap-6 pt-5 border-t border-slate-200 text-xs">
                  <div>
                    <div className="h-8 border-b border-slate-400 mb-1.5" />
                    <p className="font-semibold text-slate-700">Receiver Signature & Stamp</p>
                    <p className="text-[11px] text-slate-500">Received goods in full & good order</p>
                  </div>
                  <div className="text-right">
                    <div className="h-8 border-b border-slate-400 mb-1.5" />
                    <p className="font-semibold text-slate-700">
                      Dispatcher · {prefs.showShopName ? shop.name : 'Store Manager'}
                    </p>
                    <p className="text-[11px] text-slate-500">{prefs.signatureNote}</p>
                  </div>
                </div>
              </div>
            ) : activeLayout.archetype === 'regional_vernacular' ? (
              /* 3. REGIONAL VERNACULAR RENDERER (मराठी / हिंदी) */
              <div
                className="bg-white text-slate-900 rounded-2xl border-2 shadow-2xl p-6 sm:p-8 space-y-5"
                style={{ borderColor: activeLayout.accentColor }}
              >
                <div
                  className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-4 border-b-2"
                  style={{ borderColor: activeLayout.accentColor }}
                >
                  <div className="flex items-start gap-3">
                    {renderBrandMark(false)}
                    <div className="space-y-1">
                      <span
                        className="text-[11px] font-black uppercase tracking-wider px-2 py-0.5 rounded"
                        style={{
                          backgroundColor: `${activeLayout.accentColor}18`,
                          color: activeLayout.accentColor,
                        }}
                      >
                        {activeLayout.language === 'mr' ? 'अधिकृत कर बीजक' : 'अधिकृत कर बीजक'}
                      </span>
                      {prefs.showShopName && (
                        <h3 className="font-display text-xl font-bold text-slate-900">
                          {shop.name}
                        </h3>
                      )}
                      {prefs.showAddress && fullAddress && (
                        <p className="text-xs text-slate-600">{fullAddress}</p>
                      )}
                      {prefs.showGstin && (
                        <p className="font-mono-num text-xs font-bold text-slate-800">
                          {activeLayout.language === 'mr' ? 'जीएसटी क्रमांक (GSTIN):' : 'जीएसटी नंबर (GSTIN):'} {shop.gstin || 'लागू नाही'}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="sm:text-right space-y-0.5 text-xs">
                    <p className="font-bold text-slate-800">
                      {activeLayout.language === 'mr' ? 'बीजक क्रमांक:' : 'बीजक संख्या:'} {invoice.invoiceNumber}
                    </p>
                    <p className="text-slate-500">{formattedDate}</p>
                    <p className="font-semibold text-slate-800">
                      {activeLayout.language === 'mr' ? 'ग्राहक:' : 'क्रेता:'} {invoice.customerNameSnapshot || (activeLayout.language === 'mr' ? 'रोख ग्राहक' : 'नकद ग्राहक')}
                    </p>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="border-b-2 border-slate-200 text-slate-600 text-left">
                        <th className="py-2.5 pr-2 font-bold">क्र.</th>
                        <th className="py-2.5 pr-3 font-bold">{activeLayout.language === 'mr' ? 'वस्तूचा तपशील' : 'वस्तु का विवरण'}</th>
                        <th className="py-2.5 px-2 font-bold">HSN</th>
                        <th className="py-2.5 px-2 text-right font-bold">{activeLayout.language === 'mr' ? 'प्रमाण' : 'मात्रा'}</th>
                        <th className="py-2.5 px-2 text-right font-bold">{activeLayout.language === 'mr' ? 'दर' : 'दर'}</th>
                        <th className="py-2.5 pl-2 text-right font-bold">{activeLayout.language === 'mr' ? 'एकूण रक्कम' : 'कुल राशि'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {invoice.items.map((it, idx) => {
                        const hsn = inferHsnCode(it.productNameSnapshot, productCategoryMap.get(it.productId));
                        return (
                          <tr key={it.id}>
                            <td className="py-2.5 pr-2 font-mono-num text-slate-500">{idx + 1}</td>
                            <td className="py-2.5 pr-3 font-bold text-slate-900">{it.productNameSnapshot}</td>
                            <td className="py-2.5 px-2 font-mono-num text-slate-600">{hsn}</td>
                            <td className="py-2.5 px-2 text-right font-mono-num">{it.quantity} {it.unitName}</td>
                            <td className="py-2.5 px-2 text-right font-mono-num">{formatINR(it.unitSellingPrice)}</td>
                            <td className="py-2.5 pl-2 text-right font-mono-num font-bold">{formatINR(it.lineTotal)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-5 pt-4 border-t border-slate-200 items-end">
                  <div className="sm:col-span-6 flex items-center gap-3.5">
                    <UpiQrCodeSvg payload={upiUri} sizePx={88} />
                    <div className="text-xs space-y-1">
                      <p className="font-bold text-slate-900">{activeLayout.language === 'mr' ? 'UPI द्वारे त्वरित पेमेंट करा' : 'UPI द्वारा तुरंत भुगतान करें'}</p>
                      <p className="font-mono-num text-[11px] text-slate-600">{prefs.upiId || 'UPI ID'}</p>
                    </div>
                  </div>

                  <div className="sm:col-span-6 space-y-1.5 text-xs">
                    <div className="flex justify-between text-slate-600">
                      <span>{activeLayout.language === 'mr' ? 'करपात्र रक्कम' : 'कर योग्य राशि'}</span>
                      <span className="font-mono-num">{formatINR(invoice.subtotal)}</span>
                    </div>
                    {invoice.taxAmount > 0 && (
                      <div className="flex justify-between text-slate-600">
                        <span>GST ({formatINR(gstSplit.cgst)} + {formatINR(gstSplit.sgst)})</span>
                        <span className="font-mono-num">{formatINR(invoice.taxAmount)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-base font-black text-slate-900 pt-1.5 border-t border-slate-200">
                      <span>{activeLayout.language === 'mr' ? 'एकूण देय रक्कम' : 'कुल देय राशि'}</span>
                      <span className="font-mono-num">{formatINR(invoice.totalAmount)}</span>
                    </div>
                  </div>
                </div>

                <div className="flex justify-between items-end pt-5 border-t border-slate-200 text-xs">
                  <p className="text-slate-500 text-[11px]">{prefs.signatureNote}</p>
                  <div className="text-right">
                    <div className="w-36 border-b border-slate-400 mb-1 ml-auto" />
                    <p className="font-bold text-slate-800">{activeLayout.language === 'mr' ? 'अधिकृत सही' : 'अधिकृत हस्ताक्षर'}</p>
                  </div>
                </div>
              </div>
            ) : (
              /* 4. ENTERPRISE A4 & BOUTIQUE LUXURY RENDERER */
              <div
                className="bg-white text-slate-900 rounded-2xl border shadow-xl p-6 sm:p-8 space-y-6"
                style={{
                  borderColor:
                    activeLayout.archetype === 'boutique_luxury'
                      ? activeLayout.accentColor
                      : '#E2E8F0',
                }}
              >
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-5 border-b border-slate-200">
                  <div className="flex items-start gap-3.5">
                    {renderBrandMark(false)}
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        {prefs.showShopName && (
                          <h3 className="font-display text-xl font-bold text-slate-900 tracking-tight">
                            {shop.name}
                          </h3>
                        )}
                        <span
                          className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider"
                          style={{
                            backgroundColor: `${activeLayout.accentColor}18`,
                            color: activeLayout.accentColor,
                          }}
                        >
                          {activeLayout.badge}
                        </span>
                      </div>
                      {prefs.showAddress && fullAddress && (
                        <p className="text-xs text-slate-600 max-w-sm leading-relaxed">
                          {fullAddress}
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-600">
                        {shop.phone && <span>Phone: {shop.phone}</span>}
                        {prefs.showGstin && (
                          <span className="font-mono-num font-semibold text-slate-800">
                            GSTIN: {shop.gstin || 'Not Provided'}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="sm:text-right space-y-1 shrink-0">
                    <p
                      className="text-xs font-bold uppercase tracking-wider"
                      style={{ color: activeLayout.accentColor }}
                    >
                      {activeLayout.archetype === 'minimalist' ? 'Sales Receipt' : 'Tax Invoice'}
                    </p>
                    <p className="font-mono-num text-sm font-bold text-slate-900">
                      {invoice.invoiceNumber}
                    </p>
                    <p className="font-mono-num text-xs text-slate-500">{formattedDate}</p>
                  </div>
                </div>

                {/* Billed To & Compliance Details */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pb-4 border-b border-slate-200 text-xs">
                  <div className="space-y-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Billed To Customer
                    </p>
                    <p className="text-sm font-bold text-slate-900">
                      {invoice.customerNameSnapshot || 'Walk-in Cash Customer'}
                    </p>
                    {matchedCustomer?.phone && (
                      <p className="text-slate-600">Ph: {matchedCustomer.phone}</p>
                    )}
                    {matchedCustomer?.address && (
                      <p className="text-slate-600">{matchedCustomer.address}</p>
                    )}
                  </div>
                  <div className="sm:text-right space-y-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Payment & Tax Details
                    </p>
                    <p className="font-semibold text-slate-900 uppercase">
                      Payment Mode: {invoice.paymentMode}
                    </p>
                    <p className="text-slate-600">
                      {shop.taxMode === 'non_gst'
                        ? 'Composition / Non-GST Supply'
                        : shop.taxMode === 'gst_inclusive'
                          ? 'GST Inclusive Rates'
                          : 'GST Exclusive Supply'}
                    </p>
                  </div>
                </div>

                {/* Itemized Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="border-b-2 border-slate-200 text-slate-500 text-left">
                        <th className="py-2.5 pr-2 font-semibold">#</th>
                        <th className="py-2.5 pr-3 font-semibold">Item Description</th>
                        <th className="py-2.5 px-2 font-semibold">HSN</th>
                        <th className="py-2.5 px-2 text-right font-semibold">Qty</th>
                        <th className="py-2.5 px-2 text-right font-semibold">Rate</th>
                        <th className="py-2.5 px-2 text-right font-semibold">CGST</th>
                        <th className="py-2.5 px-2 text-right font-semibold">SGST</th>
                        <th className="py-2.5 pl-2 text-right font-semibold">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {invoice.items.map((it, idx) => {
                        const hsn = inferHsnCode(
                          it.productNameSnapshot,
                          productCategoryMap.get(it.productId)
                        );
                        const itemTax = computeGstSplit(it.taxAmount);
                        return (
                          <tr key={it.id}>
                            <td className="py-2.5 pr-2 font-mono-num text-slate-500">
                              {idx + 1}
                            </td>
                            <td className="py-2.5 pr-3">
                              <p className="font-semibold text-slate-900">
                                {it.productNameSnapshot}
                              </p>
                              {it.brandSnapshot && (
                                <p className="text-[11px] text-slate-500">{it.brandSnapshot}</p>
                              )}
                            </td>
                            <td className="py-2.5 px-2 font-mono-num text-slate-600">{hsn}</td>
                            <td className="py-2.5 px-2 text-right font-mono-num whitespace-nowrap">
                              {it.quantity} {it.unitName}
                            </td>
                            <td className="py-2.5 px-2 text-right font-mono-num whitespace-nowrap">
                              {formatINR(it.unitSellingPrice)}
                            </td>
                            <td className="py-2.5 px-2 text-right font-mono-num text-slate-600 whitespace-nowrap">
                              {formatINR(itemTax.cgst)}
                            </td>
                            <td className="py-2.5 px-2 text-right font-mono-num text-slate-600 whitespace-nowrap">
                              {formatINR(itemTax.sgst)}
                            </td>
                            <td className="py-2.5 pl-2 text-right font-mono-num font-bold text-slate-900 whitespace-nowrap">
                              {formatINR(it.lineTotal)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Bottom Matrix: Bank Transfer + UPI QR + Totals */}
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-5 pt-4 border-t border-slate-200 items-end">
                  <div className="sm:col-span-6 flex items-center gap-3.5">
                    <UpiQrCodeSvg payload={upiUri} sizePx={88} />
                    <div className="text-xs space-y-1 min-w-0 flex-1">
                      <p className="font-bold text-slate-900">Scan to Pay via UPI</p>
                      <p className="font-mono-num text-[11px] text-slate-600 break-all leading-snug">
                        {prefs.upiId.trim() || 'UPI ID Configurable'}
                      </p>
                      {prefs.bankName && (
                        <p className="text-[10px] text-slate-500">
                          {prefs.bankName} · A/C: {prefs.bankAccountNumber} · IFSC: {prefs.bankIfscCode}
                        </p>
                      )}
                      <p className="text-[11px] text-slate-500">
                        Total Amount: <span className="font-mono-num font-semibold text-slate-800">{formatINR(invoice.totalAmount)}</span>
                      </p>
                    </div>
                  </div>

                  <div className="sm:col-span-6 space-y-1.5 text-xs">
                    <div className="flex justify-between text-slate-600">
                      <span>Subtotal</span>
                      <span className="font-mono-num">{formatINR(invoice.subtotal)}</span>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>CGST + SGST Split</span>
                      <span className="font-mono-num">
                        {formatINR(gstSplit.cgst)} + {formatINR(gstSplit.sgst)}
                      </span>
                    </div>
                    {invoice.discountAmount > 0 && (
                      <div className="flex justify-between text-slate-600">
                        <span>Invoice Discount</span>
                        <span className="font-mono-num">-{formatINR(invoice.discountAmount)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-base font-bold text-slate-900 pt-1.5 border-t border-slate-200">
                      <span>Grand Total</span>
                      <span className="font-mono-num">{formatINR(invoice.totalAmount)}</span>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>Amount Paid</span>
                      <span className="font-mono-num">{formatINR(invoice.paidAmount)}</span>
                    </div>
                    {invoice.creditAmount > 0 && (
                      <div className="flex justify-between font-semibold text-amber-700">
                        <span>Khata Balance Due</span>
                        <span className="font-mono-num">{formatINR(invoice.creditAmount)}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Declaration & Signature Line */}
                <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pt-4 border-t border-slate-200 text-xs">
                  <div className="max-w-md space-y-1">
                    <p className="font-semibold text-slate-700">Declaration & Terms</p>
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      {prefs.signatureNote || 'Certified that the particulars given above are true and correct.'}
                    </p>
                  </div>
                  <div className="sm:text-right pt-4 sm:pt-0 shrink-0">
                    <div className="w-44 border-b border-slate-400 mb-1.5 sm:ml-auto" />
                    <p className="text-[11px] font-semibold text-slate-700">
                      Authorized Signatory · {prefs.showShopName ? shop.name : 'Store Owner'}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
