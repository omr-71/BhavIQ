import React, { useMemo, useState } from 'react';
import {
  EmptyStateCard,
  FieldLabel,
  ResponsiveDialog,
  SelectInput,
  SurfaceCard,
  TextInput,
} from '../components/ui';
import { ProductWholesaleIntelligence } from '../components/ProductWholesaleIntelligence';
import { apiRequest } from '../lib/api';
import { formatINR } from '../lib/finance';
import { formatStockDisplay, STANDARD_UNITS } from '../lib/units';
import type {
  BaseUnit,
  Product,
  RetailCategory,
  Shop,
  StockMovement,
  Supplier,
} from '../lib/types';
import { ArrowUpDown, Layers, PackagePlus, Plus, Search, Smartphone, Radio } from 'lucide-react';
import { DevicePairingModal } from '../components/DevicePairingModal';
import {
  deviceBridge,
  getSavedPairedDeviceInfo,
  getSavedPairingPayload,
  playRetailScannerBeep,
  type BridgeMessage,
  type PairedDeviceInfo,
} from '../lib/deviceBridge';
import { lookupBarcodeInMasterCatalog } from '../lib/barcodeLookup';

interface InventoryPageProps {
  shop: Shop;
  products: Product[];
  movements: StockMovement[];
  suppliers: Supplier[];
  isMobile: boolean;
  onRefreshAll: () => Promise<void>;
  onOpenWholesaleView?: (productId: string) => void;
}

const CATEGORIES: RetailCategory[] = [
  'Grocery',
  'Food Products',
  'Beverages',
  'Personal Care',
  'Household',
  'Packaged FMCG',
  'Loose Products',
  'Vegetables',
  'Fruits',
  'Grains',
  'Pulses',
  'Other',
];

