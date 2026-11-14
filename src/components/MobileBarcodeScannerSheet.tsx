import React, { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/library';
import {
  Camera,
  Flashlight,
  FlashlightOff,
  RefreshCw,
  X,
  CheckCircle2,
  Send,
  Smartphone,
  Sparkles,
  Layers,
  ArrowRight,
  Lock,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
} from 'lucide-react';
import { BhaviqLogo } from './BhaviqLogo';
import {
  deviceBridge,
  getSavedPairingPayload,
  playRetailScannerBeep,
  playRetailErrorBeep,
  triggerScannerHaptic,
  type BridgeMessage,
  type PairedDeviceInfo,
} from '../lib/deviceBridge';
import {
  findExactStoreProduct,
  lookupBarcodeInMasterCatalog,
  lookupGlobalProductCatalog,
  lookupGlobalProductCatalogAsync,
  validateRetailBarcode,
} from '../lib/barcodeLookup';
import type { Product, RetailCategory } from '../lib/types';
import { roundCurrency } from '../lib/units';

interface ScannedRecord {
  id: string;
  barcode: string;
  title: string;
  mrp: number;
  time: string;
  source: string;
}

interface QuickManualEntryState {
  isOpen: boolean;
  barcode: string;
  format: string;
  name: string;
  brand: string;
  mrp: string;
  sellingPrice: string;
  category: RetailCategory;
}

interface MobileBarcodeScannerSheetProps {
  isOpen: boolean;
  onClose: () => void;
  shopName: string;
  pairingToken?: string;
  existingShopProducts?: Product[];
}

export const MobileBarcodeScannerSheet: React.FC<MobileBarcodeScannerSheetProps> = ({
  isOpen,
  onClose,
  shopName,
  pairingToken,
  existingShopProducts = [],
}) => {
  const [torchOn, setTorchOn] = useState(false);
  const [hasTorch, setHasTorch] = useState(false);
  const [continuousMode, setContinuousMode] = useState(true);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [manualCode, setManualCode] = useState('');
  const [recentScans, setRecentScans] = useState<ScannedRecord[]>([]);
  const [lastScannedFeedback, setLastScannedFeedback] = useState<string | null>(null);
  const [ignoredBarcodeMsg, setIgnoredBarcodeMsg] = useState<string | null>(null);
  const [notFoundAlert, setNotFoundAlert] = useState<string | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [quickEntryModal, setQuickEntryModal] = useState<QuickManualEntryState | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const zxingReaderRef = useRef<BrowserMultiFormatReader | null>(null);
  const currentStreamRef = useRef<MediaStream | null>(null);
  const isScanningActiveRef = useRef(false);
  const isCooldownLockedRef = useRef(false);
  const cooldownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastScannedCodeRef = useRef<string>('');
  const lastScanTimestampRef = useRef<number>(0);

  // Resolve active pairing token across props, storage and URL params
  const activePairingToken =
    pairingToken ||
    getSavedPairingPayload()?.token ||
    (typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('pair_token') ||
        new URLSearchParams(window.location.search).get('pair')
      : null) ||
    '';

  // Initialize camera and scanner
  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
      isCooldownLockedRef.current = false;
      setCooldownSeconds(0);
      return;
    }

    startCamera();
    return () => {
      stopCamera();
      if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    };
  }, [isOpen, facingMode]);

  // Listen for desktop scan requests & instant acks
  useEffect(() => {
    if (!isOpen || !activePairingToken) return;

    const unsubscribe = deviceBridge.connect(activePairingToken, 'mobile', (msg: BridgeMessage) => {
      if (msg.type === 'REQUEST_MOBILE_SCAN') {
        // Desktop requested camera scan! Trigger haptic alert
        triggerScannerHaptic([70, 40, 70]);
        setLastScannedFeedback('Desktop requested instant scan — aim camera at barcode!');
      } else if (msg.type === 'SCAN_PROCESSED') {
        // Desktop processed the item
        const isAuto = msg.payload?.autoRegistered;
        setLastScannedFeedback(
          isAuto
            ? `🟢 Auto-Added to Store & Beamed to Bill: ${msg.payload?.name} (₹${msg.payload?.price}) ✓`
            : `Desktop confirmed: ${msg.payload?.name || 'Added to POS bill'} (₹${msg.payload?.price}) ✓`
        );
      }
    });

    return () => {
      unsubscribe();
    };
  }, [isOpen, activePairingToken]);

  const startCamera = async () => {
    setErrorMsg(null);
    stopCamera();

    try {
      // 1. Acquire MediaStream
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      currentStreamRef.current = stream;

      // Check flashlight support
      const videoTrack = stream.getVideoTracks()[0];
      const capabilities = (videoTrack as any).getCapabilities?.();
      setHasTorch(Boolean(capabilities?.torch));

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      // 2. Attach ZXing Multi-format reader
      const codeReader = new BrowserMultiFormatReader();
      zxingReaderRef.current = codeReader;
      isScanningActiveRef.current = true;

      const scanLoop = async () => {
        if (!isScanningActiveRef.current || !videoRef.current) return;

        try {
          // Native BarcodeDetector hardware acceleration check
          const BarcodeDetectorCtor = (window as any).BarcodeDetector;
          if (BarcodeDetectorCtor) {
            const detector = new BarcodeDetectorCtor({
              formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'qr_code'],
            });
            const detected = await detector.detect(videoRef.current);
            if (detected.length > 0 && detected[0].rawValue) {
              handleBarcodeDetected(detected[0].rawValue, detected[0].format || 'EAN_13');
            }
          } else {
            // ZXing fallback frame decode
            const result = await codeReader.decodeFromVideoElement(videoRef.current);
            if (result) {
              handleBarcodeDetected(result.getText(), result.getBarcodeFormat().toString());
            }
          }
        } catch {
          // Frame without barcode - continue scanning loop
        }

        if (isScanningActiveRef.current) {
          requestAnimationFrame(() => {
            setTimeout(scanLoop, 120);
          });
        }
      };

      setTimeout(scanLoop, 300);
    } catch (err) {
      setErrorMsg('Camera access unavailable. Grant permission or use manual barcode entry.');
    }
  };

  const stopCamera = () => {
    isScanningActiveRef.current = false;
    if (zxingReaderRef.current) {
      try {
        zxingReaderRef.current.reset();
      } catch {
        // ignore
      }
      zxingReaderRef.current = null;
    }
    if (currentStreamRef.current) {
      currentStreamRef.current.getTracks().forEach((t) => t.stop());
      currentStreamRef.current = null;
    }
  };

  const toggleTorch = async () => {
    if (!currentStreamRef.current) return;
    const videoTrack = currentStreamRef.current.getVideoTracks()[0];
    if (videoTrack) {
      try {
        const next = !torchOn;
        await (videoTrack as any).applyConstraints({
          advanced: [{ torch: next }],
        });
        setTorchOn(next);
      } catch {
        // torch not supported on this platform
      }
    }
  };

  const handleBarcodeDetected = async (rawCode: string, detectedFormat = 'EAN_13') => {
    // 1. Check strict cooldown lock
    if (isCooldownLockedRef.current) return;

    // 2. Strict Barcode Validation: Reject non-product QR codes, URLs, Wi-Fi tags, or invalid checksums
    const validation = validateRetailBarcode(rawCode, existingShopProducts);
    if (!validation.isValid) {
      if (validation.rejectionReason) {
        setIgnoredBarcodeMsg(validation.rejectionReason);
        setTimeout(() => setIgnoredBarcodeMsg(null), 1400);
      }
      return;
    }

    const code = validation.cleanCode;
    const format = validation.format || detectedFormat;

    // 3. Check local store inventory first
    const storeProduct = findExactStoreProduct(code, existingShopProducts);

    if (storeProduct) {
      // 4A. Item Verified in Local Inventory: Engage 1.5s duplicate lock
      setNotFoundAlert(null);
      setIgnoredBarcodeMsg(null);
      isCooldownLockedRef.current = true;
      setCooldownSeconds(1.5);

      if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
      const cooldownStart = Date.now();
      cooldownTimerRef.current = setInterval(() => {
        const elapsed = (Date.now() - cooldownStart) / 1000;
        const remaining = Math.max(0, 1.5 - elapsed);
        setCooldownSeconds(Number(remaining.toFixed(1)));
        if (remaining <= 0) {
          if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
          cooldownTimerRef.current = null;
          isCooldownLockedRef.current = false;
          setCooldownSeconds(0);
        }
      }, 100);

      lastScannedCodeRef.current = code;
      lastScanTimestampRef.current = Date.now();

      // Instant Sensory Confirmation
      playRetailScannerBeep(1850, 75);
      triggerScannerHaptic([45, 25, 45]);

      const record: ScannedRecord = {
        id: `${Date.now()}_${storeProduct.sku || code}`,
        barcode: storeProduct.barcode || code,
        title: storeProduct.name,
        mrp: storeProduct.sellingPrice,
        time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        source: 'Store Stock',
      };

      setRecentScans((prev) => [record, ...prev.slice(0, 14)]);
      setLastScannedFeedback(`Beamed to Desktop: ${storeProduct.name} (₹${storeProduct.sellingPrice}) ✓`);

      // Immediately broadcast verified store payload
      deviceBridge.send('BARCODE_SCANNED', 'mobile', {
        barcode: storeProduct.barcode || code,
        format,
        productId: storeProduct.id,
        sku: storeProduct.sku,
        name: storeProduct.name,
        brand: storeProduct.brand || '',
        category: storeProduct.category,
        packSize: storeProduct.packSize || '',
        sellingPrice: storeProduct.sellingPrice,
        mrp: storeProduct.mrp ?? storeProduct.sellingPrice,
        currentStock: storeProduct.currentStock,
        baseUnit: storeProduct.baseUnit,
        imageUrl: storeProduct.imageUrl || null,
        timestamp: Date.now(),
        autoRegister: false,
      });

      if (!continuousMode) {
        onClose();
      }
      return;
    }

    // 4B. Free Global Product Lookup (Open Food Facts API & 10,000+ Kirana Master Catalog)
    setLastScannedFeedback('Checking Open Food Facts global catalog...');
    const globalLookup = await lookupGlobalProductCatalogAsync(code, existingShopProducts);
    if (globalLookup.found) {
      setNotFoundAlert(null);
      setIgnoredBarcodeMsg(null);
      isCooldownLockedRef.current = true;
      setCooldownSeconds(1.5);

      if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
      const cooldownStart = Date.now();
      cooldownTimerRef.current = setInterval(() => {
        const elapsed = (Date.now() - cooldownStart) / 1000;
        const remaining = Math.max(0, 1.5 - elapsed);
        setCooldownSeconds(Number(remaining.toFixed(1)));
        if (remaining <= 0) {
          if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
          cooldownTimerRef.current = null;
          isCooldownLockedRef.current = false;
          setCooldownSeconds(0);
        }
      }, 100);

      lastScannedCodeRef.current = code;
      lastScanTimestampRef.current = Date.now();

      // Instant Sensory Confirmation
      playRetailScannerBeep(1850, 75);
      triggerScannerHaptic([45, 25, 45]);

      const record: ScannedRecord = {
        id: `${Date.now()}_${globalLookup.sku || code}`,
        barcode: globalLookup.barcode,
        title: globalLookup.name,
        mrp: globalLookup.sellingPrice,
        time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        source: 'Global Auto-Added',
      };

      setRecentScans((prev) => [record, ...prev.slice(0, 14)]);
      setLastScannedFeedback(`🟢 Auto-Adding & Beaming: ${globalLookup.name} (₹${globalLookup.sellingPrice}) ✓`);

      // Immediately beam auto-registration payload to desktop POS
      deviceBridge.send('BARCODE_SCANNED', 'mobile', {
        barcode: globalLookup.barcode,
        format,
        sku: globalLookup.sku,
        name: globalLookup.name,
        brand: globalLookup.brand,
        imageUrl: globalLookup.imageUrl || null,
        category: globalLookup.category,
        packSize: globalLookup.packSize,
        sellingPrice: globalLookup.sellingPrice,
        mrp: globalLookup.mrp,
        purchasePrice: globalLookup.purchasePrice,
        currentStock: 50,
        baseUnit: globalLookup.baseUnit,
        timestamp: Date.now(),
        autoRegister: true,
      });

      if (!continuousMode) {
        onClose();
      }
      return;
    }

    // 5. Product completely unknown globally (not in local inventory and not in Open Food Facts)
    // Display clean modal on mobile allowing quick manual entry ("Product not in global database. Enter Name & MRP:")
    // rather than injecting fake dummy data.
    playRetailErrorBeep(340, 150);
    triggerScannerHaptic([80, 40, 80]);
    setNotFoundAlert('Product not in global database. Enter Name & MRP.');
    isCooldownLockedRef.current = true;
    setQuickEntryModal({
      isOpen: true,
      barcode: code,
      format: format || 'EAN_13',
      name: '',
      brand: '',
      mrp: '',
      sellingPrice: '',
      category: 'Packaged FMCG',
    });
  };

  const handleQuickManualEntrySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickEntryModal) return;

    const trimmedName = quickEntryModal.name.trim();
    if (!trimmedName) {
      setNotFoundAlert('Please enter the product name.');
      return;
    }

    const mrpNum = parseFloat(quickEntryModal.mrp);
    if (isNaN(mrpNum) || mrpNum <= 0) {
      setNotFoundAlert('Please enter a valid MRP (₹).');
      return;
    }

    const sellingPriceNum = parseFloat(quickEntryModal.sellingPrice) || mrpNum;
    const purchasePriceNum = roundCurrency(sellingPriceNum * 0.85);

    const payload = {
      barcode: quickEntryModal.barcode,
      format: quickEntryModal.format || 'EAN_13',
      sku: `SKU-MAN-${quickEntryModal.barcode.slice(-6)}`,
      name: trimmedName,
      brand: quickEntryModal.brand.trim() || 'General FMCG',
      imageUrl: null,
      category: quickEntryModal.category,
      packSize: 'Standard Pack',
      sellingPrice: sellingPriceNum,
      mrp: mrpNum,
      purchasePrice: purchasePriceNum,
      currentStock: 50,
      baseUnit: 'Piece',
      timestamp: Date.now(),
      autoRegister: true,
    };

    // Immediately beam verified product payload to desktop POS
    await deviceBridge.send('BARCODE_SCANNED', 'mobile', payload);

    playRetailScannerBeep(1850, 75);
    triggerScannerHaptic([45, 25, 45]);

    const record: ScannedRecord = {
      id: `${Date.now()}_${payload.sku}`,
      barcode: quickEntryModal.barcode,
      title: payload.name,
      mrp: payload.sellingPrice,
      time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      source: 'Quick Registered',
    };
    setRecentScans((prev) => [record, ...prev.slice(0, 14)]);
    setLastScannedFeedback(`🟢 Registered & Beamed: ${payload.name} (₹${payload.sellingPrice}) ✓`);
    setNotFoundAlert(null);
    setQuickEntryModal(null);

    // Cooldown lock for 1.5s so scanner doesn't immediately re-trigger
    setTimeout(() => {
      isCooldownLockedRef.current = false;
    }, 1500);

    if (!continuousMode) {
      onClose();
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualCode.trim()) return;
    handleBarcodeDetected(manualCode.trim(), 'MANUAL');
    setManualCode('');
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-white overflow-hidden bhaviq-page-enter"
    >
      {/* Top Header Bar */}
      <header className="px-4 py-3.5 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <BhaviqLogo variant="mark" size="sm" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/50 text-emerald-300 text-[10px] font-bold inline-flex items-center gap-1.5 shadow-xs">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping shrink-0" />
                <span>🟢 Linked &amp; Connected</span>
              </span>
              <h2 className="font-display text-sm font-bold truncate">Mobile Optical Scanner</h2>
            </div>
            <p className="text-[11px] text-slate-400 truncate">
              Connected to <strong className="text-white">{shopName}</strong> terminal
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300"
        >
          <X className="w-5 h-5" />
        </button>
      </header>

      {/* Camera Viewfinder Area */}
      <div className="relative flex-1 bg-black flex items-center justify-center overflow-hidden">
        <video
          ref={videoRef}
          playsInline
          muted
          className="w-full h-full object-cover"
        />

        {/* 3D Aiming Laser & Viewfinder Reticle */}
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          <div
            className={`w-[280px] h-[190px] rounded-2xl border-2 transition-all duration-200 relative shadow-2xl overflow-hidden ${
              cooldownSeconds > 0
                ? 'border-emerald-400 shadow-[0_0_24px_rgba(16,185,129,0.55)] ring-4 ring-emerald-500/20'
                : 'border-indigo-400/90 shadow-2xl'
            }`}
          >
            {/* Viewfinder corner accents */}
            <div
              className={`absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 -mt-1 -ml-1 rounded-tl transition-colors ${
                cooldownSeconds > 0 ? 'border-emerald-300' : 'border-emerald-400'
              }`}
            />
            <div
              className={`absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 -mt-1 -mr-1 rounded-tr transition-colors ${
                cooldownSeconds > 0 ? 'border-emerald-300' : 'border-emerald-400'
              }`}
            />
            <div
              className={`absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 -mb-1 -ml-1 rounded-bl transition-colors ${
                cooldownSeconds > 0 ? 'border-emerald-300' : 'border-emerald-400'
              }`}
            />
            <div
              className={`absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 -mb-1 -mr-1 rounded-br transition-colors ${
                cooldownSeconds > 0 ? 'border-emerald-300' : 'border-emerald-400'
              }`}
            />

            {/* Laser Sweep Bar vs Cooldown Lock Screen */}
            {cooldownSeconds > 0 ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-emerald-950/40 backdrop-blur-[2px]">
                <div className="w-full h-1 bg-emerald-400 shadow-[0_0_14px_#34d399] animate-pulse mb-3" />
                <div className="px-3.5 py-1.5 rounded-full bg-emerald-900/95 border border-emerald-400/80 text-white text-[11px] font-bold flex items-center gap-1.5 shadow-xl">
                  <Lock className="w-3.5 h-3.5 text-emerald-300" />
                  <span>Beamed · Cooldown {cooldownSeconds.toFixed(1)}s</span>
                </div>
              </div>
            ) : (
              <div className="w-full h-0.5 bg-gradient-to-r from-red-500 via-rose-300 to-red-500 shadow-[0_0_12px_#ef4444] animate-[bounce_1.4s_infinite]" />
            )}
          </div>
        </div>

        {/* Product Not Found in Store Inventory Alert Banner */}
        {notFoundAlert && (
          <div className="absolute top-14 inset-x-4 z-30 p-3 rounded-2xl bg-rose-950/95 backdrop-blur-md border border-rose-500/90 text-rose-100 text-xs font-bold flex items-center justify-center gap-2.5 shadow-2xl animate-bounce">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
            <span className="text-center">{notFoundAlert}</span>
          </div>
        )}

        {/* Ignored Non-Product Barcode Alert Banner */}
        {ignoredBarcodeMsg && (
          <div className="absolute top-16 inset-x-4 z-20 p-2.5 rounded-xl bg-amber-950/90 backdrop-blur-md border border-amber-500/80 text-amber-200 text-xs font-semibold flex items-center justify-center gap-2 shadow-2xl animate-fade-in">
            <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="truncate">Ignored Non-Product: {ignoredBarcodeMsg}</span>
          </div>
        )}

        {/* Floating Controls Overlay */}
        <div className="absolute top-4 right-4 flex flex-col gap-2.5 z-10">
          {hasTorch && (
            <button
              type="button"
              onClick={toggleTorch}
              className={`p-3 rounded-2xl backdrop-blur-md border ${
                torchOn
                  ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-lg shadow-amber-500/30'
                  : 'bg-slate-900/80 text-white border-slate-700/80'
              }`}
            >
              {torchOn ? <Flashlight className="w-5 h-5" /> : <FlashlightOff className="w-5 h-5" />}
            </button>
          )}

          <button
            type="button"
            onClick={() => setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'))}
            className="p-3 rounded-2xl bg-slate-900/80 backdrop-blur-md border border-slate-700/80 text-white"
            title="Switch Camera"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>

        {/* Continuous Mode Toggle */}
        <div className="absolute top-4 left-4 z-10">
          <button
            type="button"
            onClick={() => setContinuousMode(!continuousMode)}
            className={`px-3 py-1.5 rounded-full text-xs font-bold backdrop-blur-md border flex items-center gap-1.5 ${
              continuousMode
                ? 'bg-emerald-500/90 text-white border-emerald-400'
                : 'bg-slate-900/80 text-slate-300 border-slate-700'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>{continuousMode ? 'Continuous Scan: ON' : 'Single Scan'}</span>
          </button>
        </div>

        {/* Real-time Feedback Banner */}
        {lastScannedFeedback && (
          <div className="absolute bottom-4 inset-x-4 z-10 p-3 rounded-2xl bg-emerald-950/90 backdrop-blur-md border border-emerald-500/80 text-emerald-200 text-xs font-semibold flex items-center justify-between shadow-xl animate-fade-in">
            <div className="flex items-center gap-2 truncate">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="truncate">{lastScannedFeedback}</span>
            </div>
            <span className="text-[10px] uppercase font-bold bg-emerald-800/80 px-2 py-0.5 rounded-full text-white shrink-0 ml-2">
              Beamed ✓
            </span>
          </div>
        )}

        {errorMsg && (
          <div className="absolute inset-0 bg-slate-950/90 flex flex-col items-center justify-center p-6 text-center space-y-3">
            <Camera className="w-10 h-10 text-rose-400" />
            <p className="text-xs text-rose-300 max-w-xs">{errorMsg}</p>
            <button
              type="button"
              onClick={startCamera}
              className="px-4 py-2 rounded-xl bg-indigo-600 text-xs font-bold text-white"
            >
              Retry Camera
            </button>
          </div>
        )}

        {/* Quick Manual Entry Modal: When barcode is not in store inventory and not in Open Food Facts */}
        {quickEntryModal && (
          <div className="absolute inset-0 z-30 bg-slate-950/95 backdrop-blur-md flex flex-col justify-end p-4 animate-fade-in overflow-y-auto">
            <div className="bg-slate-900 border border-slate-700/80 rounded-2xl p-4 shadow-2xl space-y-3.5 max-w-md mx-auto w-full">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-400">
                    <AlertTriangle className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-white">Product not in global database</h3>
                    <p className="text-[11px] text-slate-400">Enter Name &amp; MRP to beam instantly to POS:</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setQuickEntryModal(null);
                    isCooldownLockedRef.current = false;
                  }}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleQuickManualEntrySubmit} className="space-y-3">
                <div className="p-2 rounded-xl bg-slate-800/60 border border-slate-700/50 flex items-center justify-between">
                  <span className="text-[11px] text-slate-400">Barcode:</span>
                  <span className="text-xs font-mono font-bold text-amber-300">{quickEntryModal.barcode}</span>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    Product Name *
                  </label>
                  <input
                    type="text"
                    required
                    autoFocus
                    value={quickEntryModal.name}
                    onChange={(e) => setQuickEntryModal({ ...quickEntryModal, name: e.target.value })}
                    placeholder="e.g. Amul Gold Milk 500ml, Britannia Good Day"
                    className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-white placeholder-slate-500 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                      MRP (₹) *
                    </label>
                    <input
                      type="number"
                      step="any"
                      required
                      value={quickEntryModal.mrp}
                      onChange={(e) => setQuickEntryModal({ ...quickEntryModal, mrp: e.target.value })}
                      placeholder="e.g. 50"
                      className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-white placeholder-slate-500 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                      Selling Price (₹)
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={quickEntryModal.sellingPrice}
                      onChange={(e) => setQuickEntryModal({ ...quickEntryModal, sellingPrice: e.target.value })}
                      placeholder="Same as MRP if blank"
                      className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-white placeholder-slate-500 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                      Brand (Optional)
                    </label>
                    <input
                      type="text"
                      value={quickEntryModal.brand}
                      onChange={(e) => setQuickEntryModal({ ...quickEntryModal, brand: e.target.value })}
                      placeholder="e.g. Amul, Nestle"
                      className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-white placeholder-slate-500 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                      Category
                    </label>
                    <select
                      value={quickEntryModal.category}
                      onChange={(e) => setQuickEntryModal({ ...quickEntryModal, category: e.target.value as RetailCategory })}
                      className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="Packaged FMCG">Packaged FMCG</option>
                      <option value="Grocery">Grocery</option>
                      <option value="Beverages">Beverages</option>
                      <option value="Personal Care">Personal Care</option>
                      <option value="Household">Household</option>
                      <option value="Grains">Grains</option>
                      <option value="Pulses">Pulses</option>
                      <option value="Loose Products">Loose Products</option>
                    </select>
                  </div>
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setQuickEntryModal(null);
                      isCooldownLockedRef.current = false;
                    }}
                    className="flex-1 px-3 py-2.5 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700 transition"
                  >
                    Cancel / Rescan
                  </button>
                  <button
                    type="submit"
                    className="flex-1 bhaviq-btn-primary px-3 py-2.5 rounded-xl text-xs font-bold text-white shadow-md inline-flex items-center justify-center gap-1.5"
                  >
                    <span>Save &amp; Beam to Cart</span>
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Tray: Manual Barcode Input & Recent Beam Log */}
      <div className="p-4 bg-slate-900 border-t border-slate-800 space-y-3 shrink-0">
        {/* Manual Barcode Form */}
        <form onSubmit={handleManualSubmit} className="flex gap-2">
          <input
            type="text"
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            placeholder="Type or paste barcode number..."
            className="flex-1 px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white placeholder-slate-500 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            type="submit"
            disabled={!manualCode.trim()}
            className="bhaviq-btn-primary px-4 py-2.5 rounded-xl text-xs font-bold disabled:opacity-40 inline-flex items-center gap-1.5"
          >
            <span>Beam</span>
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>

        {/* Recent Scans Micro-Feed */}
        {recentScans.length > 0 && (
          <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1">
            <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400 flex items-center justify-between">
              <span>Recently Beamed to Terminal ({recentScans.length})</span>
              <span>10,000+ SKU Linked</span>
            </div>
            {recentScans.slice(0, 3).map((item) => (
              <div
                key={item.id}
                className="px-3 py-2 rounded-xl bg-slate-800/80 border border-slate-700/60 flex items-center justify-between gap-2 text-xs"
              >
                <div className="truncate min-w-0">
                  <p className="font-semibold text-slate-200 truncate">{item.title}</p>
                  <p className="text-[10px] font-mono text-slate-400">
                    {item.barcode} · {item.source}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <span className="font-bold text-emerald-400">₹{item.mrp}</span>
                  <p className="text-[10px] text-slate-500">{item.time}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
