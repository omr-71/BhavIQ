import React, { useMemo, useState } from 'react';
import {
  EmptyStateCard,
  FieldLabel,
  ResponsiveDialog,
  SelectInput,
  SurfaceCard,
  TextInput,
} from '../components/ui';
import { apiRequest } from '../lib/api';
import { formatINR } from '../lib/finance';
import { allocatePurchaseLandedCosts } from '../lib/pricing';
import { convertToBaseQuantity } from '../lib/units';
import type { Product, Purchase, Shop, Supplier } from '../lib/types';
import { Building2, Plus, Trash2, Truck } from 'lucide-react';

interface PurchasesPageProps {
  shop: Shop;
  purchases: Purchase[];
  suppliers: Supplier[];
  products: Product[];
  isMobile: boolean;
  onRefreshAll: () => Promise<void>;
}

interface PurchaseDraftLine {
  productId: string;
  quantity: string;
  unitName: string;
  purchaseRate: string;
  discountAmount: string;
  taxAmount: string;
  packSize: string;
}

export const PurchasesPage: React.FC<PurchasesPageProps> = ({
  shop,
  purchases,
  suppliers,
  products,
  isMobile,
  onRefreshAll,
}) => {
  const [addOpen, setAddOpen] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0, 10));
  const [freightCost, setFreightCost] = useState('0');
  const [transportCost, setTransportCost] = useState('0');
  const [additionalCosts, setAdditionalCosts] = useState('0');
  const [paidAmount, setPaidAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<PurchaseDraftLine[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openModal = () => {
    setError(null);
    setSupplierId(suppliers[0]?.id || '');
    const firstProd = products[0];
    setLines(
      firstProd
        ? [
            {
              productId: firstProd.id,
              quantity: '1',
              unitName: firstProd.units[0]?.unitName || firstProd.baseUnit,
              purchaseRate: firstProd.purchasePrice ? String(firstProd.purchasePrice) : '',
              discountAmount: '0',
              taxAmount: '0',
              packSize: '',
            },
          ]
        : []
    );
    setFreightCost('0');
    setTransportCost('0');
    setAdditionalCosts('0');
    setPaidAmount('');
    setAddOpen(true);
  };

  const previewAllocations = useMemo(() => {
    try {
      const prepared = lines
        .map((l) => {
          const prod = products.find((p) => p.id === l.productId);
          if (!prod) return null;
          const qty = Number(l.quantity) || 0;
          const rate = Number(l.purchaseRate) || 0;
          if (qty <= 0) return null;
          const baseQty = convertToBaseQuantity(qty, l.unitName, prod.baseUnit, prod.units);
          return {
            productId: prod.id,
            baseQuantityAdded: baseQty,
            purchaseRatePerPurchaseUnit: rate,
            quantityInPurchaseUnit: qty,
            discountAmount: Number(l.discountAmount) || 0,
            taxAmount: Number(l.taxAmount) || 0,
          };
        })
        .filter((x): x is NonNullable<typeof x> => Boolean(x));

      const allocations = allocatePurchaseLandedCosts(
        prepared,
        Number(freightCost) || 0,
        Number(transportCost) || 0,
        Number(additionalCosts) || 0
      );
      const grandTotal =
        allocations.reduce((s, a) => s + a.totalLineCost, 0);
      return { allocations, grandTotal };
    } catch {
      return { allocations: [], grandTotal: 0 };
    }
  }, [lines, products, freightCost, transportCost, additionalCosts]);

  const handleSavePurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await apiRequest(`/api/shops/${shop.id}/purchases`, {
        method: 'POST',
        body: JSON.stringify({
          clientTxId: crypto.randomUUID(),
          supplierId,
          supplierInvoiceNo: supplierInvoiceNo || null,
          purchaseDate,
          freightCost: Number(freightCost) || 0,
          transportCost: Number(transportCost) || 0,
          additionalCosts: Number(additionalCosts) || 0,
          paidAmount: paidAmount !== '' ? Number(paidAmount) : previewAllocations.grandTotal,
          notes: notes || null,
          items: lines.map((l) => ({
            productId: l.productId,
            quantity: Number(l.quantity),
            unitName: l.unitName,
            purchaseRate: Number(l.purchaseRate),
            discountAmount: Number(l.discountAmount) || 0,
            taxAmount: Number(l.taxAmount) || 0,
            packSize: l.packSize || null,
          })),
        }),
      });
      setAddOpen(false);
      await onRefreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to record purchase');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5 bhaviq-page-enter">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold">Purchase Register & Landed Cost</h2>
          <p className="text-xs text-[var(--text-secondary)]">
            Freight, transport, and extra costs allocate automatically into per-unit landed cost.
          </p>
        </div>
        <button
          type="button"
          onClick={openModal}
          disabled={suppliers.length === 0 || products.length === 0}
          className="bhaviq-btn-primary px-4 py-2.5 min-h-[42px] rounded-xl disabled:opacity-50 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
        >
          <Plus className="w-4 h-4" />
          <span>Record purchase</span>
        </button>
      </div>

      {suppliers.length === 0 || products.length === 0 ? (
        <EmptyStateCard
          icon={<Truck className="w-6 h-6" />}
          title="Add a supplier and product before recording purchases"
          description="Purchases link supplier invoices, freight/transport charges, and stock additions into accurate historical landed cost."
        />
      ) : purchases.length === 0 ? (
        <EmptyStateCard
          icon={<Truck className="w-6 h-6" />}
          title="No purchases recorded yet"
          description="Record your first supplier invoice with transport & freight to update stock and calculate exact landed cost."
          actionLabel="Record first purchase"
          onAction={openModal}
        />
      ) : isMobile ? (
        <div className="space-y-3">
          {purchases.map((p) => (
            <SurfaceCard key={p.id} className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">{p.supplierName}</p>
                  <p className="text-xs text-[var(--text-muted)]">
                    {p.purchaseDate} · {p.supplierInvoiceNo || 'No ref'}
                  </p>
                </div>
                <span className="font-mono-num text-sm font-bold">{formatINR(p.totalAmount)}</span>
              </div>
              <div className="text-xs text-[var(--text-secondary)] pt-2 border-t border-[var(--border-hairline)]">
                {p.items.map((it) => (
                  <div key={it.id} className="flex justify-between py-0.5">
                    <span>
                      {it.productName} ({it.quantity} {it.unitName})
                    </span>
                    <span className="font-mono-num">
                      Landed: {formatINR(it.landedCostPerBaseUnit)}
                    </span>
                  </div>
                ))}
              </div>
            </SurfaceCard>
          ))}
        </div>
      ) : (
        <SurfaceCard className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[var(--border-hairline)] bg-slate-50/70 dark:bg-slate-800/40 text-xs text-[var(--text-muted)]">
                  <th className="py-3 px-4 font-semibold">Date</th>
                  <th className="py-3 px-4 font-semibold">Supplier</th>
                  <th className="py-3 px-4 font-semibold">Items & Landed Cost</th>
                  <th className="py-3 px-4 font-semibold text-right">Freight + Transport</th>
                  <th className="py-3 px-4 font-semibold text-right">Total</th>
                  <th className="py-3 px-4 font-semibold text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-hairline)] text-sm">
                {purchases.map((p) => (
                  <tr key={p.id} className="hover:bg-[var(--bg-subtle)]/50">
                    <td className="py-3 px-4 font-mono-num text-xs">{p.purchaseDate}</td>
                    <td className="py-3 px-4">
                      <p className="font-semibold">{p.supplierName}</p>
                      <p className="text-xs text-[var(--text-muted)]">
                        {p.supplierInvoiceNo || 'Direct purchase'}
                      </p>
                    </td>
                    <td className="py-3 px-4 text-xs">
                      {p.items.map((it) => (
                        <div key={it.id}>
                          {it.productName}: {it.quantity} {it.unitName} →{' '}
                          <span className="font-mono-num font-semibold">
                            {formatINR(it.landedCostPerBaseUnit)}
                          </span>{' '}
                          landed/base
                        </div>
                      ))}
                    </td>
                    <td className="py-3 px-4 font-mono-num text-right text-xs">
                      {formatINR(p.freightCost + p.transportCost + p.additionalCosts)}
                    </td>
                    <td className="py-3 px-4 font-mono-num text-right font-semibold">
                      {formatINR(p.totalAmount)}
                    </td>
                    <td className="py-3 px-4 text-right text-xs uppercase font-semibold text-[var(--text-secondary)]">
                      {p.paymentStatus}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SurfaceCard>
      )}

      {/* Record Purchase Modal */}
      <ResponsiveDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Record supplier purchase"
        subtitle="Stock increases atomically and landed cost updates per base unit"
        maxWidthClass="max-w-2xl"
      >
        <form onSubmit={handleSavePurchase} className="space-y-4">
          {error && (
            <div className="px-3.5 py-2.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <FieldLabel htmlFor="pur-supplier" required>
                Supplier
              </FieldLabel>
              <SelectInput
                id="pur-supplier"
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
              >
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </SelectInput>
            </div>
            <div>
              <FieldLabel htmlFor="pur-inv">Supplier invoice #</FieldLabel>
              <TextInput
                id="pur-inv"
                value={supplierInvoiceNo}
                onChange={(e) => setSupplierInvoiceNo(e.target.value)}
                placeholder="e.g. INV-441"
              />
            </div>
            <div>
              <FieldLabel htmlFor="pur-date" required>
                Purchase date
              </FieldLabel>
              <TextInput
                id="pur-date"
                type="date"
                required
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">
                Purchased items
              </span>
              <button
                type="button"
                onClick={() => {
                  const p = products[0];
                  if (!p) return;
                  setLines((prev) => [
                    ...prev,
                    {
                      productId: p.id,
                      quantity: '1',
                      unitName: p.baseUnit,
                      purchaseRate: '',
                      discountAmount: '0',
                      taxAmount: '0',
                      packSize: '',
                    },
                  ]);
                }}
                className="text-xs font-semibold text-[var(--accent-primary)] hover:underline"
              >
                + Add another line
              </button>
            </div>

            {lines.map((line, idx) => {
              const prod = products.find((p) => p.id === line.productId);
              const unitOptions = prod
                ? [prod.baseUnit, ...prod.units.map((u) => u.unitName)].filter(
                    (v, i, a) => a.indexOf(v) === i
                  )
                : [];
              const alloc = previewAllocations.allocations[idx];

              return (
                <div
                  key={idx}
                  className="p-3.5 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)]/50 space-y-2.5"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
                    <div className="sm:col-span-5">
                      <FieldLabel>Product</FieldLabel>
                      <SelectInput
                        aria-label="Purchase product"
                        value={line.productId}
                        onChange={(e) => {
                          const nextProd = products.find((p) => p.id === e.target.value);
                          setLines((prev) =>
                            prev.map((l, i) =>
                              i === idx
                                ? {
                                    ...l,
                                    productId: e.target.value,
                                    unitName: nextProd?.baseUnit || l.unitName,
                                  }
                                : l
                            )
                          );
                        }}
                      >
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </SelectInput>
                    </div>
                    <div className="sm:col-span-2">
                      <FieldLabel>Qty</FieldLabel>
                      <TextInput
                        aria-label="Purchase quantity"
                        type="number"
                        min="0.01"
                        step="any"
                        required
                        value={line.quantity}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((l, i) =>
                              i === idx ? { ...l, quantity: e.target.value } : l
                            )
                          )
                        }
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <FieldLabel>Unit</FieldLabel>
                      <SelectInput
                        aria-label="Purchase unit"
                        value={line.unitName}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((l, i) =>
                              i === idx ? { ...l, unitName: e.target.value } : l
                            )
                          )
                        }
                      >
                        {unitOptions.map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </SelectInput>
                    </div>
                    <div className="sm:col-span-2">
                      <FieldLabel>Rate / unit (₹)</FieldLabel>
                      <TextInput
                        aria-label="Purchase rate per unit"
                        type="number"
                        min="0"
                        step="0.01"
                        required
                        value={line.purchaseRate}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((l, i) =>
                              i === idx ? { ...l, purchaseRate: e.target.value } : l
                            )
                          )
                        }
                      />
                    </div>
                    <div className="sm:col-span-1 flex justify-end">
                      {lines.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            setLines((prev) => prev.filter((_, i) => i !== idx))
                          }
                          className="p-2 text-[var(--text-muted)] hover:text-red-600"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                  {alloc && prod && (
                    <p className="text-[11px] font-mono-num text-[var(--text-secondary)]">
                      Allocated extra: {formatINR(alloc.allocatedExtraCost)} → Effective landed cost:{' '}
                      <span className="font-semibold text-[var(--text-primary)]">
                        {formatINR(alloc.landedCostPerBaseUnit)} / {prod.baseUnit}
                      </span>
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-2 border-t border-[var(--border-hairline)]">
            <div>
              <FieldLabel htmlFor="pur-freight">Freight (₹)</FieldLabel>
              <TextInput
                id="pur-freight"
                type="number"
                min="0"
                step="0.01"
                value={freightCost}
                onChange={(e) => setFreightCost(e.target.value)}
              />
            </div>
            <div>
              <FieldLabel htmlFor="pur-transport">Transport / Hamali (₹)</FieldLabel>
              <TextInput
                id="pur-transport"
                type="number"
                min="0"
                step="0.01"
                value={transportCost}
                onChange={(e) => setTransportCost(e.target.value)}
              />
            </div>
            <div>
              <FieldLabel htmlFor="pur-extra">Additional costs (₹)</FieldLabel>
              <TextInput
                id="pur-extra"
                type="number"
                min="0"
                step="0.01"
                value={additionalCosts}
                onChange={(e) => setAdditionalCosts(e.target.value)}
              />
            </div>
            <div>
              <FieldLabel htmlFor="pur-paid">Amount paid (₹)</FieldLabel>
              <TextInput
                id="pur-paid"
                type="number"
                min="0"
                step="0.01"
                value={paidAmount}
                onChange={(e) => setPaidAmount(e.target.value)}
                placeholder={previewAllocations.grandTotal.toFixed(2)}
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-[var(--border-hairline)]">
            <span className="text-sm font-semibold">
              Total purchase:{' '}
              <span className="font-mono-num">{formatINR(previewAllocations.grandTotal)}</span>
            </span>
            <button
              type="submit"
              disabled={saving}
              className="bhaviq-btn-primary px-5 py-2.5 min-h-[42px] rounded-xl text-xs font-semibold whitespace-nowrap disabled:opacity-50"
            >
              {saving ? 'Recording...' : 'Save purchase & update stock'}
            </button>
          </div>
        </form>
      </ResponsiveDialog>
    </div>
  );
};

interface SuppliersPageProps {
  shop: Shop;
  suppliers: Supplier[];
  isMobile: boolean;
  onRefreshAll: () => Promise<void>;
}

export const SuppliersPage: React.FC<SuppliersPageProps> = ({
  shop,
  suppliers,
  isMobile,
  onRefreshAll,
}) => {
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [phone, setPhone] = useState('');
  const [location, setLocation] = useState('');
  const [gstin, setGstin] = useState('');
  const [categoriesText, setCategoriesText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await apiRequest(`/api/shops/${shop.id}/suppliers`, {
        method: 'POST',
        body: JSON.stringify({
          name,
          contactPerson: contactPerson || null,
          phone: phone || null,
          location: location || null,
          gstin: gstin || null,
          categories: categoriesText
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      });
      setAddOpen(false);
      setName('');
      setContactPerson('');
      setPhone('');
      setLocation('');
      setGstin('');
      setCategoriesText('');
      await onRefreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save supplier');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5 bhaviq-page-enter">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold">Suppliers & Distributors</h2>
          <p className="text-xs text-[var(--text-secondary)]">
            Track wholesale distributors, market locations, and historical rate quotations.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="bhaviq-btn-primary px-4 py-2.5 min-h-[42px] rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
        >
          <Plus className="w-4 h-4" />
          <span>Add supplier</span>
        </button>
      </div>

      {suppliers.length === 0 ? (
        <EmptyStateCard
          icon={<Building2 className="w-6 h-6" />}
          title="Add your first supplier"
          description="Keep wholesale supplier contacts, categories, and rate quotations organized in one place."
          actionLabel="Add your first supplier"
          onAction={() => setAddOpen(true)}
        />
      ) : isMobile ? (
        <div className="space-y-3">
          {suppliers.map((s) => (
            <SurfaceCard key={s.id} className="p-4 space-y-1.5">
              <p className="text-sm font-semibold text-[var(--text-primary)]">{s.name}</p>
              <p className="text-xs text-[var(--text-secondary)]">
                {[s.contactPerson, s.phone, s.location].filter(Boolean).join(' · ') || 'No contact details'}
              </p>
            </SurfaceCard>
          ))}
        </div>
      ) : (
        <SurfaceCard className="overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[var(--border-hairline)] bg-slate-50/70 dark:bg-slate-800/40 text-xs text-[var(--text-muted)]">
                <th className="py-3 px-4 font-semibold">Supplier</th>
                <th className="py-3 px-4 font-semibold">Contact</th>
                <th className="py-3 px-4 font-semibold">Location</th>
                <th className="py-3 px-4 font-semibold">Categories</th>
                <th className="py-3 px-4 font-semibold">GSTIN</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-hairline)] text-sm">
              {suppliers.map((s) => (
                <tr key={s.id} className="hover:bg-[var(--bg-subtle)]/50">
                  <td className="py-3 px-4 font-semibold">{s.name}</td>
                  <td className="py-3 px-4 text-xs text-[var(--text-secondary)]">
                    {[s.contactPerson, s.phone].filter(Boolean).join(' · ') || '—'}
                  </td>
                  <td className="py-3 px-4 text-xs text-[var(--text-secondary)]">
                    {s.location || '—'}
                  </td>
                  <td className="py-3 px-4 text-xs text-[var(--text-secondary)]">
                    {s.categories.length > 0 ? s.categories.join(', ') : '—'}
                  </td>
                  <td className="py-3 px-4 font-mono-num text-xs text-[var(--text-muted)]">
                    {s.gstin || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </SurfaceCard>
      )}

      <ResponsiveDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add supplier"
        subtitle="Distributor, wholesaler, or APMC mandi trader"
      >
        <form onSubmit={handleCreate} className="space-y-4">
          {error && (
            <div className="px-3.5 py-2.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}
          <div>
            <FieldLabel htmlFor="sup-name" required>
              Supplier / firm name
            </FieldLabel>
            <TextInput
              id="sup-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Sahyadri Wholesale Traders"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <FieldLabel htmlFor="sup-person">Contact person</FieldLabel>
              <TextInput
                id="sup-person"
                value={contactPerson}
                onChange={(e) => setContactPerson(e.target.value)}
              />
            </div>
            <div>
              <FieldLabel htmlFor="sup-phone">Phone</FieldLabel>
              <TextInput
                id="sup-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <FieldLabel htmlFor="sup-loc">Location / Market yard</FieldLabel>
              <TextInput
                id="sup-loc"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. Market Yard, Pune"
              />
            </div>
            <div>
              <FieldLabel htmlFor="sup-gst">GSTIN (optional)</FieldLabel>
              <TextInput
                id="sup-gst"
                value={gstin}
                onChange={(e) => setGstin(e.target.value.toUpperCase())}
              />
            </div>
          </div>
          <div>
            <FieldLabel htmlFor="sup-cats">Product categories (comma separated)</FieldLabel>
            <TextInput
              id="sup-cats"
              value={categoriesText}
              onChange={(e) => setCategoriesText(e.target.value)}
              placeholder="e.g. Grocery, Grains, Packaged FMCG"
            />
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
              {saving ? 'Saving...' : 'Save supplier'}
            </button>
          </div>
        </form>
      </ResponsiveDialog>
    </div>
  );
};
