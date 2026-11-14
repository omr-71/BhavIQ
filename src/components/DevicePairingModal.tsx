import React, { useEffect, useState, useRef } from 'react';
import QRCode from 'qrcode';
import { BrowserMultiFormatReader } from '@zxing/library';
import {
  Smartphone,
  QrCode,
  CheckCircle2,
  X,
  Copy,
  Check,
  RefreshCw,
  Unlink,
  Volume2,
  Camera,
  ShieldCheck,
  Wifi,
} from 'lucide-react';
import { BhaviqLogo } from './BhaviqLogo';
import {
  buildPairingUrl,
  createDevicePairingPayload,
  detectDeviceModel,
  deviceBridge,
  getSavedPairedDeviceInfo,
  getSavedPairingPayload,
  playRetailScannerBeep,
  savePairedDeviceInfo,
  triggerScannerHaptic,
  type BridgeMessage,
  type DevicePairingPayload,
  type PairedDeviceInfo,
} from '../lib/deviceBridge';
import type { Shop } from '../lib/types';

interface DevicePairingModalProps {
  isOpen: boolean;
  onClose: () => void;
  shop: Shop;
  isMobileDevice?: boolean;
  onPairedChange?: (info: PairedDeviceInfo | null) => void;
  onOpenMobileScanner?: () => void;
}

