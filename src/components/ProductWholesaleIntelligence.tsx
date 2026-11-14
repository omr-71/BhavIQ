import React, { useEffect, useMemo, useState } from 'react';
import { EmptyStateCard, FieldLabel, KpiCard, SurfaceCard, TextInput } from './ui';
import { PriceHistorySparkChart } from './Charts';
import { apiRequest } from '../lib/api';
import { formatINR } from '../lib/finance';
import { analyzeProductPricing } from '../lib/pricing';
import type {
  HistoricalPurchaseRatePoint,
  MarketPrice,
  Product,
  ProductWholesaleSummary,
  Shop,
  SupplierQuotation,
} from '../lib/types';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  BadgeIndianRupee,
  Building2,
  CheckCircle2,
  FileText,
  History,
  Layers,
  Plus,
  ShieldCheck,
  Store,
  Tag,
  TrendingUp,
} from 'lucide-react';

export interface ProductWholesaleDossier {
  product: Product;
  summary: ProductWholesaleSummary;
  purchaseHistory: HistoricalPurchaseRatePoint[];
  quotations: SupplierQuotation[];
  marketObservations: MarketPrice[];
  priceRecommendations: Array<{
    id: string;
    historicalLandedCost: number | null;
    replacementLandedCost: number | null;
    currentSellingPrice: number;
    recommendedPrice: number;
    targetMarginPct: number;
    strategy: string;
    alertReason: string;
    status: string;
    approvedByName: string | null;
    approvedAt: string | null;
    createdAt: string;
  }>;
}

export interface ProductWholesaleIntelligenceProps {
  shop: Shop;
  productId: string;
  initialSummary?: ProductWholesaleSummary | null;
  canAddQuote?: boolean;
  backLabel?: string;
  onBack: () => void;
  onOpenQuoteModal?: (productId: string) => void;
  onOpenObsModal?: (productId: string) => void;
  onRefreshAll: () => Promise<void>;
}