export const InventoryPage: React.FC<InventoryPageProps> = ({
  shop,
  products,
  movements,
  suppliers,
  isMobile,
  onRefreshAll,
  onOpenWholesaleView,
}) => {
  const [subTab, setSubTab] = useState<'catalog' | 'movements'>('catalog');
  const [wholesaleProductId, setWholesaleProductId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [lowStockOnly, setLowStockOnly] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [packSize, setPackSize] = useState('');
  const [variety, setVariety] = useState('');
  const [category, setCategory] = useState<RetailCategory>('Grocery');
  const [barcode, setBarcode] = useState('');
  const [sku, setSku] = useState('');
  const [baseUnit, setBaseUnit] = useState<BaseUnit>('Kilogram');
  const [packUnitName, setPackUnitName] = useState('');
  const [packConversion, setPackConversion] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [sellingPrice, setSellingPrice] = useState('');
  const [mrp, setMrp] = useState('');
  const [taxRatePct, setTaxRatePct] = useState('0');
  const [mrpRestricted, setMrpRestricted] = useState(true);
  const [currentStock, setCurrentStock] = useState('0');
  const [minStockLevel, setMinStockLevel] = useState('5');
  const [primarySupplierId, setPrimarySupplierId] = useState('');
  const [marketCommodityName, setMarketCommodityName] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [batchNumber, setBatchNumber] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [adjustTarget, setAdjustTarget] = useState<Product | null>(null);
  const [adjustType, setAdjustType] = useState<'adjustment' | 'damaged' | 'expiry' | 'return'>('adjustment');
  const [adjustQty, setAdjustQty] = useState('');
  const [adjustUnit, setAdjustUnit] = useState('');
  const [adjustNote, setAdjustNote] = useState('');
  const [adjustError, setAdjustError] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [pairedDevice, setPairedDevice] = useState<PairedDeviceInfo | null>(getSavedPairedDeviceInfo());
  const [pairingModalOpen, setPairingModalOpen] = useState(false);
  const [bridgeToast, setBridgeToast] = useState<string | null>(null);

  // Listen for mobile barcode bridge events
  React.useEffect(() => {
    const payload = getSavedPairingPayload();
    if (!payload?.token) return;

    const unsubscribe = deviceBridge.connect(payload.token, 'desktop', (msg: BridgeMessage) => {
      if (msg.type === 'DEVICE_PAIRED' || msg.type === 'DEVICE_PAIR_ACK') {
        const info = getSavedPairedDeviceInfo();
        setPairedDevice(info);
      } else if (msg.type === 'DEVICE_UNLINK') {
        setPairedDevice(null);
      } else if (msg.type === 'BARCODE_SCANNED') {
        const code = msg.payload?.barcode;
        if (!code) return;

        const lookup = lookupBarcodeInMasterCatalog(code, products);
        if (!lookup.isValid) {
          // Reject invalid or noise code
          return;
        }

        playRetailScannerBeep(1850, 80);

        if (addOpen) {
          // Autofill the active Add Product modal with 100% precision
          setName(lookup.name);
          setBrand(lookup.brand);
          setPackSize(lookup.packSize);
          setBarcode(lookup.barcode);
          setSku(lookup.sku);
          setMrp(lookup.mrp > 0 ? String(lookup.mrp) : '');
          setSellingPrice(String(lookup.sellingPrice));
          setPurchasePrice(String(lookup.purchasePrice));
          setBaseUnit(lookup.isLoose ? 'Kilogram' : 'Piece');
          setExpiryDate(lookup.expiryDate);

          // Map category to valid RetailCategory
          if (lookup.category.includes('FMCG') || lookup.category.includes('Cleaning') || lookup.category.includes('Personal')) {
            setCategory('Packaged FMCG');
          } else if (lookup.category.includes('Grains')) {
            setCategory('Grains');
          } else if (lookup.category.includes('Pulses')) {
            setCategory('Pulses');
          } else if (lookup.category.includes('Beverages')) {
            setCategory('Beverages');
          } else {
            setCategory('Grocery');
          }

          setBridgeToast(`Autofilled: ${lookup.name} (₹${lookup.mrp || lookup.sellingPrice})`);
        } else {
          setSearch(code);
          setBridgeToast(`Scanned via Mobile: ${lookup.name}`);
        }

        setTimeout(() => setBridgeToast(null), 4000);

        deviceBridge.send('SCAN_PROCESSED', 'desktop', {
          barcode: code,
          name: lookup.name,
          price: lookup.mrp || lookup.sellingPrice,
        });
      }
    });

    return () => {
      unsubscribe();
    };
  }, [addOpen, products]);

  const handleScanViaPairedMobile = async () => {
    const info = getSavedPairedDeviceInfo();
    if (!info) {
      setPairingModalOpen(true);
      return;
    }

    setBridgeToast(`Requested mobile camera scan on ${info.deviceName}...`);
    setTimeout(() => setBridgeToast(null), 3500);

    await deviceBridge.send('REQUEST_MOBILE_SCAN', 'desktop', {
      context: 'inventory',
      shopId: shop.id,
      timestamp: Date.now(),
    });
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (categoryFilter !== 'all' && p.category !== categoryFilter) return false;
      if (lowStockOnly && !(p.minStockLevel > 0 && p.currentStock <= p.minStockLevel)) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.brand && p.brand.toLowerCase().includes(q)) ||
        (p.barcode && p.barcode.toLowerCase().includes(q)) ||
        (p.sku && p.sku.toLowerCase().includes(q))
      );
    });
  }, [products, search, categoryFilter, lowStockOnly]);

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      const units =
        packUnitName.trim() && Number(packConversion) > 0
          ? [
              {
                unitName: packUnitName.trim(),
                conversionToBase: Number(packConversion),
                isDefaultBuyUnit: true,
                isDefaultSellUnit: false,
              },
            ]
          : [];

      await apiRequest(`/api/shops/${shop.id}/products`, {
        method: 'POST',
        body: JSON.stringify({
          name,
          brand: brand || null,
          packSize: packSize || null,
          variety: variety || null,
          category,
          barcode: barcode || null,
          sku: sku || null,
          baseUnit,
          purchasePrice: purchasePrice ? Number(purchasePrice) : null,
          sellingPrice: Number(sellingPrice),
          mrp: mrp ? Number(mrp) : null,
          taxRatePct: Number(taxRatePct) || 0,
          mrpRestricted,
          currentStock: Number(currentStock) || 0,
          minStockLevel: Number(minStockLevel) || 0,
          primarySupplierId: primarySupplierId || null,
          marketCommodityName: marketCommodityName || null,
          expiryDate: expiryDate || null,
          batchNumber: batchNumber || null,
          units,
        }),
      });
      setAddOpen(false);
      setName('');
      setBrand('');
      setPackSize('');
      setVariety('');
      setBarcode('');
      setSku('');
      setPackUnitName('');
      setPackConversion('');
      setPurchasePrice('');
      setSellingPrice('');
      setMrp('');
      setCurrentStock('0');
      setMarketCommodityName('');
      await onRefreshAll();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to save product');
    } finally {
      setSaving(false);
    }
  };

  const handleStockAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustTarget) return;
    setAdjustError(null);
    setAdjusting(true);
    try {
      await apiRequest(`/api/shops/${shop.id}/products/${adjustTarget.id}/stock-adjustment`, {
        method: 'POST',
        body: JSON.stringify({
          movementType: adjustType,
          quantity: Number(adjustQty),
          unitName: adjustUnit || adjustTarget.baseUnit,
          note: adjustNote,
        }),
      });
      setAdjustTarget(null);
      setAdjustQty('');
      setAdjustNote('');
      await onRefreshAll();
    } catch (err) {
      setAdjustError(err instanceof Error ? err.message : 'Adjustment failed');
    } finally {
      setAdjusting(false);
    }
  };

  if (wholesaleProductId) {
    return (
      <ProductWholesaleIntelligence
        shop={shop}
        productId={wholesaleProductId}
        canAddQuote={suppliers.length > 0}
        backLabel="Back to Inventory"
        onBack={() => setWholesaleProductId(null)}
        onOpenQuoteModal={onOpenWholesaleView ? (pid) => onOpenWholesaleView(pid) : undefined}
        onOpenObsModal={onOpenWholesaleView ? (pid) => onOpenWholesaleView(pid) : undefined}
        onRefreshAll={onRefreshAll}
      />
    );
  }

  return (
    <div className="space-y-5 bhaviq-page-enter">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-[var(--bg-subtle)] self-start">
          <button
            type="button"
            onClick={() => setSubTab('catalog')}
            className={`px-4 py-2 text-xs font-semibold rounded-lg min-h-[38px] whitespace-nowrap transition-colors ${
              subTab === 'catalog'
                ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm'
                : 'text-[var(--text-secondary)]'
            }`}
          >
            Products ({products.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('movements')}
            className={`px-4 py-2 text-xs font-semibold rounded-lg min-h-[38px] whitespace-nowrap transition-colors ${
              subTab === 'movements'
                ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm'
                : 'text-[var(--text-secondary)]'
            }`}
          >
            Stock Movements ({movements.length})
          </button>
        </div>

        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="bhaviq-btn-primary px-4 py-2.5 min-h-[42px] rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
        >
          <Plus className="w-4 h-4" />
          <span>Add product</span>
        </button>
      </div>

      {subTab === 'catalog' ? (
        products.length === 0 ? (
          <EmptyStateCard
            icon={<PackagePlus className="w-6 h-6" />}
            title="Add your first product"
            description="Track retail stock, multi-unit conversions like cartons to packets, landed costs, and selling margins."
            actionLabel="Add your first product"
            onAction={() => setAddOpen(true)}
          />
        ) : (
          <>
            <div className="flex flex-col md:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-[var(--text-muted)] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <TextInput
                  aria-label="Search inventory products"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search product, brand, SKU, or barcode..."
                  className="pl-10"
                />
              </div>
              <div className="flex items-center gap-2">
                <SelectInput
                  aria-label="Filter by category"
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="md:w-48"
                >
                  <option value="all">All categories</option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </SelectInput>
                <button
                  type="button"
                  onClick={() => setLowStockOnly((v) => !v)}
                  className={`px-3.5 py-2.5 min-h-[42px] rounded-xl border text-xs font-semibold whitespace-nowrap transition-colors ${
                    lowStockOnly
                      ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300'
                      : 'bg-[var(--bg-surface)] border-[var(--border-hairline)] text-[var(--text-secondary)]'
                  }`}
                >
                  Low stock only
                </button>

                <button
                  type="button"
                  onClick={handleScanViaPairedMobile}
                  aria-label="Scan via Paired Mobile Camera"
                  className={`px-3.5 py-2.5 min-h-[42px] rounded-xl border text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shadow-xs transition-colors ${
                    pairedDevice
                      ? 'border-indigo-300 dark:border-indigo-700 bg-indigo-50/90 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100'
                      : 'border-[var(--border-hairline)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]'
                  }`}
                  title={
                    pairedDevice
                      ? `Scan product with ${pairedDevice.deviceName}`
                      : 'Pair a phone to use as wireless laser barcode scanner'
                  }
                >
                  <Smartphone className={`w-4 h-4 ${pairedDevice ? 'text-indigo-600 dark:text-indigo-400 animate-pulse' : ''}`} />
                  <span className="hidden sm:inline">
                    {pairedDevice ? 'Scan via Paired Mobile Camera' : 'Pair Mobile'}
                  </span>
                  {pairedDevice && (
                    <span className="flex h-2 w-2 relative">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                  )}
                </button>
              </div>
            </div>

            {bridgeToast && (
              <div className="p-3 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 text-xs font-semibold text-indigo-900 dark:text-indigo-200 flex items-center justify-between gap-3 shadow-md bhaviq-sheet-enter">
                <div className="flex items-center gap-2 truncate">
                  <span className="w-2 h-2 rounded-full bg-indigo-600 animate-ping" />
                  <span className="truncate">{bridgeToast}</span>
                </div>
                <span className="px-2 py-0.5 rounded-full bg-indigo-200 dark:bg-indigo-800 text-[10px] font-bold uppercase shrink-0">
                  Live Bridge
                </span>
              </div>
            )}

            {isMobile ? (
              <div className="space-y-3">
                {filtered.map((p) => {
                  const isLow = p.minStockLevel > 0 && p.currentStock <= p.minStockLevel;
                  return (
                    <SurfaceCard key={p.id} className="p-4 space-y-2.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
                            {p.name}
                          </p>
                          <p className="text-xs text-[var(--text-muted)]">
                            {[p.brand, p.packSize, p.category].filter(Boolean).join(' · ')}
                          </p>
                        </div>
                        <span className="font-mono-num text-sm font-bold text-[var(--accent-primary)] shrink-0">
                          {formatINR(p.sellingPrice)}/{p.baseUnit}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-xs pt-2.5 border-t border-[var(--border-hairline)]">
                        <span
                          className={`font-mono-num font-semibold ${
                            isLow
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-[var(--text-primary)]'
                          }`}
                        >
                          {formatStockDisplay(p.currentStock, p.baseUnit, p.units)}
                          {isLow ? ' · Low stock' : ''}
                        </span>
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => setWholesaleProductId(p.id)}
                            className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 min-h-[36px] px-1"
                          >
                            Wholesale rate
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setAdjustTarget(p);
                              setAdjustUnit(p.baseUnit);
                              setAdjustError(null);
                            }}
                            className="text-xs font-semibold text-[var(--text-secondary)] min-h-[36px] px-1"
                          >
                            Adjust stock
                          </button>
                        </div>
                      </div>
                    </SurfaceCard>
                  );
                })}
              </div>
            ) : (
              <SurfaceCard className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-[var(--border-hairline)] text-xs text-[var(--text-muted)]">
                        <th className="py-3 px-4 font-medium">Product</th>
                        <th className="py-3 px-4 font-medium">Category</th>
                        <th className="py-3 px-4 font-medium text-right">Landed cost</th>
                        <th className="py-3 px-4 font-medium text-right">Selling price</th>
                        <th className="py-3 px-4 font-medium text-right">MRP</th>
                        <th className="py-3 px-4 font-medium">Current stock</th>
                        <th className="py-3 px-4 font-medium text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border-hairline)] text-sm">
                      {filtered.map((p) => {
                        const isLow = p.minStockLevel > 0 && p.currentStock <= p.minStockLevel;
                        return (
                          <tr key={p.id} className="hover:bg-[var(--bg-subtle)]/50">
                            <td className="py-3 px-4">
                              <p className="font-semibold text-[var(--text-primary)]">{p.name}</p>
                              <p className="text-xs text-[var(--text-muted)]">
                                {[p.brand, p.packSize, p.sku, p.barcode].filter(Boolean).join(' · ') || p.baseUnit}
                              </p>
                            </td>
                            <td className="py-3 px-4 text-xs text-[var(--text-secondary)]">
                              {p.category}
                            </td>
                            <td className="py-3 px-4 font-mono-num text-right text-xs">
                              {p.landedCost !== null ? formatINR(p.landedCost) : 'Not recorded'}
                            </td>
                            <td className="py-3 px-4 font-mono-num text-right font-semibold">
                              {formatINR(p.sellingPrice)}
                            </td>
                            <td className="py-3 px-4 font-mono-num text-right text-xs text-[var(--text-secondary)]">
                              {p.mrp !== null ? formatINR(p.mrp) : '—'}
                            </td>
                            <td className="py-3 px-4 font-mono-num text-xs">
                              <span
                                className={
                                  isLow
                                    ? 'text-amber-700 dark:text-amber-400 font-semibold'
                                    : 'text-[var(--text-primary)]'
                                }
                              >
                                {formatStockDisplay(p.currentStock, p.baseUnit, p.units)}
                              </span>
                            </td>
                            <td className="py-3.5 px-4 text-right whitespace-nowrap">
                              <div className="inline-flex items-center gap-3">
                                <button
                                  type="button"
                                  onClick={() => setWholesaleProductId(p.id)}
                                  className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                                >
                                  Wholesale rate
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setAdjustTarget(p);
                                    setAdjustUnit(p.baseUnit);
                                    setAdjustError(null);
                                  }}
                                  className="text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] inline-flex items-center gap-1"
                                >
                                  <ArrowUpDown className="w-3.5 h-3.5" />
                                  <span>Adjust</span>
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </SurfaceCard>
            )}
          </>
        )
      ) : movements.length === 0 ? (
        <EmptyStateCard
          icon={<Layers className="w-6 h-6" />}
          title="No stock movements logged"
          description="Every purchase, sale, return, damage, expiry, and manual correction creates a permanent stock audit record."
        />
      ) : (
        <SurfaceCard className="overflow-hidden">
          <div className="divide-y divide-[var(--border-hairline)]">
            {movements.map((m) => (
              <div key={m.id} className="p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
                    {m.productName} · <span className="capitalize">{m.movementType}</span>
                  </p>
                  <p className="text-xs text-[var(--text-muted)]">
                    {m.note || m.referenceType || 'Stock ledger entry'} ·{' '}
                    {new Date(m.createdAt).toLocaleString()}
                  </p>
                </div>
                <span
                  className={`font-mono-num text-sm font-semibold shrink-0 ${
                    m.quantityDelta >= 0
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-red-700 dark:text-red-400'
                  }`}
                >
                  {m.quantityDelta >= 0 ? `+${m.quantityDelta}` : m.quantityDelta}
                </span>
              </div>
            ))}
          </div>
        </SurfaceCard>
      )}

      {/* Add Product Modal / Sheet */}
      <ResponsiveDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add new product"
        subtitle="Define base unit, optional bulk unit conversion, cost, and MRP"
        maxWidthClass="max-w-2xl"
      >
        <form onSubmit={handleCreateProduct} className="space-y-4">
          {formError && (
            <div className="px-3.5 py-2.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
              {formError}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            <div>
              <FieldLabel htmlFor="prod-name" required>
                Product name
              </FieldLabel>
              <TextInput
                id="prod-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Basmati Rice Reserve"
              />
            </div>
            <div>
              <FieldLabel htmlFor="prod-brand">Brand</FieldLabel>
              <TextInput
                id="prod-brand"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="e.g. Daawat / Loose"
              />
            </div>
            <div>
              <FieldLabel htmlFor="prod-packsize">Pack size (prevents mixing packs)</FieldLabel>
              <TextInput
                id="prod-packsize"
                value={packSize}
                onChange={(e) => setPackSize(e.target.value)}
                placeholder="e.g. 25 Kg, 500 g, 1 L"
              />
            </div>
            <div>
              <FieldLabel htmlFor="prod-variety">Variety / Grade (optional, for mandi match)</FieldLabel>
              <TextInput
                id="prod-variety"
                value={variety}
                onChange={(e) => setVariety(e.target.value)}
                placeholder="e.g. Nasik Red, 1121 Steam"
              />
            </div>
            <div>
              <FieldLabel htmlFor="prod-cat" required>
                Category
              </FieldLabel>
              <SelectInput
                id="prod-cat"
                value={category}
                onChange={(e) => setCategory(e.target.value as RetailCategory)}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </SelectInput>
            </div>
            <div>
              <FieldLabel htmlFor="prod-unit" required>
                Base stock unit
              </FieldLabel>
              <SelectInput
                id="prod-unit"
                value={baseUnit}
                onChange={(e) => setBaseUnit(e.target.value as BaseUnit)}
              >
                {STANDARD_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </SelectInput>
            </div>
            <div>
              <FieldLabel htmlFor="prod-pack-name">Bulk pack unit (optional, e.g. Carton / Bag)</FieldLabel>
              <TextInput
                id="prod-pack-name"
                value={packUnitName}
                onChange={(e) => setPackUnitName(e.target.value)}
                placeholder="e.g. Bag or Carton"
              />
            </div>
            <div>
              <FieldLabel htmlFor="prod-pack-conv">
                Base units per bulk pack (e.g. 12)
              </FieldLabel>
              <TextInput
                id="prod-pack-conv"
                type="number"
                min="0.01"
                step="any"
                value={packConversion}
                onChange={(e) => setPackConversion(e.target.value)}
                placeholder={`How many ${baseUnit}s in 1 pack`}
              />
            </div>
            <div>
              <FieldLabel htmlFor="prod-buy">Purchase price per {baseUnit} (₹)</FieldLabel>
              <TextInput
                id="prod-buy"
                type="number"
                min="0"
                step="0.01"
                value={purchasePrice}
                onChange={(e) => setPurchasePrice(e.target.value)}
                placeholder="Leave blank if unknown"
              />
            </div>
            <div>
              <FieldLabel htmlFor="prod-sell" required>
                Selling price per {baseUnit} (₹)
              </FieldLabel>
              <TextInput
                id="prod-sell"
                type="number"
                min="0.01"
                step="0.01"
                required
                value={sellingPrice}
                onChange={(e) => setSellingPrice(e.target.value)}
                placeholder="e.g. 100"
              />
            </div>
            <div>
              <FieldLabel htmlFor="prod-mrp">MRP per {baseUnit} (₹)</FieldLabel>
              <TextInput
                id="prod-mrp"
                type="number"
                min="0"
                step="0.01"
                value={mrp}
                onChange={(e) => setMrp(e.target.value)}
                placeholder="e.g. 120"
              />
            </div>
            <div>
              <FieldLabel htmlFor="prod-gst">GST rate (%)</FieldLabel>
              <TextInput
                id="prod-gst"
                type="number"
                min="0"
                max="28"
                step="0.5"
                value={taxRatePct}
                onChange={(e) => setTaxRatePct(e.target.value)}
              />
            </div>
            <div>
              <FieldLabel htmlFor="prod-stock">Opening stock ({baseUnit})</FieldLabel>
              <TextInput
                id="prod-stock"
                type="number"
                min="0"
                step="any"
                value={currentStock}
                onChange={(e) => setCurrentStock(e.target.value)}
              />
            </div>
            <div>
              <FieldLabel htmlFor="prod-min">Minimum stock alert level ({baseUnit})</FieldLabel>
              <TextInput
                id="prod-min"
                type="number"
                min="0"
                step="any"
                value={minStockLevel}
                onChange={(e) => setMinStockLevel(e.target.value)}
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <FieldLabel htmlFor="prod-barcode">Barcode / EAN</FieldLabel>
                <button
                  type="button"
                  onClick={handleScanViaPairedMobile}
                  className="px-2.5 py-1 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50/80 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 text-[11px] font-bold inline-flex items-center gap-1.5 hover:bg-indigo-100 transition-colors shadow-xs"
                >
                  <Smartphone className="w-3.5 h-3.5" />
                  <span>Scan via Paired Mobile Camera</span>
                </button>
              </div>
              <TextInput
                id="prod-barcode"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                placeholder="Optional barcode (or click above to scan via phone)"
              />
            </div>
            <div>
              <FieldLabel htmlFor="prod-sku">SKU</FieldLabel>
              <TextInput
                id="prod-sku"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                placeholder="Optional internal SKU"
              />
            </div>
            <div>
              <FieldLabel htmlFor="prod-supplier">Primary supplier</FieldLabel>
              <SelectInput
                id="prod-supplier"
                value={primarySupplierId}
                onChange={(e) => setPrimarySupplierId(e.target.value)}
              >
                <option value="">None selected</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </SelectInput>
            </div>
            <div>
              <FieldLabel htmlFor="prod-commodity">
                AGMARKNET commodity match (for agri items)
              </FieldLabel>
              <TextInput
                id="prod-commodity"
                value={marketCommodityName}
                onChange={(e) => setMarketCommodityName(e.target.value)}
                placeholder="e.g. Onion, Tomato, Rice"
              />
            </div>
            <div>
              <FieldLabel htmlFor="prod-batch">Batch number</FieldLabel>
              <TextInput
                id="prod-batch"
                value={batchNumber}
                onChange={(e) => setBatchNumber(e.target.value)}
              />
            </div>
            <div>
              <FieldLabel htmlFor="prod-expiry">Expiry date</FieldLabel>
              <TextInput
                id="prod-expiry"
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)] pt-1">
            <input
              type="checkbox"
              checked={mrpRestricted}
              onChange={(e) => setMrpRestricted(e.target.checked)}
              className="rounded"
            />
            <span>Enforce Indian MRP legal ceiling in Selling Price Calculator</span>
          </label>

          <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border-hairline)]">
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
              className="bhaviq-btn-primary px-5 py-2.5 min-h-[42px] rounded-xl text-xs font-semibold"
            >
              {saving ? 'Saving...' : 'Save product'}
            </button>
          </div>
        </form>
      </ResponsiveDialog>

      {/* Stock Adjustment Modal */}
      <ResponsiveDialog
        open={Boolean(adjustTarget)}
        onClose={() => setAdjustTarget(null)}
        title={adjustTarget ? `Adjust stock · ${adjustTarget.name}` : 'Adjust stock'}
        subtitle="All adjustments write an immutable stock movement & audit log"
      >
        {adjustTarget && (
          <form onSubmit={handleStockAdjustment} className="space-y-4">
            {adjustError && (
              <div className="px-3.5 py-2.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
                {adjustError}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel htmlFor="adj-type" required>
                  Movement type
                </FieldLabel>
                <SelectInput
                  id="adj-type"
                  value={adjustType}
                  onChange={(e) =>
                    setAdjustType(
                      e.target.value as 'adjustment' | 'damaged' | 'expiry' | 'return'
                    )
                  }
                >
                  <option value="adjustment">Manual correction (+/-)</option>
                  <option value="return">Customer return (+)</option>
                  <option value="damaged">Damaged stock (-)</option>
                  <option value="expiry">Expired stock write-off (-)</option>
                </SelectInput>
              </div>
              <div>
                <FieldLabel htmlFor="adj-unit" required>
                  Unit
                </FieldLabel>
                <SelectInput
                  id="adj-unit"
                  value={adjustUnit}
                  onChange={(e) => setAdjustUnit(e.target.value)}
                >
                  <option value={adjustTarget.baseUnit}>{adjustTarget.baseUnit}</option>
                  {adjustTarget.units.map((u) => (
                    <option key={u.id} value={u.unitName}>
                      {u.unitName} ({u.conversionToBase} {adjustTarget.baseUnit})
                    </option>
                  ))}
                </SelectInput>
              </div>
            </div>

            <div>
              <FieldLabel htmlFor="adj-qty" required>
                Quantity (use negative only for manual deduction)
              </FieldLabel>
              <TextInput
                id="adj-qty"
                type="number"
                step="any"
                required
                value={adjustQty}
                onChange={(e) => setAdjustQty(e.target.value)}
                placeholder="e.g. 5 or -2"
              />
            </div>

            <div>
              <FieldLabel htmlFor="adj-note" required>
                Audit reason
              </FieldLabel>
              <TextInput
                id="adj-note"
                required
                value={adjustNote}
                onChange={(e) => setAdjustNote(e.target.value)}
                placeholder="e.g. Physical shelf count reconciliation"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setAdjustTarget(null)}
                className="px-4 py-2.5 min-h-[42px] rounded-xl border border-[var(--border-hairline)] text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={adjusting}
                className="px-5 py-2.5 min-h-[42px] rounded-xl bg-[var(--accent-primary)] text-white text-xs font-semibold"
              >
                {adjusting ? 'Recording...' : 'Record stock movement'}
              </button>
            </div>
          </form>
        )}
      </ResponsiveDialog>

      <DevicePairingModal
        isOpen={pairingModalOpen}
        onClose={() => setPairingModalOpen(false)}
        shop={shop}
        onPairedChange={(info) => setPairedDevice(info)}
      />
    </div>
  );
};
