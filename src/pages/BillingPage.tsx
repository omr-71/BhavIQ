import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  EmptyStateCard,
  FieldLabel,
  ResponsiveDialog,
  SelectInput,
  SurfaceCard,
  TextInput,
} from '../components/ui';
import { InvoiceSuite } from '../components/InvoiceSuite';
import { apiRequest } from '../lib/api';
import { calculateInvoiceTotals, formatINR, validatePaymentSplit } from '../lib/finance';
import {
  buildPreviewInvoice,
  loadInvoicePrefs,
  saveInvoicePrefs,
  type InvoiceCustomizationPrefs,
} from '../lib/invoiceTemplates';
import { enqueuePendingTransaction } from '../lib/offlineQueue';
import { convertToBaseQuantity, roundCurrency } from '../lib/units';
import type { Customer, Invoice, PaymentMode, Product, Shop } from '../lib/types';
import {
  Camera,
  CheckCircle2,
  FileSpreadsheet,
  Minus,
  Plus,
  Receipt,
  Search,
  ShoppingBag,
  Trash2,
  Smartphone,
  Radio,
} from 'lucide-react';
import { DevicePairingModal } from '../components/DevicePairingModal';
import {
  deviceBridge,
  getSavedPairedDeviceInfo,
  getSavedPairingPayload,
  playRetailScannerBeep,
  playRetailErrorBeep,
  type BridgeMessage,
  type PairedDeviceInfo,
} from '../lib/deviceBridge';
import { lookupBarcodeInMasterCatalog, lookupGlobalProductCatalog } from '../lib/barcodeLookup';

interface BillingPageProps {
  shop: Shop;
  products: Product[];
  customers: Customer[];
  invoices: Invoice[];
  isMobile: boolean;
  isOnline: boolean;
  onRefreshAll: () => Promise<void>;
  onPendingQueueUpdated: () => void;
}

interface CartLine {
  product: Product;
  quantity: number;
  unitName: string;
  unitSellingPrice: number;
  discountAmount: number;
}

