import React, { useEffect, useState } from 'react';
import {
  EmptyStateCard,
  FieldLabel,
  KpiCard,
  ResponsiveDialog,
  SelectInput,
  SurfaceCard,
  TextInput,
} from '../components/ui';
import { apiRequest } from '../lib/api';
import { formatINR } from '../lib/finance';
import type { AppLanguage } from '../lib/i18n';
import type { AuditLog, Customer, Expense, Invoice, Product, Shop, UserProfile } from '../lib/types';
import {
  BarChart3,
  Download,
  IndianRupee,
  Plus,
  ReceiptText,
  ShieldCheck,
  TrendingUp,
  Truck,
  Wallet,
  Smartphone,
  QrCode,
  Unlink,
  Radio,
  Printer,
  FileText,
  Database,
  Volume2,
  VolumeX,
  Vibrate,
  CheckCircle2,
  HardDrive,
  FileSpreadsheet,
  Check,
  Sparkles,
} from 'lucide-react';
import { DevicePairingModal } from '../components/DevicePairingModal';
import {
  getSavedPairedDeviceInfo,
  savePairedDeviceInfo,
  deviceBridge,
  getScannerFeedbackPrefs,
  saveScannerFeedbackPrefs,
  playRetailScannerBeep,
  triggerScannerHaptic,
  type PairedDeviceInfo,
  type ScannerFeedbackPrefs,
} from '../lib/deviceBridge';
import {
  loadInvoicePrefs,
  saveInvoicePrefs,
  type InvoiceCustomizationPrefs,
} from '../lib/invoiceTemplates';

interface ReportResponse {
  range: { fromDate: string; toDate: string };
  summary: {
    billsCount: number;
    totalSales: number;
    totalTax: number;
    totalCreditIssued: number;
    totalPurchases: number;
    totalExpenses: number;
    grossProfit: number | null;
    operatingSurplusBeforeTax: number | null;
  };
  productPerformance: Array<{
    productId: string;
    name: string;
    qtySold: number;
    revenue: number;
    costSum: number;
    costKnown: boolean;
  }>;
  categoryPerformance: Array<{
    category: string;
    revenue: number;
    itemsSold: number;
  }>;
  paymentReconciliation: Array<{ mode: string; total: number }>;
}