function formatDateTimeLabel(value: string | null | undefined): string {
  if (!value) return 'Never recorded';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

export const ProductWholesaleIntelligence: React.FC<ProductWholesaleIntelligenceProps> = ({
  shop,
  productId,
  initialSummary,
  canAddQuote = true,
  backLabel = 'Back to Rate Explorer',
  onBack,
  onOpenQuoteModal,
  onOpenObsModal,
  onRefreshAll,
}) => {
  const [dossier, setDossier] = useState<ProductWholesaleDossier | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [targetMarginPct, setTargetMarginPct] = useState<string>(
    String(shop.defaultMarginPct || 15)
  );
  const [customReplacementOverride, setCustomReplacementOverride] = useState<string>('');
  const [pendingConfirm, setPendingConfirm] = useState<{
    price: number;
    strategy: string;
  } | null>(null);
  const [applyingPrice, setApplyingPrice] = useState(false);
  const [priceMsg, setPriceMsg] = useState<string | null>(null);
  const [priceErr, setPriceErr] = useState<string | null>(null);

  const fetchDossier = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await apiRequest<ProductWholesaleDossier>(
        `/api/shops/${shop.id}/market/products/${productId}`
      );
      setDossier(data);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Unable to load product wholesale rates');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setCustomReplacementOverride('');
    setPendingConfirm(null);
    setPriceMsg(null);
    setPriceErr(null);
    void fetchDossier();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shop.id, productId]);

  const summary = dossier?.summary || initialSummary || null;
  const product = dossier?.product || null;

  const validQuotations = useMemo(
    () =>
      (dossier?.quotations || [])
        .filter((q) => !q.isExpired)
        .sort((a, b) => a.finalLandedCost - b.finalLandedCost),
    [dossier?.quotations]
  );

  const expiredQuotations = useMemo(
    () => (dossier?.quotations || []).filter((q) => q.isExpired),
    [dossier?.quotations]
  );

  const lowestValidQuote = validQuotations[0] || null;

  const pricingAnalysis = useMemo(() => {
    if (!summary) return null;
    const replacement =
      customReplacementOverride !== '' && Number.isFinite(Number(customReplacementOverride))
        ? Number(customReplacementOverride)
        : summary.latestWholesaleRate ?? summary.currentLandedCost;

    return analyzeProductPricing({
      historicalLandedCost: summary.historicalPurchaseRate,
      replacementLandedCost: replacement,
      currentSellingPrice: summary.currentSellingPrice,
      mrp: summary.mrp,
      mrpRestricted: summary.mrpRestricted,
      targetMarginPct: Number(targetMarginPct) || 0,
    });
  }, [summary, customReplacementOverride, targetMarginPct]);

  const chartPoints = useMemo(() => {
    if (!dossier) return [];
    const pts: Array<{ date: string; price: number; label: string }> = [];
    for (const p of dossier.purchaseHistory) {
      pts.push({
        date: p.purchaseDate,
        price: p.landedCostPerBaseUnit,
        label: `Purchase · ${p.supplierName}`,
      });
    }
    for (const q of dossier.quotations) {
      pts.push({
        date: q.quotationDate,
        price: q.finalLandedCost,
        label: `${q.isExpired ? 'Expired quote' : 'Quote'} · ${q.supplierName || 'Supplier'}`,
      });
    }
    for (const m of dossier.marketObservations) {
      if (m.normalizedPerBaseUnit !== null) {
        pts.push({
          date: m.observationDate,
          price: m.normalizedPerBaseUnit,
          label: `Market · ${m.marketName}`,
        });
      }
    }
    return pts.sort((a, b) => a.date.localeCompare(b.date));
  }, [dossier]);

  const handleConfirmPriceUpdate = async () => {
    if (!summary || !pendingConfirm || !pricingAnalysis) return;
    setApplyingPrice(true);
    setPriceErr(null);
    setPriceMsg(null);
    try {
      await apiRequest(`/api/shops/${shop.id}/market/apply-price`, {
        method: 'POST',
        body: JSON.stringify({
          productId: summary.productId,
          newSellingPrice: pendingConfirm.price,
          targetMarginPct: Number(targetMarginPct) || 15,
          strategy: pendingConfirm.strategy,
          replacementLandedCost: pricingAnalysis.replacementLandedCost,
          alertReason: `Owner approved ${pendingConfirm.strategy} pricing scenario in product wholesale view`,
        }),
      });
      setPriceMsg(
        `Selling price updated to ${formatINR(pendingConfirm.price)} / ${summary.baseUnit} with audit trail.`
      );
      setPendingConfirm(null);
      await Promise.all([fetchDossier(), onRefreshAll()]);
    } catch (err) {
      setPriceErr(err instanceof Error ? err.message : 'Unable to update selling price');
    } finally {
      setApplyingPrice(false);
    }
  };

  if (loading && !summary) {
    return (
      <SurfaceCard className="p-6 text-sm text-[var(--text-secondary)]">
        Loading product wholesale intelligence...
      </SurfaceCard>
    );
  }

  if (loadError && !summary) {
    return (
      <EmptyStateCard
        icon={<AlertTriangle className="w-6 h-6" />}
        title="Could not load product wholesale rates"
        description={loadError}
        actionLabel={backLabel}
        onAction={onBack}
      />
    );
  }

  if (!summary) return null;

  const deltaUp = summary.priceDifference !== null && summary.priceDifference > 0;
  const deltaDown = summary.priceDifference !== null && summary.priceDifference < 0;

  const deltaFormatted =
    summary.priceDifference !== null
      ? `${summary.priceDifference > 0 ? '+' : ''}${formatINR(summary.priceDifference)}${
          summary.priceChangePct !== null
            ? ` (${summary.priceChangePct > 0 ? '+' : ''}${summary.priceChangePct.toFixed(1)}%)`
            : ''
        }`
      : '—';

  return (
    <div className="space-y-6 bhaviq-page-enter">
      {/* Top Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 px-3.5 py-2 min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-[var(--bg-surface)] hover:bg-[var(--bg-subtle)] text-xs font-semibold text-[var(--text-primary)] shadow-xs self-start transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>{backLabel}</span>
        </button>

        {(onOpenQuoteModal || onOpenObsModal) && (
          <div className="flex flex-wrap items-center gap-2.5">
            {onOpenQuoteModal && (
              <button
                type="button"
                disabled={!canAddQuote}
                onClick={() => onOpenQuoteModal(summary.productId)}
                className="bhaviq-btn-primary px-4 py-2 min-h-[40px] rounded-xl disabled:opacity-50 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <Plus className="w-4 h-4" />
                <span>Add supplier quote</span>
              </button>
            )}
            {onOpenObsModal && (
              <button
                type="button"
                onClick={() => onOpenObsModal(summary.productId)}
                className="px-4 py-2 min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-[var(--bg-surface)] hover:bg-[var(--bg-subtle)] text-xs font-semibold text-[var(--text-primary)] shadow-xs whitespace-nowrap transition-colors"
              >
                Log market observation
              </button>
            )}
          </div>
        )}
      </div>

      {/* Product Identity & Verification Header Card */}
      <SurfaceCard className="p-6 relative overflow-hidden">
        <div
          aria-hidden="true"
          className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-indigo-500 via-blue-500 to-emerald-500"
        />
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div className="space-y-1.5">
            <h2 className="font-display text-xl md:text-2xl font-bold tracking-tight text-[var(--text-primary)]">
              {summary.productName}
            </h2>
            <p className="text-xs text-[var(--text-secondary)]">
              Brand: <strong className="text-[var(--text-primary)]">{summary.brand || 'Unbranded'}</strong>
              {' · '}Category: <strong className="text-[var(--text-primary)]">{summary.category}</strong>
              {' · '}Pack size: <strong className="text-[var(--text-primary)]">{summary.packSize || 'Standard / Loose'}</strong>
              {' · '}Unit: <strong className="text-[var(--text-primary)]">{summary.baseUnit}</strong>
              {summary.variety ? ` · Variety: ${summary.variety}` : ''}
            </p>
            <p className="text-xs text-[var(--text-muted)]">
              Source: <span className="text-[var(--text-secondary)] font-medium">{summary.sourceLabel}</span>
              {' · '}Last updated: <span className="font-mono-num">{formatDateTimeLabel(summary.lastUpdated)}</span>
              {' · '}Verification:{' '}
              <span className="capitalize font-semibold text-[var(--text-primary)]">
                {summary.verificationStatus.replace(/_/g, ' ')}
              </span>
            </p>
          </div>

          <div className="text-left md:text-right shrink-0">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] block">
              Coverage Status
            </span>
            <span
              className={`text-sm font-bold inline-flex items-center gap-1.5 mt-0.5 ${
                summary.coverageStatus === 'Verified current rate' ||
                summary.coverageStatus === 'Supplier quotation available'
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : summary.coverageStatus === 'Manual observation'
                    ? 'text-indigo-600 dark:text-indigo-400'
                    : summary.coverageStatus === 'Historical rate only'
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-[var(--text-secondary)]'
              }`}
            >
              {(summary.coverageStatus === 'Verified current rate' ||
                summary.coverageStatus === 'Supplier quotation available') && (
                <ShieldCheck className="w-4 h-4 shrink-0" />
              )}
              <span>{summary.coverageStatus}</span>
            </span>
          </div>
        </div>
      </SurfaceCard>

      {/* Complete 8-Card 3D Wholesale Metrics Matrix */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          label="Historical purchase rate"
          value={
            summary.historicalPurchaseRate !== null
              ? `${formatINR(summary.historicalPurchaseRate)}/${summary.baseUnit}`
              : 'Not recorded'
          }
          icon={<History className="w-4 h-4" />}
          accentTop="slate"
          subtext={summary.historicalPurchaseDate ? `Recorded ${summary.historicalPurchaseDate}` : 'No purchase invoice yet'}
        />
        <KpiCard
          label="Latest supplier wholesale"
          value={
            summary.latestSupplierWholesaleRate !== null
              ? `${formatINR(summary.latestSupplierWholesaleRate)}/${summary.baseUnit}`
              : 'No valid quote'
          }
          icon={<Building2 className="w-4 h-4" />}
          accentTop={summary.latestSupplierWholesaleRate !== null ? 'emerald' : 'slate'}
          subtext={summary.latestSupplierName || 'Log supplier quotations below'}
        />
        <KpiCard
          label="Latest available market rate"
          value={
            summary.latestMarketRate !== null
              ? `${formatINR(summary.latestMarketRate)}/${summary.baseUnit}`
              : 'No verified rate'
          }
          icon={<Store className="w-4 h-4" />}
          accentTop={summary.latestMarketRate !== null ? 'indigo' : 'slate'}
          subtext={summary.latestMarketLabel || 'Exact AGMARKNET / market match'}
        />
        <KpiCard
          label="Current landed cost"
          value={
            summary.currentLandedCost !== null
              ? `${formatINR(summary.currentLandedCost)}/${summary.baseUnit}`
              : 'Not recorded'
          }
          icon={<Layers className="w-4 h-4" />}
          accentTop="indigo"
          subtext="Includes freight, tax & discounts"
        />
        <KpiCard
          label="Current selling price"
          value={`${formatINR(summary.currentSellingPrice)}/${summary.baseUnit}`}
          icon={<BadgeIndianRupee className="w-4 h-4" />}
          accentTop="indigo"
          subtext="Active shelf billing price"
        />
        <KpiCard
          label="MRP"
          value={summary.mrp !== null ? `${formatINR(summary.mrp)}/${summary.baseUnit}` : 'Unrestricted'}
          icon={<Tag className="w-4 h-4" />}
          accentTop="slate"
          subtext={summary.mrpRestricted ? 'MRP legal ceiling enforced' : 'Loose / non-MRP item'}
        />
        <KpiCard
          label="Previous wholesale rate"
          value={
            summary.previousWholesaleRate !== null
              ? `${formatINR(summary.previousWholesaleRate)}/${summary.baseUnit}`
              : '—'
          }
          icon={<History className="w-4 h-4" />}
          accentTop="slate"
          subtext="Prior supplier or purchase baseline"
        />
        <KpiCard
          label="Price difference & %"
          value={deltaFormatted}
          icon={
            deltaUp ? (
              <ArrowUpRight className="w-4 h-4" />
            ) : deltaDown ? (
              <ArrowDownRight className="w-4 h-4" />
            ) : (
              <TrendingUp className="w-4 h-4" />
            )
          }
          accentTop={deltaUp ? 'rose' : deltaDown ? 'emerald' : 'slate'}
          tone={deltaUp ? 'danger' : deltaDown ? 'positive' : 'neutral'}
          subtext="Change vs previous wholesale rate"
        />
      </div>

      {/* Multi-Supplier Landed Cost Comparison */}
      <SurfaceCard className="p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="font-display text-base font-bold text-[var(--text-primary)]">
              Multi-Supplier Wholesale Comparison
            </h3>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              Ranked strictly by lowest valid final landed cost per {summary.baseUnit}. Expired quotations are excluded from active rates.
            </p>
          </div>
          {lowestValidQuote && (
            <div className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4" />
              <span>
                Lowest valid landed: {lowestValidQuote.supplierName} ({formatINR(lowestValidQuote.finalLandedCost)}/{summary.baseUnit})
              </span>
            </div>
          )}
        </div>

        {validQuotations.length === 0 && expiredQuotations.length === 0 ? (
          <div className="p-6 rounded-xl border border-dashed border-slate-200 dark:border-slate-700/70 bg-slate-50/50 dark:bg-slate-900/30 text-center space-y-2">
            <p className="text-sm font-semibold text-[var(--text-primary)]">
              No supplier quotations logged for this product yet
            </p>
            <p className="text-xs text-[var(--text-muted)] max-w-md mx-auto">
              Record quotations from multiple suppliers with discount, GST, freight, and validity date to compare real landed costs without mixing brands or pack sizes.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {validQuotations.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border-hairline)] text-[var(--text-muted)]">
                      <th className="py-2.5 px-3 font-semibold">Supplier</th>
                      <th className="py-2.5 px-3 font-semibold">Brand / Pack / Qty</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Wholesale Rate</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Discount</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Tax</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Freight + Extra</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Final Landed / {summary.baseUnit}</th>
                      <th className="py-2.5 px-3 font-semibold">Validity & Evidence</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-hairline)]">
                    {validQuotations.map((q) => {
                      const isLowest = lowestValidQuote?.id === q.id;
                      return (
                        <tr
                          key={q.id}
                          className={
                            isLowest
                              ? 'bg-emerald-50/70 dark:bg-emerald-950/25'
                              : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/40'
                          }
                        >
                          <td className="py-3 px-3">
                            <p className="font-semibold text-[var(--text-primary)]">
                              {q.supplierName}
                            </p>
                            <p className="text-[11px] text-[var(--text-muted)] capitalize">
                              {q.verificationStatus.replace(/_/g, ' ')}
                              {isLowest ? ' · Lowest valid landed' : ''}
                            </p>
                          </td>
                          <td className="py-3 px-3 text-[var(--text-secondary)]">
                            {[q.brand || 'Unbranded', q.packSize || 'Standard', `${q.quantity} ${q.unit}`].join(' · ')}
                          </td>
                          <td className="py-3 px-3 font-mono-num text-right">
                            {formatINR(q.quotedRate)}/{q.unit}
                          </td>
                          <td className="py-3 px-3 font-mono-num text-right text-emerald-600 dark:text-emerald-400">
                            {q.discountAmount > 0 ? `-${formatINR(q.discountAmount)}` : '—'}
                          </td>
                          <td className="py-3 px-3 font-mono-num text-right">
                            {q.taxAmount > 0 ? formatINR(q.taxAmount) : '—'}
                          </td>
                          <td className="py-3 px-3 font-mono-num text-right">
                            {formatINR(q.freightEstimatePerUnit + q.additionalCosts)}
                          </td>
                          <td className="py-3 px-3 font-mono-num text-right font-bold text-[var(--text-primary)]">
                            {formatINR(q.finalLandedCost)}/{summary.baseUnit}
                          </td>
                          <td className="py-3 px-3">
                            <p className="font-mono-num text-[var(--text-secondary)]">
                              Quoted {q.quotationDate}
                              {q.validUntil ? ` · Valid till ${q.validUntil}` : ' · No expiry set'}
                            </p>
                            {q.sourceEvidence && (
                              <p className="text-[11px] text-indigo-600 dark:text-indigo-400 inline-flex items-center gap-1 mt-0.5">
                                <FileText className="w-3 h-3" />
                                <span>{q.sourceEvidence.startsWith('data:') ? 'Uploaded quotation file' : q.sourceEvidence}</span>
                              </p>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {expiredQuotations.length > 0 && (
              <div className="pt-3 border-t border-[var(--border-hairline)] space-y-2">
                <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                  Expired Quotations Preserved in History ({expiredQuotations.length}) — Not Used as Current Rate
                </p>
                <div className="divide-y divide-[var(--border-hairline)] text-xs">
                  {expiredQuotations.map((q) => (
                    <div
                      key={q.id}
                      className="py-2.5 flex flex-wrap items-center justify-between gap-2 opacity-75"
                    >
                      <div>
                        <span className="font-semibold text-[var(--text-primary)]">
                          {q.supplierName}
                        </span>
                        <span className="text-[var(--text-muted)] ml-2">
                          Quoted {q.quotationDate} · Expired {q.validUntil} · {q.quantity} {q.unit}
                        </span>
                      </div>
                      <span className="font-mono-num font-semibold text-[var(--text-secondary)]">
                        {formatINR(q.finalLandedCost)}/{summary.baseUnit} (Expired)
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </SurfaceCard>

      {/* Price Trend + Matched Market Rates + Price Intelligence Calculator */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <SurfaceCard className="lg:col-span-5 p-6 space-y-4">
          <div>
            <h3 className="font-display text-sm font-bold text-[var(--text-primary)]">
              Historical Price Trajectory
            </h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Combines recorded purchase landed costs, supplier quotes, and matched market rates.
            </p>
          </div>
          <PriceHistorySparkChart points={chartPoints} />

          <div className="pt-3 border-t border-[var(--border-hairline)] space-y-2">
            <h4 className="text-xs font-semibold text-[var(--text-secondary)]">
              Historical Purchase Invoices ({dossier?.purchaseHistory.length || 0})
            </h4>
            {!dossier || dossier.purchaseHistory.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">
                No purchase bill items recorded yet.{product?.landedCost ? ` Initial landed cost: ${formatINR(product.landedCost)}/${summary.baseUnit}.` : ''}
              </p>
            ) : (
              <div className="divide-y divide-[var(--border-hairline)] text-xs max-h-48 overflow-y-auto">
                {dossier.purchaseHistory.map((ph) => (
                  <div key={`${ph.purchaseId}-${ph.purchaseDate}`} className="py-2.5 flex justify-between gap-2">
                    <div>
                      <p className="font-semibold text-[var(--text-primary)]">{ph.supplierName}</p>
                      <p className="text-[11px] text-[var(--text-muted)]">
                        {ph.purchaseDate} · {ph.quantity} {ph.unitName} @ {formatINR(ph.purchaseRate)}
                        {ph.invoiceNo ? ` · Inv ${ph.invoiceNo}` : ''}
                      </p>
                    </div>
                    <span className="font-mono-num font-bold shrink-0">
                      {formatINR(ph.landedCostPerBaseUnit)}/{summary.baseUnit}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </SurfaceCard>

        {/* Price Intelligence Calculator */}
        <SurfaceCard className="lg:col-span-7 p-6 space-y-5">
          <div>
            <h3 className="font-display text-base font-bold text-[var(--text-primary)]">
              Product Price Intelligence Calculator
            </h3>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              Compares historical purchase landed cost vs replacement landed cost. All calculations respect MRP ceilings and require owner approval.
            </p>
          </div>

          {priceMsg && (
            <div className="px-4 py-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs font-medium text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{priceMsg}</span>
            </div>
          )}
          {priceErr && (
            <div className="px-4 py-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs font-medium text-rose-700 dark:text-rose-300">
              {priceErr}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <FieldLabel htmlFor="detail-margin">Balanced target margin (%)</FieldLabel>
              <TextInput
                id="detail-margin"
                type="number"
                min="0"
                max="95"
                step="0.5"
                value={targetMarginPct}
                onChange={(e) => setTargetMarginPct(e.target.value)}
              />
            </div>
            <div>
              <FieldLabel htmlFor="detail-repl-override">
                Replacement cost override (₹/{summary.baseUnit})
              </FieldLabel>
              <TextInput
                id="detail-repl-override"
                type="number"
                min="0"
                step="0.01"
                value={customReplacementOverride}
                onChange={(e) => setCustomReplacementOverride(e.target.value)}
                placeholder={
                  summary.latestWholesaleRate !== null
                    ? `${summary.latestWholesaleRate.toFixed(2)} (Auto)`
                    : 'Enter test cost'
                }
              />
            </div>
          </div>

          {pricingAnalysis && (
            <>
              {pricingAnalysis.warnings.length > 0 && (
                <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/35 border border-rose-200 dark:border-rose-800 space-y-1">
                  {pricingAnalysis.warnings.map((w, idx) => (
                    <p key={idx} className="text-xs font-semibold text-rose-700 dark:text-rose-300">
                      {w}
                    </p>
                  ))}
                </div>
              )}

              {/* Explained Economics Strip (Clean Divider Layout) */}
              <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-[var(--border-hairline)] rounded-xl border border-[var(--border-hairline)] bg-slate-50/70 dark:bg-slate-900/40 text-xs">
                <div className="p-4 space-y-1">
                  <span className="text-[var(--text-muted)] font-medium block">Historical Gross Profit</span>
                  <span className="font-mono-num text-base font-bold text-[var(--text-primary)] block">
                    {pricingAnalysis.historicalGrossProfitPerUnit !== null
                      ? `${formatINR(pricingAnalysis.historicalGrossProfitPerUnit)}/${summary.baseUnit}`
                      : 'Not enough data'}
                  </span>
                  <span className="text-[11px] text-[var(--text-secondary)] block leading-snug">
                    {pricingAnalysis.historicalLandedCost !== null
                      ? `Selling ${formatINR(pricingAnalysis.currentSellingPrice)} − Historical ${formatINR(pricingAnalysis.historicalLandedCost)} (${pricingAnalysis.historicalMarginPct?.toFixed(1)}%)`
                      : 'Record a purchase to compute historical profit.'}
                  </span>
                </div>

                <div className="p-4 space-y-1">
                  <span className="text-[var(--text-muted)] font-medium block">Replacement-Cost Diff</span>
                  <span
                    className={`font-mono-num text-base font-bold block ${
                      pricingAnalysis.isSellingBelowReplacementCost
                        ? 'text-rose-600 dark:text-rose-400'
                        : 'text-emerald-600 dark:text-emerald-400'
                    }`}
                  >
                    {pricingAnalysis.replacementCostDiffPerUnit !== null
                      ? `${formatINR(pricingAnalysis.replacementCostDiffPerUnit)}/${summary.baseUnit}`
                      : 'Unavailable'}
                  </span>
                  <span className="text-[11px] text-[var(--text-secondary)] block leading-snug">
                    {pricingAnalysis.replacementLandedCost !== null
                      ? `Selling ${formatINR(pricingAnalysis.currentSellingPrice)} − Replacement ${formatINR(pricingAnalysis.replacementLandedCost)} (${pricingAnalysis.replacementMarginPct?.toFixed(1)}%)`
                      : 'Add a valid supplier quote or market rate.'}
                  </span>
                </div>

                <div className="p-4 space-y-1">
                  <span className="text-[var(--text-muted)] font-medium block">Break-Even Price</span>
                  <span className="font-mono-num text-base font-bold text-[var(--text-primary)] block">
                    {pricingAnalysis.breakEvenSellingPrice !== null
                      ? `${formatINR(pricingAnalysis.breakEvenSellingPrice)}/${summary.baseUnit}`
                      : 'Unavailable'}
                  </span>
                  <span className="text-[11px] text-[var(--text-secondary)] block leading-snug">
                    {pricingAnalysis.breakEvenSellingPrice !== null
                      ? `Minimum 0% margin floor = Replacement landed cost`
                      : 'Awaiting verified replacement cost.'}
                  </span>
                </div>
              </div>

              {/* 3 Scenarios */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                {pricingAnalysis.scenarios.map((sc) => (
                  <div
                    key={sc.label}
                    className="p-4 rounded-xl border border-[var(--border-hairline)] bg-slate-50/50 dark:bg-slate-900/30 flex flex-col justify-between gap-3"
                  >
                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-[var(--text-secondary)]">
                        {sc.label} ({sc.targetMarginPct}% margin)
                      </p>
                      <p className="font-mono-num text-lg font-bold text-[var(--text-primary)]">
                        {sc.suggestedPrice !== null ? formatINR(sc.suggestedPrice) : 'Unavailable'}
                      </p>
                      {sc.suggestedPrice !== null && pricingAnalysis.replacementLandedCost !== null && (
                        <p className="text-[11px] text-[var(--text-muted)] leading-snug">
                          Formula: {formatINR(pricingAnalysis.replacementLandedCost)} ÷ (1 −{' '}
                          {(sc.targetMarginPct / 100).toFixed(2)}) ={' '}
                          <span className="font-mono-num">{formatINR(sc.uncappedPrice)}</span>
                          {sc.cappedByMrp && ` → Capped at MRP ${formatINR(summary.mrp)}`}
                        </p>
                      )}
                      {sc.profitPerUnit !== null && (
                        <p className="text-[11px] font-mono-num text-[var(--text-secondary)]">
                          Net margin: {sc.resultingMarginPct?.toFixed(1)}% ·{' '}
                          <span className="whitespace-nowrap font-semibold text-emerald-600 dark:text-emerald-400">
                            {sc.profitPerUnit >= 0 ? '+' : ''}
                            {formatINR(sc.profitPerUnit)}/{summary.baseUnit}
                          </span>
                        </p>
                      )}
                    </div>

                    <button
                      type="button"
                      disabled={sc.suggestedPrice === null || applyingPrice}
                      onClick={() =>
                        sc.suggestedPrice !== null &&
                        setPendingConfirm({ price: sc.suggestedPrice, strategy: sc.label })
                      }
                      className="bhaviq-btn-primary w-full min-h-[38px] rounded-xl disabled:opacity-40 text-xs font-semibold"
                    >
                      Select & approve
                    </button>
                  </div>
                ))}
              </div>

              {pendingConfirm && (
                <div className="p-4 rounded-xl bg-indigo-50/90 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="text-xs space-y-0.5">
                    <p className="font-semibold text-[var(--text-primary)]">
                      Owner Approval Required: Update selling price to {formatINR(pendingConfirm.price)} / {summary.baseUnit}?
                    </p>
                    <p className="text-[var(--text-secondary)]">
                      Scenario: {pendingConfirm.strategy} · Previous shelf price: {formatINR(summary.currentSellingPrice)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setPendingConfirm(null)}
                      className="px-3.5 py-2 min-h-[36px] rounded-xl border border-slate-200 dark:border-slate-700 bg-[var(--bg-surface)] text-xs font-semibold"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={applyingPrice}
                      onClick={handleConfirmPriceUpdate}
                      className="bhaviq-btn-primary px-4 py-2 min-h-[36px] rounded-xl text-xs font-semibold"
                    >
                      {applyingPrice ? 'Updating...' : 'Confirm price update'}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </SurfaceCard>
      </div>

      {/* Matched AGMARKNET / Market Observations */}
      <SurfaceCard className="p-6 space-y-3">
        <h3 className="font-display text-sm font-bold text-[var(--text-primary)]">
          Matched Official AGMARKNET & Owner-Observed Market Rates
        </h3>
        {!dossier || dossier.marketObservations.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]">
            No verified market rate matched for this product ({summary.category}
            {summary.packSize ? `, ${summary.packSize}` : ''}). Packaged FMCG products are not matched to agricultural mandis; log supplier quotations or manual local observations above.
          </p>
        ) : (
          <div className="divide-y divide-[var(--border-hairline)] text-xs">
            {dossier.marketObservations.map((m) => (
              <div key={m.id} className="py-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-semibold text-[var(--text-primary)]">
                    {m.commodityOrProductName}
                    {m.brand ? ` (${m.brand})` : ''}
                  </span>
                  <span className="text-[var(--text-muted)] ml-2">
                    {m.marketName} · {m.location} · {m.observationDate} · {m.sourceName}
                  </span>
                </div>
                <div className="font-mono-num font-bold text-right">
                  {formatINR(m.modalPrice)} ({m.priceUnitBasis})
                  {m.normalizedPerBaseUnit !== null && (
                    <span className="text-indigo-600 dark:text-indigo-400 ml-2">
                      = {formatINR(m.normalizedPerBaseUnit)}/{summary.baseUnit}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </SurfaceCard>
    </div>
  );
};