export const BillingPage: React.FC<BillingPageProps> = ({
  shop,
  products,
  customers,
  invoices,
  isMobile,
  isOnline,
  onRefreshAll,
  onPendingQueueUpdated,
}) => {
  const [subTab, setSubTab] = useState<'pos' | 'history'>('pos');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [invoiceDiscount, setInvoiceDiscount] = useState('0');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('cash');
  const [cashPaid, setCashPaid] = useState('');
  const [upiPaid, setUpiPaid] = useState('');
  const [creditPaid, setCreditPaid] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [templateStudioOpen, setTemplateStudioOpen] = useState(false);
  const [invoicePrefs, setInvoicePrefs] = useState<InvoiceCustomizationPrefs>(() =>
    loadInvoicePrefs(shop.id)
  );
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [pairedDevice, setPairedDevice] = useState<PairedDeviceInfo | null>(getSavedPairedDeviceInfo());
  const [pairingModalOpen, setPairingModalOpen] = useState(false);
  const [remoteScanWaiting, setRemoteScanWaiting] = useState(false);
  const [bridgeToast, setBridgeToast] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Listen for mobile barcode bridge events
  useEffect(() => {
    const payload = getSavedPairingPayload();
    if (!payload?.token) return;

    const unsubscribe = deviceBridge.connect(payload.token, 'desktop', (msg: BridgeMessage) => {
      if (msg.type === 'DEVICE_PAIRED' || msg.type === 'DEVICE_PAIR_ACK') {
        const info = getSavedPairedDeviceInfo();
        setPairedDevice(info);
      } else if (msg.type === 'DEVICE_UNLINK') {
        setPairedDevice(null);
      } else if (msg.type === 'BARCODE_SCANNED') {
        const payload = msg.payload || {};
        const code = payload.barcode || payload.lookup?.barcode;
        if (!code && !payload.productId && !payload.sku) return;

        // 1. Strict Product Database Matching: Query active store inventory by productId, exact barcode, or SKU
        let targetProduct =
          (payload.productId ? products.find((p) => p.id === payload.productId) : null) ||
          (code ? products.find((p) => p.barcode && p.barcode.trim() === String(code).trim()) : null) ||
          (payload.sku ? products.find((p) => p.sku && p.sku.trim().toLowerCase() === String(payload.sku).trim().toLowerCase()) : null);

        let wasAutoRegistered = false;

        // 2. Global Product Lookup & Auto-Registration Fallback
        if (!targetProduct) {
          const globalLookup = lookupGlobalProductCatalog(code || payload.sku, products);
          const prodName = payload.name || (globalLookup.found ? globalLookup.name : '');
          if (!prodName) {
            // Unknown product without name - discard to prevent injecting dummy/fake items
            return;
          }
          const category = payload.category || globalLookup.category || 'Packaged FMCG';
          const brand = payload.brand || globalLookup.brand || null;
          const imageUrl = payload.imageUrl || globalLookup.imageUrl || null;
          const packSize = payload.packSize || globalLookup.packSize || null;
          const sellingPrice = Number(payload.sellingPrice || globalLookup.sellingPrice || 50);
          const mrp = Number(payload.mrp || globalLookup.mrp || sellingPrice);
          const purchasePrice = Number(payload.purchasePrice || globalLookup.purchasePrice || roundCurrency(sellingPrice * 0.85));
          const baseUnit = payload.baseUnit || globalLookup.baseUnit || 'Piece';
          const sku = payload.sku || globalLookup.sku || `SKU-${String(code).slice(-6)}`;
          const newProdId = `prod_auto_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

          const autoCreatedProduct: Product = {
            id: newProdId,
            shopId: shop.id,
            name: prodName,
            brand,
            packSize,
            variety: null,
            category,
            barcode: code || null,
            sku,
            baseUnit,
            purchasePrice,
            landedCost: purchasePrice,
            sellingPrice,
            mrp,
            taxRatePct: 0,
            mrpRestricted: true,
            currentStock: 50,
            minStockLevel: 5,
            primarySupplierId: null,
            expiryDate: globalLookup.expiryDate || null,
            batchNumber: null,
            imageUrl,
            marketCommodityName: null,
            marketCoverageStatus: 'available',
            units: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };

          targetProduct = autoCreatedProduct;
          wasAutoRegistered = true;

          // Asynchronously persist auto-registered product into the shop's active inventory catalog
          apiRequest(`/api/shops/${shop.id}/products`, {
            method: 'POST',
            body: JSON.stringify({
              name: prodName,
              brand,
              packSize,
              variety: null,
              category,
              barcode: code || null,
              sku,
              baseUnit,
              purchasePrice,
              sellingPrice,
              mrp,
              taxRatePct: 0,
              mrpRestricted: true,
              currentStock: 50,
              minStockLevel: 5,
              imageUrl,
              units: [],
            }),
          })
            .then(() => onRefreshAll())
            .catch((err) => console.warn('Could not persist auto-registered product to store inventory:', err));
        }

        // 3. Instant Realtime POS Injection: Immediately append exact verified product to bill
        setRemoteScanWaiting(false);
        playRetailScannerBeep(1850, 80);
        addToCart(targetProduct);

        setBridgeToast(
          wasAutoRegistered || payload.autoRegister
            ? `🟢 Auto-Registered & Added: ${targetProduct.name} (₹${targetProduct.sellingPrice}) to POS Bill`
            : `Instant Realtime POS Sync: Added ${targetProduct.name} to bill (₹${targetProduct.sellingPrice})`
        );
        setTimeout(() => setBridgeToast(null), 3500);

        // 4. Instant acknowledgement back to mobile screen
        deviceBridge.send('SCAN_PROCESSED', 'desktop', {
          barcode: targetProduct.barcode || code,
          name: targetProduct.name,
          price: targetProduct.sellingPrice,
          autoRegistered: wasAutoRegistered || payload.autoRegister,
        });
      }
    });

    return () => {
      unsubscribe();
    };
  }, [products, shop.id]);

  const handleScanViaPairedMobile = async () => {
    const info = getSavedPairedDeviceInfo();
    if (!info) {
      setPairingModalOpen(true);
      return;
    }

    setRemoteScanWaiting(true);
    setBridgeToast(`Requested mobile camera scan on ${info.deviceName}...`);
    setTimeout(() => setBridgeToast(null), 3500);

    await deviceBridge.send('REQUEST_MOBILE_SCAN', 'desktop', {
      context: 'billing',
      shopId: shop.id,
      timestamp: Date.now(),
    });
  };

  useEffect(() => {
    setInvoicePrefs(loadInvoicePrefs(shop.id));
  }, [shop.id]);

  const handleUpdateInvoicePrefs = (next: InvoiceCustomizationPrefs) => {
    setInvoicePrefs(next);
    saveInvoicePrefs(shop.id, next);
  };

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.brand && p.brand.toLowerCase().includes(q)) ||
        (p.barcode && p.barcode.toLowerCase().includes(q)) ||
        (p.sku && p.sku.toLowerCase().includes(q))
    );
  }, [products, search]);

  const addToCart = (product: Product) => {
    setError(null);
    setStatusMsg(null);
    setCart((prev) => {
      const idx = prev.findIndex((c) => c.product.id === product.id);
      if (idx !== -1) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], quantity: copy[idx].quantity + 1 };
        return copy;
      }
      const defaultSellUnit = product.units.find((u) => u.isDefaultSellUnit);
      const unitName = defaultSellUnit ? defaultSellUnit.unitName : product.baseUnit;
      const factor = defaultSellUnit ? defaultSellUnit.conversionToBase : 1;
      return [
        ...prev,
        {
          product,
          quantity: 1,
          unitName,
          unitSellingPrice: roundCurrency(product.sellingPrice * factor),
          discountAmount: 0,
        },
      ];
    });
  };

  const handleBarcodeSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = search.trim();
    if (!q) return;
    const exact = products.find(
      (p) => (p.barcode && p.barcode === q) || (p.sku && p.sku.toLowerCase() === q.toLowerCase())
    );
    if (exact) {
      addToCart(exact);
      setSearch('');
    }
  };

  const startScanner = async () => {
    setScannerError(null);
    setScannerOpen(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setScannerError('Camera access is unavailable in this browser. Enter barcode manually in search.');
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      const BarcodeDetectorCtor = (window as unknown as { BarcodeDetector?: new () => { detect: (el: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> } }).BarcodeDetector;
      if (!BarcodeDetectorCtor) {
        setScannerError('Live BarcodeDetector API is unsupported on this browser. Type or paste barcode below.');
        return;
      }
      const detector = new BarcodeDetectorCtor();
      const scanTick = async () => {
        if (!videoRef.current || !streamRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes.length > 0 && codes[0].rawValue) {
            const code = codes[0].rawValue;
            const match = products.find((p) => p.barcode === code);
            if (match) {
              addToCart(match);
              stopScanner();
              return;
            }
          }
        } catch {
          // ignore frame detection error
        }
        if (streamRef.current) {
          setTimeout(scanTick, 350);
        }
      };
      setTimeout(scanTick, 400);
    } catch {
      setScannerError('Camera permission denied or unavailable. Enter barcode manually.');
    }
  };

  const stopScanner = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setScannerOpen(false);
  };

  const updateCartUnit = (productId: string, unitName: string) => {
    setCart((prev) =>
      prev.map((line) => {
        if (line.product.id !== productId) return line;
        const factor = convertToBaseQuantity(1, unitName, line.product.baseUnit, line.product.units);
        return {
          ...line,
          unitName,
          unitSellingPrice: roundCurrency(line.product.sellingPrice * factor),
        };
      })
    );
  };

  const totals = useMemo(() => {
    return calculateInvoiceTotals(
      cart.map((c) => ({
        productId: c.product.id,
        quantity: c.quantity,
        unitSellingPrice: c.unitSellingPrice,
        discountAmount: c.discountAmount,
        taxRatePct: shop.taxMode === 'non_gst' ? 0 : c.product.taxRatePct,
        costPricePerBaseUnit: c.product.landedCost ?? c.product.purchasePrice,
        baseQuantityDeducted: convertToBaseQuantity(
          c.quantity,
          c.unitName,
          c.product.baseUnit,
          c.product.units
        ),
      })),
      Number(invoiceDiscount) || 0,
      shop.taxMode
    );
  }, [cart, invoiceDiscount, shop.taxMode]);

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setStatusMsg(null);

    if (cart.length === 0) {
      setError('Add at least one item to the bill.');
      return;
    }

    const splitCheck = validatePaymentSplit({
      totalAmount: totals.totalAmount,
      paymentMode,
      cashPaid: Number(cashPaid) || 0,
      upiPaid: Number(upiPaid) || 0,
      creditAmount: Number(creditPaid) || 0,
      hasCustomer: Boolean(customerId),
    });

    if (!splitCheck.valid) {
      setError(splitCheck.error || 'Invalid payment breakdown');
      return;
    }

    const clientTxId = crypto.randomUUID();
    const payload = {
      clientTxId,
      customerId: customerId || null,
      discountAmount: Number(invoiceDiscount) || 0,
      paymentMode,
      cashPaid: Number(cashPaid) || 0,
      upiPaid: Number(upiPaid) || 0,
      creditAmount: Number(creditPaid) || 0,
      items: cart.map((c) => ({
        productId: c.product.id,
        quantity: c.quantity,
        unitName: c.unitName,
        unitSellingPrice: c.unitSellingPrice,
        discountAmount: c.discountAmount,
      })),
    };

    if (!isOnline) {
      enqueuePendingTransaction({
        id: clientTxId,
        shopId: shop.id,
        endpoint: `/api/shops/${shop.id}/invoices`,
        method: 'POST',
        payload,
        label: `Offline Bill (${formatINR(totals.totalAmount)})`,
        createdAt: new Date().toISOString(),
      });
      onPendingQueueUpdated();
      setCart([]);
      setInvoiceDiscount('0');
      setMobileCartOpen(false);
      setStatusMsg('Device offline — bill saved safely to pending sync queue.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiRequest<{ invoice: Invoice }>(`/api/shops/${shop.id}/invoices`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setCart([]);
      setInvoiceDiscount('0');
      setCashPaid('');
      setUpiPaid('');
      setCreditPaid('');
      setCustomerId('');
      setMobileCartOpen(false);
      setSelectedInvoice(res.invoice);
      setStatusMsg(`Invoice ${res.invoice.invoiceNumber} created and stock updated.`);
      await onRefreshAll();
    } catch (err) {
      if (err instanceof TypeError) {
        enqueuePendingTransaction({
          id: clientTxId,
          shopId: shop.id,
          endpoint: `/api/shops/${shop.id}/invoices`,
          method: 'POST',
          payload,
          label: `Pending Bill (${formatINR(totals.totalAmount)})`,
          createdAt: new Date().toISOString(),
        });
        onPendingQueueUpdated();
        setCart([]);
        setMobileCartOpen(false);
        setStatusMsg('Connection dropped — bill queued safely with idempotency key.');
      } else {
        setError(err instanceof Error ? err.message : 'Billing failed');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const renderCartCheckoutPanel = () => (
    <form onSubmit={handleCheckout} className="space-y-4">
      {error && (
        <div
          role="alert"
          className="px-3.5 py-2.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300"
        >
          {error}
        </div>
      )}

      {cart.length === 0 ? (
        <div className="py-10 text-center text-xs text-[var(--text-muted)]">
          Tap or search a product to start building a bill.
        </div>
      ) : (
        <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
          {cart.map((line) => {
            const unitOptions = [
              line.product.baseUnit,
              ...line.product.units.map((u) => u.unitName),
            ].filter((v, i, a) => a.indexOf(v) === i);

            return (
              <div
                key={line.product.id}
                className="p-3 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-canvas)]/60 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
                      {line.product.name}
                    </p>
                    <p className="text-[11px] font-mono-num text-[var(--text-muted)]">
                      Stock: {line.product.currentStock} {line.product.baseUnit} · {formatINR(line.unitSellingPrice)}/{line.unitName}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove ${line.product.name} from bill`}
                    onClick={() =>
                      setCart((prev) => prev.filter((c) => c.product.id !== line.product.id))
                    }
                    className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-red-600"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <div className="inline-flex items-center rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)]">
                    <button
                      type="button"
                      aria-label={`Decrease ${line.product.name} quantity`}
                      onClick={() =>
                        setCart((prev) =>
                          prev
                            .map((c) =>
                              c.product.id === line.product.id
                                ? { ...c, quantity: Math.max(0, c.quantity - 1) }
                                : c
                            )
                            .filter((c) => c.quantity > 0)
                        )
                      }
                      className="w-9 h-9 flex items-center justify-center text-[var(--text-secondary)]"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <input
                      type="number"
                      aria-label={`${line.product.name} quantity`}
                      min="0.01"
                      step="any"
                      value={line.quantity}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        if (!Number.isFinite(val)) return;
                        setCart((prev) =>
                          prev.map((c) =>
                            c.product.id === line.product.id ? { ...c, quantity: val } : c
                          )
                        );
                      }}
                      className="w-12 text-center font-mono-num text-xs font-semibold bg-transparent focus:outline-none"
                    />
                    <button
                      type="button"
                      aria-label={`Increase ${line.product.name} quantity`}
                      onClick={() =>
                        setCart((prev) =>
                          prev.map((c) =>
                            c.product.id === line.product.id
                              ? { ...c, quantity: c.quantity + 1 }
                              : c
                          )
                        )
                      }
                      className="w-9 h-9 flex items-center justify-center text-[var(--text-secondary)]"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <select
                    aria-label={`Unit for ${line.product.name}`}
                    value={line.unitName}
                    onChange={(e) => updateCartUnit(line.product.id, e.target.value)}
                    className="rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] px-2.5 py-2 text-xs font-medium min-h-[38px]"
                  >
                    {unitOptions.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>

                  <span className="font-mono-num text-sm font-semibold text-[var(--text-primary)]">
                    {formatINR(line.quantity * line.unitSellingPrice)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-[var(--border-hairline)]">
        <div>
          <FieldLabel htmlFor="bill-customer">Customer (optional / required for credit)</FieldLabel>
          <SelectInput
            id="bill-customer"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
          >
            <option value="">Walk-in customer</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} {c.currentBalance > 0 ? `(Bal: ₹${c.currentBalance.toFixed(0)})` : ''}
              </option>
            ))}
          </SelectInput>
        </div>
        <div>
          <FieldLabel htmlFor="bill-discount">Bill discount (₹)</FieldLabel>
          <TextInput
            id="bill-discount"
            type="number"
            min="0"
            step="0.5"
            value={invoiceDiscount}
            onChange={(e) => setInvoiceDiscount(e.target.value)}
          />
        </div>
      </div>

      <div>
        <FieldLabel>Payment mode</FieldLabel>
        <div className="grid grid-cols-4 gap-1.5 p-1 rounded-xl bg-[var(--bg-subtle)]">
          {(['cash', 'upi', 'credit', 'split'] as PaymentMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setPaymentMode(m)}
              className={`py-2 text-xs font-semibold rounded-lg uppercase tracking-wide min-h-[38px] transition-colors ${
                paymentMode === m
                  ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm'
                  : 'text-[var(--text-secondary)]'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {paymentMode === 'split' && (
        <div className="grid grid-cols-3 gap-2">
          <div>
            <FieldLabel htmlFor="split-cash">Cash (₹)</FieldLabel>
            <TextInput
              id="split-cash"
              type="number"
              min="0"
              step="0.01"
              value={cashPaid}
              onChange={(e) => setCashPaid(e.target.value)}
            />
          </div>
          <div>
            <FieldLabel htmlFor="split-upi">UPI (₹)</FieldLabel>
            <TextInput
              id="split-upi"
              type="number"
              min="0"
              step="0.01"
              value={upiPaid}
              onChange={(e) => setUpiPaid(e.target.value)}
            />
          </div>
          <div>
            <FieldLabel htmlFor="split-credit">Credit (₹)</FieldLabel>
            <TextInput
              id="split-credit"
              type="number"
              min="0"
              step="0.01"
              value={creditPaid}
              onChange={(e) => setCreditPaid(e.target.value)}
            />
          </div>
        </div>
      )}

      <div className="pt-3 border-t border-[var(--border-hairline)] space-y-1.5 text-xs">
        <div className="flex justify-between text-[var(--text-secondary)]">
          <span>Subtotal</span>
          <span className="font-mono-num">{formatINR(totals.subtotal)}</span>
        </div>
        {shop.taxMode !== 'non_gst' && (
          <div className="flex justify-between text-[var(--text-secondary)]">
            <span>GST ({shop.taxMode === 'gst_inclusive' ? 'included' : 'added'})</span>
            <span className="font-mono-num">{formatINR(totals.taxAmount)}</span>
          </div>
        )}
        <div className="flex justify-between text-base font-bold text-[var(--text-primary)] pt-1">
          <span>Total payable</span>
          <span className="font-mono-num">{formatINR(totals.totalAmount)}</span>
        </div>
      </div>

      <button
        type="submit"
        disabled={submitting || cart.length === 0}
        className="bhaviq-btn-primary w-full min-h-[46px] rounded-xl disabled:opacity-50 text-sm font-semibold inline-flex items-center justify-center gap-2 whitespace-nowrap"
      >
        <CheckCircle2 className="w-4 h-4" />
        <span>{submitting ? 'Completing bill...' : `Complete Bill · ${formatINR(totals.totalAmount)}`}</span>
      </button>
    </form>
  );

  return (
    <div className="space-y-5 bhaviq-page-enter">
      {/* Sub-tabs & Invoice Suite Trigger */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-[var(--bg-subtle)]">
          <button
            type="button"
            onClick={() => setSubTab('pos')}
            className={`px-4 py-2 text-xs font-semibold rounded-lg min-h-[38px] whitespace-nowrap transition-colors ${
              subTab === 'pos'
                ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm'
                : 'text-[var(--text-secondary)]'
            }`}
          >
            New Bill (POS)
          </button>
          <button
            type="button"
            onClick={() => setSubTab('history')}
            className={`px-4 py-2 text-xs font-semibold rounded-lg min-h-[38px] whitespace-nowrap transition-colors ${
              subTab === 'history'
                ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm'
                : 'text-[var(--text-secondary)]'
            }`}
          >
            Invoice History ({invoices.length})
          </button>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {statusMsg && (
            <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
              {statusMsg}
            </span>
          )}
          <button
            type="button"
            onClick={() => setTemplateStudioOpen(true)}
            className="px-3.5 py-2 min-h-[38px] rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] hover:bg-[var(--bg-subtle)] text-xs font-semibold text-[var(--text-primary)] inline-flex items-center gap-2 whitespace-nowrap shadow-xs transition-colors"
          >
            <FileSpreadsheet className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <span>Invoice Templates</span>
          </button>
        </div>
      </div>

      {subTab === 'pos' ? (
        products.length === 0 ? (
          <EmptyStateCard
            icon={<ShoppingBag className="w-6 h-6" />}
            title="No products in inventory yet"
            description="Add products in Products & Inventory before generating retail bills."
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* Left Catalog / Search */}
            <div className="lg:col-span-7 space-y-4">
              <form onSubmit={handleBarcodeSearchSubmit} className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-[var(--text-muted)] absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <TextInput
                    aria-label="Search products by name, brand, or scan barcode"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search product name, brand, SKU, or scan barcode..."
                    className="pl-10"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleScanViaPairedMobile}
                  aria-label="Scan via Paired Mobile Camera"
                  className={`min-h-[42px] px-3.5 rounded-xl border text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap transition-all shadow-xs ${
                    pairedDevice
                      ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50/90 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100 hover:scale-[1.01]'
                      : 'border-[var(--border-hairline)] bg-[var(--bg-surface)] hover:bg-[var(--bg-subtle)] text-[var(--text-primary)]'
                  }`}
                  title={
                    pairedDevice
                      ? `🟢 Linked & Connected to ${pairedDevice.deviceName} (Click to trigger remote camera scan)`
                      : 'Pair a phone to use as wireless laser barcode scanner'
                  }
                >
                  <Smartphone className={`w-4 h-4 ${pairedDevice ? 'text-emerald-600 dark:text-emerald-400 animate-pulse' : ''}`} />
                  <span className="hidden sm:inline">
                    {pairedDevice ? '🟢 Linked: Scan via Mobile' : 'Pair Mobile Camera'}
                  </span>
                  {pairedDevice ? (
                    <span className="flex h-2 w-2 relative">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                  ) : null}
                </button>

                <button
                  type="button"
                  onClick={startScanner}
                  aria-label="Scan barcode with camera"
                  className="min-h-[42px] px-3.5 rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-surface)] hover:bg-[var(--bg-subtle)] text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Camera className="w-4 h-4" />
                  <span className="hidden sm:inline">Local Cam</span>
                </button>
              </form>

              {/* Mobile Barcode Bridge Live Toast / Radar */}
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

              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3.5 pb-20 md:pb-0">
                {filteredProducts.map((p) => {
                  const outOfStock = p.currentStock <= 0;
                  return (
                    <SurfaceCard
                      key={p.id}
                      onClick={() => !outOfStock && addToCart(p)}
                      className={`p-4 ${outOfStock ? 'opacity-55 cursor-not-allowed' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
                            {p.name}
                          </p>
                          <p className="text-[11px] text-[var(--text-muted)] truncate">
                            {[p.brand, p.category].filter(Boolean).join(' · ')}
                          </p>
                        </div>
                        <span className="font-mono-num text-sm font-bold text-[var(--accent-primary)] shrink-0">
                          {formatINR(p.sellingPrice)}
                        </span>
                      </div>
                      <div className="mt-2.5 flex items-center justify-between text-[11px] font-mono-num text-[var(--text-secondary)]">
                        <span>
                          {outOfStock
                            ? 'Out of stock'
                            : `${p.currentStock} ${p.baseUnit} in stock`}
                        </span>
                        <span>/{p.baseUnit}</span>
                      </div>
                    </SurfaceCard>
                  );
                })}
              </div>
            </div>

            {/* Desktop Checkout Panel */}
            {!isMobile && (
              <SurfaceCard className="lg:col-span-5 p-5 sticky top-20">
                <h3 className="font-display text-base font-semibold text-[var(--text-primary)] mb-4">
                  Current Bill
                </h3>
                {renderCartCheckoutPanel()}
              </SurfaceCard>
            )}

            {/* Mobile Sticky Cart Bar */}
            {isMobile && cart.length > 0 && (
              <div className="fixed bottom-[72px] left-3 right-3 z-30">
                <button
                  type="button"
                  onClick={() => setMobileCartOpen(true)}
                  className="bhaviq-btn-primary w-full min-h-[50px] px-4 rounded-2xl flex items-center justify-between text-sm font-semibold"
                >
                  <span>
                    {cart.reduce((s, c) => s + c.quantity, 0)} items · Review & Pay
                  </span>
                  <span className="font-mono-num">{formatINR(totals.totalAmount)}</span>
                </button>
              </div>
            )}
          </div>
        )
      ) : invoices.length === 0 ? (
        <EmptyStateCard
          icon={<Receipt className="w-6 h-6" />}
          title="No invoices recorded yet"
          description="Completed bills will appear here with full item snapshots, GST details, and printable receipts."
          actionLabel="Create your first bill"
          onAction={() => setSubTab('pos')}
        />
      ) : isMobile ? (
        <div className="space-y-3">
          {invoices.map((inv) => (
            <SurfaceCard
              key={inv.id}
              onClick={() => setSelectedInvoice(inv)}
              className="p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-mono-num text-xs font-semibold text-[var(--text-primary)]">
                    {inv.invoiceNumber}
                  </p>
                  <p className="text-sm font-semibold mt-0.5">
                    {inv.customerNameSnapshot || 'Walk-in customer'}
                  </p>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">
                    {inv.items.length} {inv.items.length === 1 ? 'item' : 'items'} · {inv.paymentMode.toUpperCase()} ·{' '}
                    {new Date(inv.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="text-right">
                  <span className="font-mono-num text-sm font-bold text-[var(--text-primary)]">
                    {formatINR(inv.totalAmount)}
                  </span>
                  {inv.creditAmount > 0 && (
                    <p className="text-[11px] font-mono-num text-amber-700 dark:text-amber-400">
                      Due: {formatINR(inv.creditAmount)}
                    </p>
                  )}
                </div>
              </div>
            </SurfaceCard>
          ))}
        </div>
      ) : (
        <SurfaceCard className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[var(--border-hairline)] text-xs text-[var(--text-muted)]">
                  <th className="py-3 px-4 font-medium">Invoice #</th>
                  <th className="py-3 px-4 font-medium">Date & time</th>
                  <th className="py-3 px-4 font-medium">Customer</th>
                  <th className="py-3 px-4 font-medium">Payment</th>
                  <th className="py-3 px-4 font-medium text-right">Total</th>
                  <th className="py-3 px-4 font-medium text-right">Credit due</th>
                  <th className="py-3 px-4 font-medium text-right">Receipt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-hairline)] text-sm">
                {invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-[var(--bg-subtle)]/50">
                    <td className="py-3 px-4 font-mono-num font-medium">{inv.invoiceNumber}</td>
                    <td className="py-3 px-4 font-mono-num text-xs text-[var(--text-secondary)]">
                      {new Date(inv.createdAt).toLocaleString()}
                    </td>
                    <td className="py-3 px-4">{inv.customerNameSnapshot || 'Walk-in'}</td>
                    <td className="py-3 px-4 uppercase text-xs font-semibold text-[var(--text-secondary)]">
                      {inv.paymentMode}
                    </td>
                    <td className="py-3 px-4 font-mono-num text-right font-semibold">
                      {formatINR(inv.totalAmount)}
                    </td>
                    <td className="py-3 px-4 font-mono-num text-right text-amber-700 dark:text-amber-400">
                      {inv.creditAmount > 0 ? formatINR(inv.creditAmount) : '—'}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => setSelectedInvoice(inv)}
                        className="text-xs font-semibold text-[var(--accent-primary)] hover:underline"
                      >
                        View / Print
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SurfaceCard>
      )}

      {/* Mobile Checkout Bottom Sheet */}
      <ResponsiveDialog
        open={mobileCartOpen}
        onClose={() => setMobileCartOpen(false)}
        title="Review & Complete Bill"
        subtitle={`${cart.length} line items`}
      >
        {renderCartCheckoutPanel()}
      </ResponsiveDialog>

      {/* Multi-Style Printable Invoice Studio Modal */}
      <ResponsiveDialog
        open={Boolean(selectedInvoice) || templateStudioOpen}
        onClose={() => {
          setSelectedInvoice(null);
          setTemplateStudioOpen(false);
        }}
        title={
          selectedInvoice
            ? `Invoice ${selectedInvoice.invoiceNumber}`
            : 'Invoice Suite & Template Customizer'
        }
        subtitle={`${shop.name} · Switch between 80mm Thermal, A4 GST, Minimalist & B2B Challan`}
        maxWidthClass="max-w-5xl"
      >
        {(() => {
          const matchedCustomer = customers.find((c) => c.id === customerId) ?? null;
          const previewBundle = buildPreviewInvoice({
            shop,
            cartLines: cart,
            selectedCustomer: matchedCustomer,
            invoiceDiscount: Number(invoiceDiscount) || 0,
            paymentMode,
            totals,
          });
          const activeInvoice = selectedInvoice ?? previewBundle.invoice;
          return (
            <InvoiceSuite
              shop={shop}
              invoice={activeInvoice}
              products={products}
              customers={customers}
              prefs={invoicePrefs}
              onUpdatePrefs={handleUpdateInvoicePrefs}
              isSamplePreview={!selectedInvoice}
            />
          );
        })()}
      </ResponsiveDialog>

      {/* Camera Barcode Scanner Dialog */}
      <ResponsiveDialog
        open={scannerOpen}
        onClose={stopScanner}
        title="Scan product barcode"
        subtitle="Point camera at EAN/UPC barcode or type it manually"
      >
        <div className="space-y-4">
          <video
            ref={videoRef}
            className="w-full h-56 rounded-xl bg-black object-cover"
            playsInline
            muted
          />
          {scannerError && (
            <p className="text-xs text-amber-700 dark:text-amber-400">{scannerError}</p>
          )}
          <button
            type="button"
            onClick={stopScanner}
            className="w-full min-h-[42px] rounded-xl border border-[var(--border-hairline)] text-xs font-semibold"
          >
            Close scanner
          </button>
        </div>
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