export const ReportsPage: React.FC<{ shop: Shop; isMobile: boolean }> = ({
  shop,
  isMobile,
}) => {
  const [fromDate, setFromDate] = useState(
    new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10)
  );
  const [toDate, setToDate] = useState(new Date().toISOString().slice(0, 10));
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const loadReport = async (from = fromDate, to = toDate) => {
    setLoading(true);
    try {
      const res = await apiRequest<ReportResponse>(
        `/api/shops/${shop.id}/reports?from=${from}&to=${to}`
      );
      setReport(res);
    } catch {
      setReport(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadReport();
  }, [shop.id]);

  const exportCsv = () => {
    if (!report) return;
    const rows = [
      ['Product', 'Qty Sold', 'Revenue (INR)', 'Cost (INR)'],
      ...report.productPerformance.map((p) => [
        p.name.replace(/,/g, ' '),
        String(p.qtySold),
        p.revenue.toFixed(2),
        p.costKnown ? p.costSum.toFixed(2) : 'Incomplete',
      ]),
    ];
    const csv = rows.map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bhaviq-report-${fromDate}-to-${toDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5 bhaviq-page-enter">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-2.5">
          <div>
            <FieldLabel htmlFor="rep-from">From</FieldLabel>
            <TextInput
              id="rep-from"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </div>
          <div>
            <FieldLabel htmlFor="rep-to">To</FieldLabel>
            <TextInput
              id="rep-to"
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </div>
          <button
            type="button"
            onClick={() => loadReport(fromDate, toDate)}
            className="bhaviq-btn-primary px-4 py-2.5 min-h-[42px] rounded-xl text-xs font-semibold whitespace-nowrap"
          >
            Apply range
          </button>
        </div>
        <button
          type="button"
          onClick={exportCsv}
          disabled={!report || report.productPerformance.length === 0}
          className="px-4 py-2.5 min-h-[42px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-40 self-start sm:self-auto"
        >
          <Download className="w-4 h-4" />
          <span>Export CSV</span>
        </button>
      </div>

      {loading ? (
        <div className="h-40 rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-hairline)] animate-pulse" />
      ) : !report || (report.summary.billsCount === 0 && report.summary.totalPurchases === 0 && report.summary.totalExpenses === 0) ? (
        <EmptyStateCard
          icon={<BarChart3 className="w-6 h-6" />}
          title="Not enough recorded data."
          description="Sales, gross profit, category performance, and payment reconciliation reports will populate automatically as you record bills, purchases, and expenses."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 md:gap-4">
            <KpiCard
              label="Total billed sales"
              value={formatINR(report.summary.totalSales)}
              subtext={`${report.summary.billsCount} completed bills`}
              accentTop="indigo"
              icon={<IndianRupee className="w-4 h-4" />}
            />
            <KpiCard
              label="Gross profit"
              value={
                report.summary.grossProfit !== null
                  ? formatINR(report.summary.grossProfit)
                  : 'Not enough data'
              }
              tone={
                report.summary.grossProfit !== null
                  ? report.summary.grossProfit >= 0
                    ? 'positive'
                    : 'danger'
                  : 'neutral'
              }
              accentTop={
                report.summary.grossProfit !== null
                  ? report.summary.grossProfit >= 0
                    ? 'emerald'
                    : 'rose'
                  : 'slate'
              }
              icon={<TrendingUp className="w-4 h-4" />}
              subtext={
                report.summary.grossProfit !== null
                  ? 'Excl. tax minus landed cost'
                  : 'Not enough recorded data.'
              }
            />
            <KpiCard
              label="Total purchases"
              value={formatINR(report.summary.totalPurchases)}
              subtext="Includes freight & transport"
              accentTop="slate"
              icon={<Truck className="w-4 h-4" />}
            />
            <KpiCard
              label="Recorded expenses"
              value={formatINR(report.summary.totalExpenses)}
              accentTop="amber"
              icon={<Wallet className="w-4 h-4" />}
              subtext={
                report.summary.operatingSurplusBeforeTax !== null
                  ? `Gross profit - expenses: ${formatINR(report.summary.operatingSurplusBeforeTax)}`
                  : 'Net profit requires complete cost & expense logs'
              }
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <SurfaceCard className="lg:col-span-7 p-5">
              <h3 className="font-display text-base font-semibold mb-3">
                Product-wise Performance
              </h3>
              {report.productPerformance.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)]">No product sales in this period.</p>
              ) : isMobile ? (
                <div className="space-y-2.5">
                  {report.productPerformance.map((p) => (
                    <div
                      key={p.productId}
                      className="p-3 rounded-xl border border-[var(--border-hairline)] flex justify-between items-center text-xs"
                    >
                      <div>
                        <p className="font-semibold">{p.name}</p>
                        <p className="text-[var(--text-muted)] font-mono-num">Qty: {p.qtySold}</p>
                      </div>
                      <span className="font-mono-num font-bold">{formatINR(p.revenue)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border-hairline)] text-xs text-[var(--text-muted)]">
                      <th className="py-2 font-medium">Product</th>
                      <th className="py-2 font-medium text-right">Base qty sold</th>
                      <th className="py-2 font-medium text-right">Revenue</th>
                      <th className="py-2 font-medium text-right">Recorded cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-hairline)]">
                    {report.productPerformance.map((p) => (
                      <tr key={p.productId}>
                        <td className="py-2.5 font-medium">{p.name}</td>
                        <td className="py-2.5 font-mono-num text-right">{p.qtySold}</td>
                        <td className="py-2.5 font-mono-num text-right font-semibold">
                          {formatINR(p.revenue)}
                        </td>
                        <td className="py-2.5 font-mono-num text-right text-xs text-[var(--text-secondary)]">
                          {p.costKnown ? formatINR(p.costSum) : 'Incomplete'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </SurfaceCard>

            <SurfaceCard className="lg:col-span-5 p-5 space-y-5">
              <div>
                <h3 className="font-display text-base font-semibold mb-2">
                  Category Performance
                </h3>
                {report.categoryPerformance.length === 0 ? (
                  <p className="text-xs text-[var(--text-muted)]">No category sales recorded.</p>
                ) : (
                  <div className="space-y-2">
                    {report.categoryPerformance.map((c) => (
                      <div key={c.category} className="flex justify-between text-xs py-1.5 border-b border-[var(--border-hairline)]">
                        <span>{c.category}</span>
                        <span className="font-mono-num font-semibold">{formatINR(c.revenue)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h3 className="font-display text-base font-semibold mb-2">
                  Payment Reconciliation
                </h3>
                {report.paymentReconciliation.length === 0 ? (
                  <p className="text-xs text-[var(--text-muted)]">No payments collected in range.</p>
                ) : (
                  <div className="space-y-2">
                    {report.paymentReconciliation.map((p) => (
                      <div key={p.mode} className="flex justify-between text-xs py-1.5 border-b border-[var(--border-hairline)]">
                        <span className="uppercase font-medium">{p.mode}</span>
                        <span className="font-mono-num font-semibold">{formatINR(p.total)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </SurfaceCard>
          </div>
        </>
      )}
    </div>
  );
};

export const ExpensesPage: React.FC<{
  shop: Shop;
  expenses: Expense[];
  onRefreshAll: () => Promise<void>;
}> = ({ shop, expenses, onRefreshAll }) => {
  const [addOpen, setAddOpen] = useState(false);
  const [category, setCategory] = useState('Shop Rent');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [paymentMode, setPaymentMode] = useState('cash');
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiRequest(`/api/shops/${shop.id}/expenses`, {
        method: 'POST',
        body: JSON.stringify({
          category,
          description,
          amount: Number(amount),
          paymentMode,
          expenseDate,
        }),
      });
      setAddOpen(false);
      setDescription('');
      setAmount('');
      await onRefreshAll();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5 bhaviq-page-enter">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold">Operating Expenses</h2>
          <p className="text-xs text-[var(--text-secondary)]">
            Track rent, electricity, staff wages, packaging, and local transport.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="bhaviq-btn-primary px-4 py-2.5 min-h-[42px] rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
        >
          <Plus className="w-4 h-4" />
          <span>Add expense</span>
        </button>
      </div>

      {expenses.length === 0 ? (
        <EmptyStateCard
          icon={<ReceiptText className="w-6 h-6" />}
          title="No expenses recorded yet"
          description="Log operating costs like electricity, shop rent, and staff wages so your profit reports stay accurate."
          actionLabel="Record first expense"
          onAction={() => setAddOpen(true)}
        />
      ) : (
        <SurfaceCard className="overflow-hidden">
          <div className="divide-y divide-[var(--border-hairline)]">
            {expenses.map((ex) => (
              <div key={ex.id} className="p-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">{ex.description}</p>
                  <p className="text-xs text-[var(--text-muted)]">
                    {ex.category} · {ex.paymentMode.toUpperCase()} · {ex.expenseDate}
                  </p>
                </div>
                <span className="font-mono-num text-sm font-semibold text-red-700 dark:text-red-400">
                  {formatINR(ex.amount)}
                </span>
              </div>
            ))}
          </div>
        </SurfaceCard>
      )}

      <ResponsiveDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Record shop expense"
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <FieldLabel htmlFor="exp-cat" required>
                Category
              </FieldLabel>
              <SelectInput
                id="exp-cat"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="Shop Rent">Shop Rent</option>
                <option value="Electricity & Utilities">Electricity & Utilities</option>
                <option value="Staff Salary">Staff Salary</option>
                <option value="Packaging & Bags">Packaging & Bags</option>
                <option value="Transport & Delivery">Transport & Delivery</option>
                <option value="Maintenance">Maintenance</option>
                <option value="Other">Other</option>
              </SelectInput>
            </div>
            <div>
              <FieldLabel htmlFor="exp-date" required>
                Date
              </FieldLabel>
              <TextInput
                id="exp-date"
                type="date"
                required
                value={expenseDate}
                onChange={(e) => setExpenseDate(e.target.value)}
              />
            </div>
          </div>
          <div>
            <FieldLabel htmlFor="exp-desc" required>
              Description
            </FieldLabel>
            <TextInput
              id="exp-desc"
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Monthly shop electricity bill"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel htmlFor="exp-amt" required>
                Amount (₹)
              </FieldLabel>
              <TextInput
                id="exp-amt"
                type="number"
                min="0.01"
                step="0.01"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div>
              <FieldLabel htmlFor="exp-mode">Payment mode</FieldLabel>
              <SelectInput
                id="exp-mode"
                value={paymentMode}
                onChange={(e) => setPaymentMode(e.target.value)}
              >
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
                <option value="bank">Bank</option>
              </SelectInput>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setAddOpen(false)}
              className="px-4 py-2.5 min-h-[42px] rounded-xl border border-[var(--border-hairline)] text-xs font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="bhaviq-btn-primary px-5 py-2.5 min-h-[42px] rounded-xl text-xs font-semibold whitespace-nowrap disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save expense'}
            </button>
          </div>
        </form>
      </ResponsiveDialog>
    </div>
  );
};

function exportCsv(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const escapeCell = (val: string | number | null | undefined) => {
    if (val === null || val === undefined) return '""';
    const s = String(val).replace(/"/g, '""');
    return `"${s}"`;
  };
  const csvContent = [
    headers.map(escapeCell).join(','),
    ...rows.map((row) => row.map(escapeCell).join(',')),
  ].join('\r\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportJson(filename: string, data: unknown) {
  const jsonContent = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const SettingsPage: React.FC<{
  shop: Shop;
  user: UserProfile;
  theme: 'light' | 'dark';
  language: AppLanguage;
  onToggleTheme: () => void;
  onChangeLanguage: (lang: AppLanguage) => void;
  onRefreshAll: () => Promise<void>;
  products?: Product[];
  invoices?: Invoice[];
  customers?: Customer[];
}> = ({
  shop,
  user,
  theme,
  language,
  onToggleTheme,
  onChangeLanguage,
  onRefreshAll,
  products = [],
  invoices = [],
  customers = [],
}) => {
  const [name, setName] = useState(shop.name);
  const [city, setCity] = useState(shop.city);
  const [defaultMargin, setDefaultMargin] = useState(String(shop.defaultMarginPct));
  const [taxMode, setTaxMode] = useState(shop.taxMode);
  const [gstin, setGstin] = useState(shop.gstin || '');
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [staffEmail, setStaffEmail] = useState('');
  const [staffName, setStaffName] = useState('');
  const [staffPassword, setStaffPassword] = useState('');
  const [staffMsg, setStaffMsg] = useState<string | null>(null);
  const [pairedDevice, setPairedDevice] = useState<PairedDeviceInfo | null>(getSavedPairedDeviceInfo());
  const [pairingModalOpen, setPairingModalOpen] = useState(false);

  // 1. Receipt & Thermal Printer Configuration State
  const [printerPrefs, setPrinterPrefs] = useState<InvoiceCustomizationPrefs>(() =>
    loadInvoicePrefs(shop.id)
  );
  const [printerSaveMsg, setPrinterSaveMsg] = useState<string | null>(null);

  // 2. Scanner Feedback Preferences State
  const [scannerFeedback, setScannerFeedback] = useState<ScannerFeedbackPrefs>(() =>
    getScannerFeedbackPrefs()
  );
  const [scannerTestStatus, setScannerTestStatus] = useState<string | null>(null);

  // 3. Store Data for Backup & Export
  const [storeProducts, setStoreProducts] = useState<Product[]>(products);
  const [storeInvoices, setStoreInvoices] = useState<Invoice[]>(invoices);
  const [storeCustomers, setStoreCustomers] = useState<Customer[]>(customers);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<{ logs: AuditLog[] }>(`/api/shops/${shop.id}/audit-logs`)
      .then((res) => setAuditLogs(res.logs))
      .catch(() => setAuditLogs([]));

    // Fallback fetch if parent did not pass records
    if (!products || products.length === 0) {
      apiRequest<{ products: Product[] }>(`/api/shops/${shop.id}/products`)
        .then((res) => setStoreProducts(res.products || []))
        .catch(() => {});
    } else {
      setStoreProducts(products);
    }

    if (!invoices || invoices.length === 0) {
      apiRequest<{ invoices: Invoice[] }>(`/api/shops/${shop.id}/invoices`)
        .then((res) => setStoreInvoices(res.invoices || []))
        .catch(() => {});
    } else {
      setStoreInvoices(invoices);
    }

    if (!customers || customers.length === 0) {
      apiRequest<{ customers: Customer[] }>(`/api/shops/${shop.id}/customers`)
        .then((res) => setStoreCustomers(res.customers || []))
        .catch(() => {});
    } else {
      setStoreCustomers(customers);
    }
  }, [shop.id, products, invoices, customers]);

  const handleSaveShop = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveMsg(null);
    await apiRequest(`/api/shops/${shop.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name,
        city,
        defaultMarginPct: Number(defaultMargin) || 15,
        taxMode,
        gstin: gstin || null,
      }),
    });
    setSaveMsg('Shop configuration updated.');
    await onRefreshAll();
  };

  const handleSavePrinter = (e: React.FormEvent) => {
    e.preventDefault();
    saveInvoicePrefs(shop.id, printerPrefs);
    setPrinterSaveMsg('Receipt & thermal printer preferences saved.');
    setTimeout(() => setPrinterSaveMsg(null), 3000);
  };

  const handleToggleSound = () => {
    const next = { ...scannerFeedback, enableSound: !scannerFeedback.enableSound };
    setScannerFeedback(next);
    saveScannerFeedbackPrefs(next);
  };

  const handleToggleHaptic = () => {
    const next = { ...scannerFeedback, enableHaptic: !scannerFeedback.enableHaptic };
    setScannerFeedback(next);
    saveScannerFeedbackPrefs(next);
  };

  const handleTestBeep = () => {
    playRetailScannerBeep(1850, 75, true);
    setScannerTestStatus('Confirmation beep played ✓');
    setTimeout(() => setScannerTestStatus(null), 2500);
  };

  const handleTestHaptic = () => {
    triggerScannerHaptic([60, 30, 60], true);
    setScannerTestStatus('Haptic pulse sent ✓');
    setTimeout(() => setScannerTestStatus(null), 2500);
  };

  const handleUnlinkDevice = async () => {
    await deviceBridge.send('DEVICE_UNLINK', 'desktop');
    setPairedDevice(null);
    savePairedDeviceInfo(null);
  };

  // CSV & JSON Exporters
  const getTimestamp = () => new Date().toISOString().slice(0, 10);

  const handleExportInventoryCsv = () => {
    const headers = [
      'Product ID',
      'Name',
      'Brand',
      'Category',
      'Barcode',
      'SKU',
      'Base Unit',
      'Pack Size',
      'Purchase Price',
      'Selling Price',
      'MRP',
      'Current Stock',
      'Min Stock Level',
      'Expiry Date',
    ];
    const rows = storeProducts.map((p) => [
      p.id,
      p.name,
      p.brand || '',
      p.category,
      p.barcode || '',
      p.sku,
      p.baseUnit,
      p.packSize || '',
      p.purchasePrice,
      p.sellingPrice,
      p.mrp ?? '',
      p.currentStock,
      p.minStockLevel,
      p.expiryDate || '',
    ]);
    exportCsv(`bhaviq_inventory_${shop.name.toLowerCase().replace(/\s+/g, '_')}_${getTimestamp()}.csv`, headers, rows);
    setExportNotice(`Exported ${storeProducts.length} inventory products to CSV.`);
    setTimeout(() => setExportNotice(null), 3500);
  };

  const handleExportInventoryJson = () => {
    exportJson(`bhaviq_inventory_${shop.name.toLowerCase().replace(/\s+/g, '_')}_${getTimestamp()}.json`, storeProducts);
    setExportNotice(`Exported ${storeProducts.length} inventory products to JSON.`);
    setTimeout(() => setExportNotice(null), 3500);
  };

  const handleExportSalesCsv = () => {
    const headers = [
      'Invoice Number',
      'Date',
      'Customer Name',
      'Payment Mode',
      'Total Amount',
      'Tax Amount',
      'Paid Amount',
      'Credit Due',
      'Items Count',
    ];
    const rows = storeInvoices.map((inv) => [
      inv.invoiceNumber,
      new Date(inv.createdAt).toLocaleDateString('en-IN'),
      inv.customerNameSnapshot || 'Cash Customer',
      inv.paymentMode.toUpperCase(),
      inv.totalAmount,
      inv.taxAmount,
      inv.paidAmount,
      inv.creditAmount,
      inv.items?.length || 0,
    ]);
    exportCsv(`bhaviq_sales_${shop.name.toLowerCase().replace(/\s+/g, '_')}_${getTimestamp()}.csv`, headers, rows);
    setExportNotice(`Exported ${storeInvoices.length} sales invoices to CSV.`);
    setTimeout(() => setExportNotice(null), 3500);
  };

  const handleExportSalesJson = () => {
    exportJson(`bhaviq_sales_${shop.name.toLowerCase().replace(/\s+/g, '_')}_${getTimestamp()}.json`, storeInvoices);
    setExportNotice(`Exported ${storeInvoices.length} sales invoices to JSON.`);
    setTimeout(() => setExportNotice(null), 3500);
  };

  const handleExportKhataCsv = () => {
    const headers = ['Customer ID', 'Customer Name', 'Phone', 'Credit Balance', 'Credit Limit', 'Registered Date'];
    const rows = storeCustomers.map((c) => [
      c.id,
      c.name,
      c.phone,
      c.currentBalance,
      c.creditLimit,
      new Date(c.createdAt).toLocaleDateString('en-IN'),
    ]);
    exportCsv(`bhaviq_khata_${shop.name.toLowerCase().replace(/\s+/g, '_')}_${getTimestamp()}.csv`, headers, rows);
    setExportNotice(`Exported ${storeCustomers.length} Khata customer records to CSV.`);
    setTimeout(() => setExportNotice(null), 3500);
  };

  const handleExportKhataJson = () => {
    exportJson(`bhaviq_khata_${shop.name.toLowerCase().replace(/\s+/g, '_')}_${getTimestamp()}.json`, storeCustomers);
    setExportNotice(`Exported ${storeCustomers.length} Khata customer records to JSON.`);
    setTimeout(() => setExportNotice(null), 3500);
  };

  const handleExportFullBackup = () => {
    const backupData = {
      shopId: shop.id,
      shopName: shop.name,
      city: shop.city,
      gstin: shop.gstin,
      taxMode: shop.taxMode,
      defaultMarginPct: shop.defaultMarginPct,
      backupCreatedAt: new Date().toISOString(),
      bhaviqVersion: '2.0.0-enterprise',
      counts: {
        products: storeProducts.length,
        invoices: storeInvoices.length,
        customers: storeCustomers.length,
      },
      products: storeProducts,
      invoices: storeInvoices,
      customers: storeCustomers,
      printerPreferences: printerPrefs,
      scannerFeedbackPreferences: scannerFeedback,
    };
    exportJson(`bhaviq_complete_backup_${shop.id}_${getTimestamp()}.json`, backupData);
    setExportNotice('Complete store database & configuration backup downloaded.');
    setTimeout(() => setExportNotice(null), 4000);
  };

  const handleAddStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    setStaffMsg(null);
    try {
      await apiRequest(`/api/shops/${shop.id}/members`, {
        method: 'POST',
        body: JSON.stringify({
          email: staffEmail,
          fullName: staffName,
          password: staffPassword,
        }),
      });
      setStaffEmail('');
      setStaffName('');
      setStaffPassword('');
      setStaffMsg('Staff member added with restricted billing & stock permissions.');
    } catch (err) {
      setStaffMsg(err instanceof Error ? err.message : 'Unable to add staff');
    }
  };

  return (
    <div className="space-y-6 bhaviq-page-enter">
      {/* Global Export Notice Toast */}
      {exportNotice && (
        <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-800 dark:text-emerald-300 text-xs font-semibold flex items-center justify-between shadow-sm animate-fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>{exportNotice}</span>
          </div>
          <span className="text-[10px] uppercase font-bold text-emerald-600 dark:text-emerald-400">Downloaded</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Card 1: Active Device & Scanner Bridge Management (Full Width) */}
        <SurfaceCard className="lg:col-span-12 p-6 space-y-4 bg-gradient-to-br from-white to-slate-50/70 dark:from-slate-900 dark:to-slate-800/80 border border-slate-200/90 dark:border-slate-700/80 shadow-xl shadow-slate-200/60 dark:shadow-black/40">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 border border-indigo-200/70 dark:border-indigo-800/70 flex items-center justify-center shrink-0 shadow-sm">
                <Smartphone className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
                    Device Management &amp; Mobile Barcode Bridge
                  </h3>
                  <span className="px-2.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 text-[10px] font-bold text-blue-700 dark:text-blue-300 uppercase tracking-wider">
                    Supabase Realtime
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 max-w-2xl leading-relaxed">
                  Inspect paired wireless barcode scanners, manage cryptographic channel handshakes, and configure sensory audio/haptic confirmation feedback.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={() => setPairingModalOpen(true)}
                className="bhaviq-btn-primary px-4 py-2.5 min-h-[42px] rounded-xl text-xs font-bold inline-flex items-center gap-2 shadow-md shadow-indigo-600/25 whitespace-nowrap"
              >
                <QrCode className="w-4 h-4" />
                <span>{pairedDevice ? 'Pair New / Switch Device' : 'Link Mobile via QR'}</span>
              </button>
            </div>
          </div>

          {/* Active Paired Device Details */}
          <div className="mt-2 pt-4 border-t border-slate-100 dark:border-slate-800 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-slate-50/80 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/60 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] uppercase font-bold text-slate-500 dark:text-slate-400">
                  Active Linked Terminal
                </span>
                {pairedDevice ? (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/50 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold inline-flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                    <span>🟢 Connected &amp; Active</span>
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400 text-[10px] font-semibold">
                    No Phone Linked
                  </span>
                )}
              </div>

              {pairedDevice ? (
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Hardware Model:</span>
                    <strong className="text-slate-900 dark:text-white font-semibold">{pairedDevice.deviceName}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Platform:</span>
                    <span className="text-slate-700 dark:text-slate-300 font-medium">{pairedDevice.platform}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Channel Token:</span>
                    <span className="font-mono text-[11px] text-indigo-600 dark:text-indigo-400 font-bold truncate max-w-[180px]">
                      {pairedDevice.token || 'bhv_pair_synced'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Paired At:</span>
                    <span className="text-slate-600 dark:text-slate-400">
                      {new Date(pairedDevice.pairedAt).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
                    </span>
                  </div>

                  <div className="pt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={handleUnlinkDevice}
                      className="px-3 py-1.5 rounded-lg border border-rose-200 dark:border-rose-800/80 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 dark:text-rose-400 text-xs font-semibold inline-flex items-center gap-1.5 transition"
                    >
                      <Unlink className="w-3.5 h-3.5" />
                      <span>Unlink Device</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPairingModalOpen(true)}
                      className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                    >
                      Show QR
                    </button>
                  </div>
                </div>
              ) : (
                <div className="py-2 text-xs text-slate-500 dark:text-slate-400 space-y-2">
                  <p>
                    Link any Android or iOS smartphone to this store terminal. The phone&apos;s camera functions as a 1D/2D wireless optical scanner with sub-50ms sync.
                  </p>
                  <button
                    type="button"
                    onClick={() => setPairingModalOpen(true)}
                    className="px-3 py-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 text-xs font-bold inline-flex items-center gap-1.5"
                  >
                    <QrCode className="w-3.5 h-3.5" />
                    <span>Generate Handshake QR Code</span>
                  </button>
                </div>
              )}
            </div>

            {/* Scanner Feedback Preferences */}
            <div className="p-4 rounded-xl bg-slate-50/80 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/60 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] uppercase font-bold text-slate-500 dark:text-slate-400">
                  Scanner Feedback Controls
                </span>
                {scannerTestStatus && (
                  <span className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 animate-fade-in">
                    {scannerTestStatus}
                  </span>
                )}
              </div>

              <div className="space-y-2.5 text-xs">
                {/* Audio Beep Switch */}
                <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-700/80 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 shrink-0">
                      {scannerFeedback.enableSound ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4 text-slate-400" />}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900 dark:text-white">Confirmation Beep Tone</p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">1850Hz POS scan confirmation audio</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={handleTestBeep}
                      className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-indigo-600 text-[11px] font-semibold"
                    >
                      Test Beep
                    </button>
                    <button
                      type="button"
                      onClick={handleToggleSound}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        scannerFeedback.enableSound ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-700'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          scannerFeedback.enableSound ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                </div>

                {/* Haptic Vibration Switch */}
                <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-700/80 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 shrink-0">
                      <Vibrate className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900 dark:text-white">Mobile Haptic Vibration</p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">40ms physical vibration pulse on phone</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={handleTestHaptic}
                      className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-emerald-600 text-[11px] font-semibold"
                    >
                      Test Pulse
                    </button>
                    <button
                      type="button"
                      onClick={handleToggleHaptic}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        scannerFeedback.enableHaptic ? 'bg-emerald-600' : 'bg-slate-300 dark:bg-slate-700'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          scannerFeedback.enableHaptic ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </SurfaceCard>

        {/* Card 2: Receipt & Thermal Printer Configuration (col-span-6) */}
        <SurfaceCard className="lg:col-span-6 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-sky-50 dark:bg-sky-950/50 text-sky-600 dark:text-sky-400 border border-sky-200 dark:border-sky-800">
                <Printer className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
                  Receipt &amp; Thermal Printer
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Paper width, invoice numbering, and storefront receipt messaging
                </p>
              </div>
            </div>
          </div>

          <form onSubmit={handleSavePrinter} className="space-y-3.5">
            {/* Paper Width Selection */}
            <div>
              <FieldLabel>Thermal Receipt Paper Width</FieldLabel>
              <div className="grid grid-cols-2 gap-2 mt-1">
                <button
                  type="button"
                  onClick={() => setPrinterPrefs({ ...printerPrefs, receiptPaperWidth: '80mm' })}
                  className={`p-3 rounded-xl border text-left transition flex items-center justify-between ${
                    (printerPrefs.receiptPaperWidth || '80mm') === '80mm'
                      ? 'border-indigo-600 bg-indigo-50/70 dark:bg-indigo-950/40 text-indigo-950 dark:text-indigo-200 ring-1 ring-indigo-500'
                      : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <div>
                    <p className="font-bold text-xs">80mm (3-Inch Standard)</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">Desktop USB / LAN POS roll</p>
                  </div>
                  {(printerPrefs.receiptPaperWidth || '80mm') === '80mm' && (
                    <Check className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setPrinterPrefs({ ...printerPrefs, receiptPaperWidth: '58mm' })}
                  className={`p-3 rounded-xl border text-left transition flex items-center justify-between ${
                    printerPrefs.receiptPaperWidth === '58mm'
                      ? 'border-indigo-600 bg-indigo-50/70 dark:bg-indigo-950/40 text-indigo-950 dark:text-indigo-200 ring-1 ring-indigo-500'
                      : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <div>
                    <p className="font-bold text-xs">58mm (2-Inch Compact)</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">Portable Bluetooth thermal</p>
                  </div>
                  {printerPrefs.receiptPaperWidth === '58mm' && (
                    <Check className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                  )}
                </button>
              </div>
            </div>

            {/* Invoice Number Prefix */}
            <div>
              <div className="flex items-center justify-between">
                <FieldLabel htmlFor="inv-prefix">Invoice Number Prefix</FieldLabel>
                <span className="text-[11px] font-mono font-bold text-indigo-600 dark:text-indigo-400">
                  Preview: {printerPrefs.invoicePrefix || 'INV'}-2026-0001
                </span>
              </div>
              <TextInput
                id="inv-prefix"
                value={printerPrefs.invoicePrefix || ''}
                onChange={(e) => setPrinterPrefs({ ...printerPrefs, invoicePrefix: e.target.value.toUpperCase() })}
                placeholder="e.g. INV, BILL, RET"
              />
            </div>

            {/* Storefront Footer Notes */}
            <div>
              <FieldLabel htmlFor="rec-footer">Storefront Receipt Footer Note</FieldLabel>
              <textarea
                id="rec-footer"
                rows={2}
                value={printerPrefs.footerNote || ''}
                onChange={(e) => setPrinterPrefs({ ...printerPrefs, footerNote: e.target.value })}
                placeholder="e.g. Thank you for shopping with us! Please visit again."
                className="w-full px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {/* Terms & Conditions / Signature Note */}
            <div>
              <FieldLabel htmlFor="rec-terms">Terms &amp; Jurisdiction Note</FieldLabel>
              <TextInput
                id="rec-terms"
                value={printerPrefs.signatureNote || ''}
                onChange={(e) => setPrinterPrefs({ ...printerPrefs, signatureNote: e.target.value })}
                placeholder="Goods once sold will not be taken back."
              />
            </div>

            {printerSaveMsg && (
              <p className="text-xs text-emerald-700 dark:text-emerald-400 font-semibold">{printerSaveMsg}</p>
            )}

            <button
              type="submit"
              className="bhaviq-btn-primary px-4 py-2.5 min-h-[40px] rounded-xl text-xs font-semibold whitespace-nowrap shadow-sm"
            >
              Save Printer Preferences
            </button>
          </form>
        </SurfaceCard>

        {/* Card 3: Data Management & Backup (col-span-6) */}
        <SurfaceCard className="lg:col-span-6 p-5 space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
                Data Management &amp; Backup
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Export store inventory, sales invoices, and Khata credit records
              </p>
            </div>
          </div>

          <div className="space-y-3 pt-1">
            {/* Inventory Export */}
            <div className="p-3 rounded-xl bg-slate-50/80 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between gap-3">
              <div>
                <p className="font-bold text-xs text-slate-900 dark:text-white flex items-center gap-1.5">
                  <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                  <span>Store Inventory ({storeProducts.length} items)</span>
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">SKU, barcodes, MRP, purchase &amp; selling prices</p>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleExportInventoryCsv}
                  className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 hover:border-emerald-500 text-slate-700 dark:text-slate-200 text-[11px] font-bold inline-flex items-center gap-1"
                >
                  <Download className="w-3 h-3 text-emerald-600" />
                  <span>CSV</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportInventoryJson}
                  className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 hover:border-indigo-500 text-slate-700 dark:text-slate-200 text-[11px] font-bold inline-flex items-center gap-1"
                >
                  <Download className="w-3 h-3 text-indigo-600" />
                  <span>JSON</span>
                </button>
              </div>
            </div>

            {/* Sales & Billing Invoices Export */}
            <div className="p-3 rounded-xl bg-slate-50/80 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between gap-3">
              <div>
                <p className="font-bold text-xs text-slate-900 dark:text-white flex items-center gap-1.5">
                  <ReceiptText className="w-4 h-4 text-blue-600" />
                  <span>Sales &amp; Billing Invoices ({storeInvoices.length} bills)</span>
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">Amounts, tax breakdown, payments &amp; dates</p>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleExportSalesCsv}
                  className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 hover:border-emerald-500 text-slate-700 dark:text-slate-200 text-[11px] font-bold inline-flex items-center gap-1"
                >
                  <Download className="w-3 h-3 text-emerald-600" />
                  <span>CSV</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportSalesJson}
                  className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 hover:border-indigo-500 text-slate-700 dark:text-slate-200 text-[11px] font-bold inline-flex items-center gap-1"
                >
                  <Download className="w-3 h-3 text-indigo-600" />
                  <span>JSON</span>
                </button>
              </div>
            </div>

            {/* Khata Customers Export */}
            <div className="p-3 rounded-xl bg-slate-50/80 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between gap-3">
              <div>
                <p className="font-bold text-xs text-slate-900 dark:text-white flex items-center gap-1.5">
                  <Wallet className="w-4 h-4 text-amber-600" />
                  <span>Khata Credit Ledger ({storeCustomers.length} accounts)</span>
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">Customer balances, credit limits &amp; phones</p>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleExportKhataCsv}
                  className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 hover:border-emerald-500 text-slate-700 dark:text-slate-200 text-[11px] font-bold inline-flex items-center gap-1"
                >
                  <Download className="w-3 h-3 text-emerald-600" />
                  <span>CSV</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportKhataJson}
                  className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 hover:border-indigo-500 text-slate-700 dark:text-slate-200 text-[11px] font-bold inline-flex items-center gap-1"
                >
                  <Download className="w-3 h-3 text-indigo-600" />
                  <span>JSON</span>
                </button>
              </div>
            </div>

            {/* Complete Store Backup */}
            <div className="pt-2">
              <button
                type="button"
                onClick={handleExportFullBackup}
                className="w-full py-2.5 px-4 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/60 dark:bg-indigo-950/40 hover:bg-indigo-100 dark:hover:bg-indigo-950/70 text-indigo-900 dark:text-indigo-200 text-xs font-bold inline-flex items-center justify-center gap-2 transition shadow-xs"
              >
                <HardDrive className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <span>Download Complete Master Store Backup (.json)</span>
              </button>
            </div>
          </div>
        </SurfaceCard>

        {/* Card 4: Shop & Tax Configuration (col-span-6) */}
        <SurfaceCard className="lg:col-span-6 p-5 space-y-4">
          <h3 className="font-display text-base font-semibold">Shop &amp; Tax Configuration</h3>
          <form onSubmit={handleSaveShop} className="space-y-3.5">
            <div>
              <FieldLabel htmlFor="set-shop-name">Shop name</FieldLabel>
              <TextInput
                id="set-shop-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel htmlFor="set-city">City</FieldLabel>
                <TextInput
                  id="set-city"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                />
              </div>
              <div>
                <FieldLabel htmlFor="set-margin">Default target margin (%)</FieldLabel>
                <TextInput
                  id="set-margin"
                  type="number"
                  value={defaultMargin}
                  onChange={(e) => setDefaultMargin(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel htmlFor="set-tax">Tax mode</FieldLabel>
                <SelectInput
                  id="set-tax"
                  value={taxMode}
                  onChange={(e) =>
                    setTaxMode(e.target.value as 'gst_inclusive' | 'gst_exclusive' | 'non_gst')
                  }
                >
                  <option value="gst_inclusive">GST Inclusive</option>
                  <option value="gst_exclusive">GST Exclusive</option>
                  <option value="non_gst">Non-GST</option>
                </SelectInput>
              </div>
              <div>
                <FieldLabel htmlFor="set-gstin">GSTIN</FieldLabel>
                <TextInput
                  id="set-gstin"
                  value={gstin}
                  onChange={(e) => setGstin(e.target.value.toUpperCase())}
                />
              </div>
            </div>

            {saveMsg && (
              <p className="text-xs text-emerald-700 dark:text-emerald-400 font-semibold">{saveMsg}</p>
            )}

            <button
              type="submit"
              disabled={shop.role !== 'owner'}
              className="bhaviq-btn-primary px-4 py-2.5 min-h-[42px] rounded-xl disabled:opacity-50 text-xs font-semibold whitespace-nowrap"
            >
              Save shop settings
            </button>
          </form>
        </SurfaceCard>

        {/* Card 5: Appearance, Localization & Staff (col-span-6) */}
        <SurfaceCard className="lg:col-span-6 p-5 space-y-5">
          <div>
            <h3 className="font-display text-base font-semibold">Appearance &amp; Localization</h3>
            <p className="text-xs text-[var(--text-secondary)]">
              Signed in as {user.fullName} ({shop.role})
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>Color theme</FieldLabel>
              <button
                type="button"
                onClick={onToggleTheme}
                className="w-full min-h-[42px] px-3.5 rounded-xl border border-[var(--border-hairline)] text-xs font-semibold text-left"
              >
                Current: {theme === 'dark' ? 'Dark slate' : 'Porcelain light'} (switch)
              </button>
            </div>
            <div>
              <FieldLabel htmlFor="set-lang">Language</FieldLabel>
              <SelectInput
                id="set-lang"
                value={language}
                onChange={(e) => onChangeLanguage(e.target.value as AppLanguage)}
              >
                <option value="en">English</option>
                <option value="hi">हिन्दी (Hindi)</option>
                <option value="mr">मराठी (Marathi)</option>
              </SelectInput>
            </div>
          </div>

          {shop.role === 'owner' && (
            <form onSubmit={handleAddStaff} className="pt-4 border-t border-[var(--border-hairline)] space-y-3">
              <p className="text-xs font-semibold flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-[var(--accent-primary)]" />
                <span>Add counter staff member (RBAC)</span>
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <TextInput
                  placeholder="Staff full name"
                  required
                  value={staffName}
                  onChange={(e) => setStaffName(e.target.value)}
                />
                <TextInput
                  type="email"
                  placeholder="Staff email"
                  required
                  value={staffEmail}
                  onChange={(e) => setStaffEmail(e.target.value)}
                />
                <TextInput
                  type="password"
                  placeholder="Password (6+ chars)"
                  required
                  value={staffPassword}
                  onChange={(e) => setStaffPassword(e.target.value)}
                />
              </div>
              {staffMsg && <p className="text-xs text-[var(--text-secondary)]">{staffMsg}</p>}
              <button
                type="submit"
                className="px-4 py-2 min-h-[38px] rounded-xl border border-[var(--border-hairline)] text-xs font-semibold hover:bg-[var(--bg-subtle)]"
              >
                Add staff member
              </button>
            </form>
          )}
        </SurfaceCard>
      </div>

      {/* Audit Logs */}
      <SurfaceCard className="p-5">
        <h3 className="font-display text-base font-semibold mb-3">
          Recent Shop Audit Trail ({auditLogs.length})
        </h3>
        {auditLogs.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]">No audit events recorded yet.</p>
        ) : (
          <div className="divide-y divide-[var(--border-hairline)] max-h-72 overflow-y-auto">
            {auditLogs.slice(0, 20).map((log) => (
              <div key={log.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                <div>
                  <span className="font-mono-num font-semibold text-[var(--text-primary)]">
                    {log.action}
                  </span>
                  <span className="text-[var(--text-muted)] ml-2">
                    by {log.userName} · {log.entityType}
                  </span>
                </div>
                <span className="font-mono-num text-[11px] text-[var(--text-muted)]">
                  {new Date(log.createdAt).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </SurfaceCard>

      <DevicePairingModal
        isOpen={pairingModalOpen}
        onClose={() => setPairingModalOpen(false)}
        shop={shop}
        onPairedChange={(info) => setPairedDevice(info)}
      />
    </div>
  );
};
