import React from 'react';
import { formatINR } from '../lib/finance';
import type { MasterProductSKU } from '../lib/marketDataService';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Layers, Minus } from 'lucide-react';

interface LiveCommodityCardProps {
  item: MasterProductSKU;
  matchedProductId?: string | null;
  matchedProductName?: string | null;
  liveSyncTimestamp?: string | null;
  onInspectMatchedProduct?: (productId: string) => void;
}

export const LiveCommodityCard: React.FC<LiveCommodityCardProps> = ({
  item,
  matchedProductId,
  matchedProductName,
  liveSyncTimestamp,
  onInspectMatchedProduct,
}) => {
  const isDown = item.trend === 'down';
  const isUp = item.trend === 'up';

  const trendBadgeClass = isDown
    ? 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-200/80 dark:border-emerald-500/30'
    : isUp
      ? 'bg-rose-50 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-200/80 dark:border-rose-500/30'
      : 'bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 border-slate-200/80 dark:border-slate-600/60';

  const marginVal = item.profitMarginPct ?? 0;
  const marginColorClass =
    marginVal >= 14.5
      ? 'text-emerald-700 dark:text-emerald-400'
      : marginVal >= 10
        ? 'text-indigo-600 dark:text-indigo-400'
        : 'text-amber-700 dark:text-amber-400';

  const isSingleKgLoose = item.isLoose && item.packWeightKg === 1;
  const loosePerKg = item.ratePerKg ?? item.wholesaleRate;
  const loosePerQuintal = item.ratePerQuintal ?? Math.round(loosePerKg * 100);

  return (
    <article className="group rounded-2xl bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 shadow-xl shadow-slate-200/50 dark:shadow-black/50 transition-all duration-200 hover:-translate-y-1 hover:shadow-2xl hover:border-blue-200 dark:hover:border-indigo-500/40 p-5 flex flex-col justify-between gap-4">
      {/* Row 1: Clean Category Tag & Live Price Trend Badge */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-[var(--text-muted)] truncate">
          {item.category}
        </span>

        <span
          className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md border text-[11px] font-mono-num font-bold shrink-0 ${trendBadgeClass}`}
          title={
            isDown
              ? 'Wholesale rate decreased vs previous 24h cycle'
              : isUp
                ? 'Wholesale rate increased vs previous 24h cycle'
                : 'Wholesale rate unchanged vs previous 24h cycle'
          }
        >
          {isUp && <ArrowUpRight className="w-3 h-3" />}
          {isDown && <ArrowDownRight className="w-3 h-3" />}
          {!isUp && !isDown && <Minus className="w-3 h-3" />}
          <span>
            {item.changePct > 0 ? '+' : ''}
            {item.changePct.toFixed(1)}%
          </span>
        </span>
      </div>

      {/* Row 2: Bold Product Name & Exact Pack / Weight Variant */}
      <div className="space-y-1 min-w-0">
        <h3
          className="font-display text-[15px] font-bold text-[var(--text-primary)] leading-snug line-clamp-1"
          title={item.name}
        >
          {item.name}
        </h3>
        <p className="text-xs text-[var(--text-secondary)] truncate">
          <span className="font-semibold text-[var(--text-primary)]">{item.packVariant}</span>
          <span aria-hidden="true" className="mx-1.5 text-[var(--text-muted)]">·</span>
          <span className="font-mono-num text-[11px] text-[var(--text-muted)]">{item.skuCode}</span>
        </p>
      </div>

      {/* Row 3: Strict Loose vs Packaged Pricing */}
      <div className="flex items-end justify-between gap-4 py-3 border-y border-slate-100 dark:border-slate-700/70">
        <div className="min-w-0">
          <span className="text-[11px] font-medium text-[var(--text-muted)] block mb-0.5">
            Wholesale rate
          </span>
          <span className="font-mono-num text-xl font-bold tracking-tight text-[var(--text-primary)]">
            {formatINR(item.wholesaleRate)}
            {isSingleKgLoose && (
              <span className="text-xs font-semibold text-[var(--text-muted)] ml-0.5">/kg</span>
            )}
          </span>
        </div>

        {item.isLoose || item.suggestedMrp === null ? (
          <div className="text-right shrink-0">
            {isSingleKgLoose ? (
              <span className="block text-[11px] font-medium text-[var(--text-muted)]">
                Quintal rate
              </span>
            ) : (
              <span className="block text-xs font-mono-num font-semibold text-[var(--text-secondary)]">
                {formatINR(loosePerKg)}/kg
              </span>
            )}
            <span className="block text-xs font-mono-num font-semibold text-blue-600 dark:text-blue-400 mt-0.5">
              ₹{Math.round(loosePerQuintal).toLocaleString('en-IN')}/qtl
            </span>
          </div>
        ) : (
          <div className="text-right shrink-0">
            <span className="block text-xs font-mono-num font-medium text-[var(--text-secondary)]">
              MRP {formatINR(item.suggestedMrp)}
            </span>
            <span className={`block text-xs font-mono-num font-bold mt-0.5 ${marginColorClass}`}>
              {(item.profitMarginPct ?? 0).toFixed(1)}% margin
            </span>
          </div>
        )}
      </div>

      {/* Row 4: Clean Data Source Tag & Live Timestamp / Compare Action */}
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5 text-[var(--text-secondary)] truncate">
          <Layers className="w-3.5 h-3.5 text-blue-600 dark:text-indigo-400 shrink-0" />
          <span className="truncate font-medium">{item.supplierTier}</span>
        </span>

        {matchedProductId && onInspectMatchedProduct ? (
          <button
            type="button"
            onClick={() => onInspectMatchedProduct(matchedProductId)}
            title={`Open wholesale intelligence for ${matchedProductName || 'catalog product'}`}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 dark:text-indigo-400 hover:underline shrink-0 whitespace-nowrap"
          >
            <span>Compare stock</span>
            <ArrowRight className="w-3 h-3" />
          </button>
        ) : (
          <span
            className="text-[11px] font-mono-num text-[var(--text-muted)] shrink-0 whitespace-nowrap"
            title={`Rate date ${item.updatedAt}`}
          >
            {liveSyncTimestamp && liveSyncTimestamp !== 'Not synced yet'
              ? liveSyncTimestamp
              : item.updatedAt}
          </span>
        )}
      </div>
    </article>
  );
};