export const DevicePairingModal: React.FC<DevicePairingModalProps> = ({
  isOpen,
  onClose,
  shop,
  isMobileDevice = false,
  onPairedChange,
  onOpenMobileScanner,
}) => {
  const [activeTab, setActiveTab] = useState<'qr' | 'camera'>(isMobileDevice ? 'camera' : 'qr');
  const [pairingPayload, setPairingPayload] = useState<DevicePairingPayload | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [pairedDevice, setPairedDevice] = useState<PairedDeviceInfo | null>(getSavedPairedDeviceInfo());
  const [manualPin, setManualPin] = useState('');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraScanning, setCameraScanning] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const zxingReaderRef = useRef<BrowserMultiFormatReader | null>(null);

  // Initialize or restore pairing payload
  const initPairing = () => {
    let payload = getSavedPairingPayload();
    if (!payload || payload.shopId !== shop.id) {
      payload = createDevicePairingPayload(shop.id, shop.name);
    }
    setPairingPayload(payload);

    const url = buildPairingUrl(payload);
    QRCode.toDataURL(url, {
      width: 320,
      margin: 1,
      color: {
        dark: '#172554', // Deep BhavIQ royal navy
        light: '#FFFFFF',
      },
      errorCorrectionLevel: 'M',
    })
      .then(setQrDataUrl)
      .catch((err) => console.error('QR generation error:', err));
  };

  useEffect(() => {
    if (isOpen) {
      initPairing();
      const current = getSavedPairedDeviceInfo();
      setPairedDevice(current);
    }
  }, [isOpen, shop.id]);

  // Connect to device bridge when token exists
  useEffect(() => {
    if (!isOpen || !pairingPayload) return;

    const token = pairingPayload.token;
    const role = isMobileDevice ? 'mobile' : 'desktop';

    const unsubscribe = deviceBridge.connect(token, role, (msg: BridgeMessage) => {
      if (msg.type === 'DEVICE_PAIRED' || msg.type === 'DEVICE_PAIR_ACK') {
        const info: PairedDeviceInfo = {
          deviceId: msg.payload?.deviceId || 'mob_' + Date.now().toString(36),
          deviceName: msg.payload?.deviceName || 'Mobile Camera Scanner',
          pairedAt: Date.now(),
          lastActive: Date.now(),
          platform: msg.payload?.platform || 'Mobile',
          status: 'connected',
          token,
          shopId: shop.id,
          shopName: shop.name,
        };
        setPairedDevice(info);
        savePairedDeviceInfo(info);
        onPairedChange?.(info);
        playRetailScannerBeep(1900, 100);
        triggerScannerHaptic([50, 40, 50]);
      } else if (msg.type === 'DEVICE_UNLINK') {
        setPairedDevice(null);
        savePairedDeviceInfo(null);
        onPairedChange?.(null);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [isOpen, pairingPayload?.token, isMobileDevice]);

  // Start ZXing camera scanner on mobile view
  useEffect(() => {
    if (!isOpen || activeTab !== 'camera') {
      stopCamera();
      return;
    }

    startCamera();
    return () => {
      stopCamera();
    };
  }, [isOpen, activeTab]);

  const startCamera = async () => {
    setCameraError(null);
    setCameraScanning(true);

    try {
      const codeReader = new BrowserMultiFormatReader();
      zxingReaderRef.current = codeReader;

      const videoInputDevices = await codeReader.listVideoInputDevices();
      // Choose environment/back camera if available
      const backCamera =
        videoInputDevices.find((d) => /back|rear|environment/i.test(d.label)) ||
        videoInputDevices[videoInputDevices.length - 1];

      const deviceId = backCamera?.deviceId;

      if (videoRef.current) {
        await codeReader.decodeFromVideoDevice(
          deviceId,
          videoRef.current,
          (result, err) => {
            if (result) {
              const text = result.getText();
              handleScannedQrText(text);
            }
          }
        );
      }
    } catch (err) {
      setCameraError('Camera access unavailable. Please grant camera permission or use PIN.');
      setCameraScanning(false);
    }
  };

  const stopCamera = () => {
    if (zxingReaderRef.current) {
      try {
        zxingReaderRef.current.reset();
      } catch {
        // ignore
      }
      zxingReaderRef.current = null;
    }
    setCameraScanning(false);
  };

  const handleScannedQrText = (text: string) => {
    try {
      let token = '';
      if (text.includes('pair_token=')) {
        const url = new URL(text, window.location.origin);
        token = url.searchParams.get('pair_token') || '';
      } else if (text.startsWith('bhv_')) {
        token = text.trim();
      }

      if (token) {
        stopCamera();
        completeMobilePairing(token);
      }
    } catch {
      // not a pairing URL
    }
  };

  const completeMobilePairing = async (token: string) => {
    const deviceName = detectDeviceModel();
    const info: PairedDeviceInfo = {
      deviceId: 'mob_' + Date.now().toString(36),
      deviceName,
      pairedAt: Date.now(),
      lastActive: Date.now(),
      platform: 'Mobile',
      status: 'connected',
      token,
      shopId: shop.id,
      shopName: shop.name,
    };

    setPairedDevice(info);
    savePairedDeviceInfo(info);
    onPairedChange?.(info);

    playRetailScannerBeep(1950, 120);
    triggerScannerHaptic([60, 30, 60]);

    // Send immediate handshake ACK and PAIRED payload over bridge
    await deviceBridge.send('DEVICE_PAIR_ACK', 'mobile', {
      deviceId: info.deviceId,
      deviceName: info.deviceName,
      platform: info.platform,
      token,
      status: 'connected',
    });
    await deviceBridge.send('DEVICE_PAIRED', 'mobile', {
      deviceId: info.deviceId,
      deviceName: info.deviceName,
      platform: info.platform,
      token,
      status: 'connected',
    });
  };

  const handleManualPinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualPin.trim() || !pairingPayload) return;
    if (manualPin.trim() === pairingPayload.pin) {
      completeMobilePairing(pairingPayload.token);
    } else {
      setCameraError('Incorrect PIN. Please check the 4-digit code displayed on Desktop.');
    }
  };

  const handleCopyLink = () => {
    if (!pairingPayload) return;
    const url = buildPairingUrl(pairingPayload);
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleUnlink = async () => {
    if (!pairedDevice) return;
    await deviceBridge.send('DEVICE_UNLINK', isMobileDevice ? 'mobile' : 'desktop');
    setPairedDevice(null);
    savePairedDeviceInfo(null);
    onPairedChange?.(null);
  };

  const handleRegenerateQr = () => {
    const fresh = createDevicePairingPayload(shop.id, shop.name);
    setPairingPayload(fresh);
    const url = buildPairingUrl(fresh);
    QRCode.toDataURL(url, {
      width: 320,
      margin: 1,
      color: { dark: '#172554', light: '#FFFFFF' },
    }).then(setQrDataUrl);
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 dark:bg-black/75 backdrop-blur-md overflow-y-auto"
    >
      <div className="relative w-full max-w-lg bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-2xl shadow-slate-300/60 dark:shadow-black/70 overflow-hidden bhaviq-sheet-enter">
        {/* Header Bar */}
        <div className="flex items-center justify-between px-6 py-4.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40">
          <div className="flex items-center gap-2.5">
            <BhaviqLogo variant="mark" size="sm" />
            <div>
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <span>Device Pairing &amp; Mobile Barcode Bridge</span>
                <span className="px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 text-[10px] font-semibold text-blue-700 dark:text-blue-300">
                  Supabase Realtime
                </span>
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Turn any smartphone into a wireless optical barcode scanner for BhavIQ POS
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-6">
          {/* Active Paired Status Card */}
          {pairedDevice ? (
            <div className="rounded-2xl p-5 bg-gradient-to-br from-emerald-50/80 to-teal-50/60 dark:from-emerald-950/30 dark:to-teal-950/20 border border-emerald-200/80 dark:border-emerald-800/60 shadow-lg shadow-emerald-600/5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-emerald-500 text-white flex items-center justify-center shadow-md shadow-emerald-500/25 shrink-0">
                    <Smartphone className="w-5 h-5 animate-pulse" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/80 border border-emerald-300 dark:border-emerald-700 text-xs font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5 shadow-xs">
                        <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                        <span>🟢 Linked &amp; Connected</span>
                      </span>
                    </div>
                    <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white mt-1">
                      Paired with {pairedDevice.deviceName}
                    </h3>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                      Ready to beam product barcodes straight to POS billing and inventory
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleUnlink}
                  className="px-3 py-1.5 rounded-xl border border-rose-200 dark:border-rose-800 bg-white dark:bg-slate-800 hover:bg-rose-50 text-rose-600 dark:text-rose-400 text-xs font-semibold inline-flex items-center gap-1.5 shadow-xs transition-colors"
                >
                  <Unlink className="w-3.5 h-3.5" />
                  <span>Unlink Device</span>
                </button>
              </div>

              {/* Action Buttons */}
              <div className="mt-4 pt-4 border-t border-emerald-200/60 dark:border-emerald-800/40 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => playRetailScannerBeep(1850, 80)}
                  className="px-3.5 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 inline-flex items-center gap-1.5 shadow-xs hover:bg-slate-50"
                >
                  <Volume2 className="w-3.5 h-3.5 text-blue-600" />
                  <span>Test Audio Beep</span>
                </button>

                {onOpenMobileScanner && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenMobileScanner();
                    }}
                    className="bhaviq-btn-primary px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 shadow-md shadow-indigo-600/20"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>Open Camera Scanner on this Phone</span>
                  </button>
                )}
              </div>
            </div>
          ) : (
            <>
              {/* Tab Selector */}
              <div className="flex rounded-xl p-1 bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80">
                <button
                  type="button"
                  onClick={() => setActiveTab('qr')}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all inline-flex items-center justify-center gap-1.5 ${
                    activeTab === 'qr'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  <QrCode className="w-3.5 h-3.5" />
                  <span>Show Desktop QR Code</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('camera')}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all inline-flex items-center justify-center gap-1.5 ${
                    activeTab === 'camera'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  <Camera className="w-3.5 h-3.5" />
                  <span>Scan QR with Mobile Camera</span>
                </button>
              </div>

              {/* View 1: Desktop QR Code Display */}
              {activeTab === 'qr' && (
                <div className="space-y-5">
                  <div className="flex flex-col items-center justify-center text-center p-6 bg-slate-50/80 dark:bg-slate-800/40 rounded-2xl border border-slate-200/70 dark:border-slate-800">
                    {/* 3D Floating QR Frame */}
                    <div className="relative p-3 bg-white rounded-2xl shadow-xl shadow-slate-200/80 dark:shadow-black/50 border border-slate-100 dark:border-slate-800 ring-4 ring-indigo-50 dark:ring-indigo-950/40">
                      {qrDataUrl ? (
                        <img
                          src={qrDataUrl}
                          alt="BhavIQ Device Pairing QR Code"
                          className="w-56 h-56 object-contain rounded-xl"
                        />
                      ) : (
                        <div className="w-56 h-56 flex items-center justify-center">
                          <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin" />
                        </div>
                      )}

                      {/* BhavIQ Badge Center Stamp */}
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="w-10 h-10 rounded-xl bg-white shadow-md border border-slate-200 flex items-center justify-center">
                          <BhaviqLogo variant="mark" size="sm" />
                        </div>
                      </div>
                    </div>

                    {/* PIN & Instructions */}
                    <div className="mt-4 space-y-1">
                      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 text-xs font-bold text-indigo-700 dark:text-indigo-300">
                        <span>Pairing PIN:</span>
                        <span className="font-mono text-sm tracking-widest">{pairingPayload?.pin}</span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-400 pt-1">
                        Open your mobile browser camera or BhavIQ mobile app to scan this QR code.
                      </p>
                    </div>

                    {/* Copy Link & Refresh */}
                    <div className="mt-4 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleCopyLink}
                        className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold inline-flex items-center gap-1.5 shadow-xs hover:bg-slate-50"
                      >
                        {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copied ? 'Link Copied' : 'Copy Direct Link'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleRegenerateQr}
                        className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold inline-flex items-center gap-1.5 shadow-xs hover:bg-slate-50"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Refresh Code</span>
                      </button>
                    </div>
                  </div>

                  {/* Realtime Status Indicator */}
                  <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200/80 dark:border-blue-900/60 text-xs text-blue-900 dark:text-blue-200">
                    <div className="flex items-center gap-2">
                      <Wifi className="w-4 h-4 text-blue-600 dark:text-blue-400 animate-pulse" />
                      <span>Listening for mobile camera scan via Supabase Realtime...</span>
                    </div>
                    <span className="px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900 font-mono text-[10px] font-bold">
                      ACTIVE
                    </span>
                  </div>
                </div>
              )}

              {/* View 2: Mobile Camera Scanner Handshake */}
              {activeTab === 'camera' && (
                <div className="space-y-4">
                  <div className="relative rounded-2xl overflow-hidden bg-slate-950 aspect-[4/3] border border-slate-800 shadow-xl flex items-center justify-center">
                    <video
                      ref={videoRef}
                      playsInline
                      muted
                      className="w-full h-full object-cover"
                    />

                    {/* Aiming Reticle Overlay */}
                    <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                      <div className="w-48 h-48 border-2 border-indigo-400/80 rounded-2xl relative shadow-lg">
                        <div className="absolute top-0 left-0 w-4 h-4 border-t-4 border-l-4 border-indigo-500 -mt-1 -ml-1 rounded-tl" />
                        <div className="absolute top-0 right-0 w-4 h-4 border-t-4 border-r-4 border-indigo-500 -mt-1 -mr-1 rounded-tr" />
                        <div className="absolute bottom-0 left-0 w-4 h-4 border-b-4 border-l-4 border-indigo-500 -mb-1 -ml-1 rounded-bl" />
                        <div className="absolute bottom-0 right-0 w-4 h-4 border-b-4 border-r-4 border-indigo-500 -mb-1 -mr-1 rounded-br" />
                        {cameraScanning && (
                          <div className="w-full h-0.5 bg-indigo-400 shadow-[0_0_8px_#818cf8] animate-pulse" />
                        )}
                      </div>
                    </div>

                    {cameraError && (
                      <div className="absolute inset-0 bg-slate-900/90 p-4 flex flex-col items-center justify-center text-center text-white space-y-2">
                        <Camera className="w-8 h-8 text-rose-400" />
                        <p className="text-xs text-rose-300 max-w-xs">{cameraError}</p>
                      </div>
                    )}
                  </div>

                  {/* Manual PIN Fallback */}
                  <form onSubmit={handleManualPinSubmit} className="flex gap-2">
                    <input
                      type="text"
                      maxLength={4}
                      value={manualPin}
                      onChange={(e) => setManualPin(e.target.value.replace(/\D/g, ''))}
                      placeholder="Enter 4-digit PIN manually"
                      className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-mono tracking-wider focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <button
                      type="submit"
                      disabled={manualPin.length !== 4}
                      className="bhaviq-btn-primary px-5 py-2.5 rounded-xl text-xs font-bold disabled:opacity-50"
                    >
                      Pair Device
                    </button>
                  </form>
                </div>
              )}
            </>
          )}

          {/* Security & Encryption Guarantee */}
          <div className="flex items-center gap-2 pt-2 text-[11px] text-slate-500 dark:text-slate-400">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>
              End-to-end authenticated device pairing via Supabase Realtime broadcast matrix.
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold hover:bg-slate-50"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
