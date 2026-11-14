import React from 'react';
import { formatINR } from '../lib/finance';
import type { PriceAlert } from '../lib/types';
import {
  ArrowRight,
  Check,
  RotateCcw,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';

interface MarketAlertCardProps {
  alert: PriceAlert;
  compact?: boolean;
  acknowledging?: boolean;
  onViewSku?: (alert: PriceAlert) => void;
  onOpenCalculator?: (alert: PriceAlert) => void;
  onAcknowledge?: (alertId: string) => void;
  onRestore?: (alertId: string) => void;
}

export const MarketAlertCard: React.FC<MarketAlertCardProps> = ({
  alert,
  compact = false,
  acknowledging = false,
  onViewSku,
  onOpenCalculator,
  onAcknowledge,
  onRestore,
}) => {
  const isOpportunity = alert.severity === 'opportunity' || alert.movementDirection === 'down';
  const isCritical = alert.severity === 'critical';

  const accentBorderClass = isOpportunity
    ? 'border-l-4 border-l-emerald-500'
    : isCritical
      ? 'border-l-4 border-l-rose-500'
      : 'border-l-4 border-l-amber-500';

  const badgeClass = isOpportunity
    ? 'bg-green-100 dark:bg-emerald-950/70 text-green-700 dark:text-emerald-300 border border-green-200 dark:border-emerald-800/60 shadow-xs shadow-green-500/10'
    : isCritical
      ? 'bg-red-100 dark:bg-rose-950/70 text-red-700 dark:text-rose-300 border border-red-200 dark:border-rose-800/60 shadow-xs shadow-red-500/10'
      : 'bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60 shadow-xs shadow-amber-500/10';

  const pctStr =
    alert.changePct !== null && alert.changePct !== undefined
      ? `${alert.changePct > 0 ? '+' : ''}${alert.changePct.toFixed(1)}%`
      : null;

  const badgeLabel = isOpportunity
    ? `Buying Opportunity${pctStr ? ` ${pctStr}` : ''}`
    : `Price Surge${pctStr ? ` ${pctStr}` : ''}`;

  const isLoose = Boolean(alert.isLoose || alert.officialMrp === null);

  const prevRateDisplay = isLoose
    ? alert.previousRatePerKg !== null && alert.previousRatePerKg !== undefined
      ? `${formatINR(alert.previousRatePerKg)}/kg`
      : alert.previousWholesaleRate !== null && alert.previousWholesaleRate !== undefined
        ? `${formatINR(alert.previousWholesaleRate)}/kg`
        : '—'
    : alert.previousWholesaleRate !== null && alert.previousWholesaleRate !== undefined
      ? formatINR(alert.previousWholesaleRate)
      : '—';

  const liveRateDisplay = isLoose
    ? alert.ratePerKg !== null && alert.ratePerKg !== undefined
      ? `${formatINR(alert.ratePerKg)}/kg`
      : alert.currentWholesaleRate !== null && alert.currentWholesaleRate !== undefined
        ? `${formatINR(alert.currentWholesaleRate)}/kg`
        : '—'
    : alert.currentWholesaleRate !== null && alert.currentWholesaleRate !== undefined
      ? formatINR(alert.currentWholesaleRate)
      : '—';

  const liveRateColor = isOpportunity
    ? 'text-emerald-700 dark:text-emerald-400'
    : isCritical
      ? 'text-rose-700 dark:text-rose-400'
      : 'text-amber-700 dark:text-amber-400';

  return (
    <article
      className={`rounded-2xl bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 border-b-[4px] border-r-[2px] border-b-gray-200 border-r-gray-200 dark:border-b-slate-700 dark:border-r-slate-700 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg ${accentBorderClass} ${
        compact ? 'p-4 space-y-3' : 'p-5 space-y-3.5'
      }`}
    >
      {/* Top row: Product Title + Severity Movement Pill */}
      <div className="flex flex-wrap items-start justify-between gap-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--text-muted)] mb-0.5">
            {alert.category && <span className="font-semibold text-[var(--text-secondary)]">{alert.category}</span>}
            {alert.packVariant && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-medium">{alert.packVariant}</span>
              </>
            )}
            {alert.skuCode && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono-num">{alert.skuCode}</span>
              </>
            )}
          </div>
          <h4 className="font-display text-sm sm:text-[15px] font-bold text-[var(--text-primary)] leading-snug">
            {alert.productName}
          </h4>
        </div>

        <span
          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-mono-num font-bold shrink-0 whitespace-nowrap ${badgeClass}`}
        >
          {isOpportunity ? (
            <TrendingDown className="w-3.5 h-3.5 shrink-0" />
          ) : (
            <TrendingUp className="w-3.5 h-3.5 shrink-0" />
          )}
          <span>{badgeLabel}</span>
        </span>
      </div>

      {/* Actionable Market Narrative */}
      <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{alert.reason}</p>

      {/* Replacement-Cost Comparison Grid (Strict Loose vs Packaged Rules) */}
      <div className="grid grid-cols-3 gap-2.5 px-3.5 py-2.5 rounded-xl bg-slate-50/90 dark:bg-slate-900/55 border border-slate-200/60 dark:border-slate-700/60">
        <div className="min-w-0">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Prev Rate
          </span>
          <span className="block font-mono-num text-xs sm:text-sm font-semibold text-[var(--text-secondary)] mt-0.5 truncate">
            {prevRateDisplay}
          </span>
        </div>

        <div className="min-w-0">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Today Live
          </span>
          <span className={`block font-mono-num text-xs sm:text-sm font-bold mt-0.5 truncate ${liveRateColor}`}>
            {liveRateDisplay}
          </span>
        </div>

        <div className="min-w-0 text-right">
          {isLoose ? (
            <>
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Quintal Rate
              </span>
              <span className="block font-mono-num text-xs sm:text-sm font-bold text-blue-600 dark:text-blue-400 mt-0.5 truncate">
                {alert.ratePerQuintal !== null && alert.ratePerQuintal !== undefined
                  ? `₹${Math.round(alert.ratePerQuintal).toLocaleString('en-IN')}/qtl`
                  : '—'}
              </span>
            </>
          ) : (
            <>
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Official MRP
              </span>
              <span className="block font-mono-num text-xs sm:text-sm font-bold text-[var(--text-primary)] mt-0.5 truncate">
                {alert.officialMrp !== null && alert.officialMrp !== undefined
                  ? formatINR(alert.officialMrp)
                  : '—'}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Replacement Impact Summary & Source + Interactive Actions */}
      <div className="space-y-2.5 pt-0.5">
        {alert.replacementImpactSummary && (
          <p className="text-[11px] font-semibold text-[var(--text-primary)] leading-snug">
            {alert.replacementImpactSummary}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-700/60">
          <p className="text-[11px] font-mono-num text-[var(--text-muted)] truncate min-w-0">
            {alert.source} · {alert.timestamp}
          </p>

          <div className="flex items-center gap-2 shrink-0">
            {onViewSku && (
              <button
                type="button"
                onClick={() => onViewSku(alert)}
                aria-label={`View SKU ${alert.productName}`}
                className="px-3 py-1.5 min-h-[34px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-semibold text-blue-600 dark:text-indigo-400 inline-flex items-center gap-1 whitespace-nowrap shadow-xs transition-colors"
              >
                <span>View SKU</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            )}

            {!compact && onOpenCalculator && alert.productId && (
              <button
                type="button"
                onClick={() => onOpenCalculator(alert)}
                aria-label={`Open price calculator for ${alert.productName}`}
                className="bhaviq-btn-primary px-3 py-1.5 min-h-[34px] rounded-xl text-xs font-semibold whitespace-nowrap"
              >
                Calculator
              </button>
            )}

            {!alert.acknowledged && onAcknowledge && (
              <button
                type="button"
                disabled={acknowledging}
                onClick={() => onAcknowledge(alert.id)}
                aria-label={`Acknowledge ${alert.productName} alert`}
                className="px-3 py-1.5 min-h-[34px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 hover:bg-emerald-50 dark:hover:bg-emerald-500/15 hover:border-emerald-200 dark:hover:border-emerald-500/30 hover:text-emerald-700 dark:hover:text-emerald-300 text-xs font-semibold text-[var(--text-secondary)] inline-flex items-center gap-1 whitespace-nowrap transition-colors disabled:opacity-50"
              >
                <Check className="w-3.5 h-3.5" />
                <span>{acknowledging ? 'Saving...' : 'Acknowledge'}</span>
              </button>
            )}

            {alert.acknowledged && onRestore && (
              <button
                type="button"
                disabled={acknowledging}
                onClick={() => onRestore(alert.id)}
                aria-label={`Restore ${alert.productName} alert`}
                className="px-3 py-1.5 min-h-[34px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-semibold text-[var(--text-secondary)] inline-flex items-center gap-1 whitespace-nowrap transition-colors disabled:opacity-50"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Restore</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
};
