import React from 'react';
import { formatINR } from '../lib/finance';

interface DailyPoint {
  date: string;
  sales: number;
  bills: number;
  grossProfit: number | null;
}

export const DailySalesChart: React.FC<{ data: DailyPoint[] }> = ({ data }) => {
  // Dynamically start from the date of the FIRST available invoice / data point with sales or bills
  const firstActiveIndex = data.findIndex((d) => d.sales > 0 || d.bills > 0);
  const chartData = firstActiveIndex >= 0 ? data.slice(firstActiveIndex) : data;
  const hasAnySales = chartData.some((d) => d.sales > 0);

  if (!hasAnySales || chartData.length === 0) {
    return (
      <div className="h-48 flex flex-col items-center justify-center text-center px-4 rounded-xl border border-dashed border-slate-200 dark:border-slate-700/70 bg-slate-50/60 dark:bg-slate-900/40">
        <p className="text-sm font-semibold text-[var(--text-secondary)]">
          Not enough recorded data.
        </p>
        <p className="text-xs text-[var(--text-muted)] mt-1">
          Sales trends will appear here once you create invoices.
        </p>
      </div>
    );
  }

  const maxSales = Math.max(...chartData.map((d) => d.sales), 1);

  return (
    <div className="space-y-3">
      {/* Container aligned to start from left, fitting points chronologically left-to-right */}
      <div className="h-44 flex items-end justify-start gap-3 sm:gap-4 pt-4 overflow-x-auto">
        {chartData.map((point) => {
          const pct = Math.max(4, Math.round((point.sales / maxSales) * 100));
          const shortDate = point.date.slice(5);
          return (
            <div
              key={point.date}
              className={`flex flex-col items-center gap-1.5 h-full justify-end group shrink-0 ${
                chartData.length === 1
                  ? 'w-24 sm:w-28'
                  : chartData.length <= 4
                  ? 'w-20 sm:w-24'
                  : 'flex-1 min-w-[44px] max-w-[64px]'
              }`}
            >
              <div
                className={`text-[11px] font-mono-num font-bold text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-800 px-1.5 py-0.5 rounded shadow-xs border border-gray-100 dark:border-slate-700 whitespace-nowrap transition-opacity ${
                  chartData.length <= 2 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}
              >
                {point.sales > 0 ? formatINR(point.sales) : '₹0'}
              </div>
              <div className="w-full flex-1 flex items-end justify-center">
                <div
                  style={{ height: `${point.sales > 0 ? pct : 4}%` }}
                  className={`w-full max-w-[40px] rounded-t-lg transition-all duration-300 ${
                    point.sales > 0
                      ? 'bg-gradient-to-t from-indigo-600 to-indigo-400 dark:from-indigo-500 dark:to-indigo-400 group-hover:from-indigo-700 group-hover:to-indigo-500 shadow-md shadow-indigo-500/20 group-hover:scale-y-105 origin-bottom'
                      : 'bg-gray-100 dark:bg-slate-800'
                  }`}
                  title={`${point.date}: ${formatINR(point.sales)} (${point.bills} bills)`}
                />
              </div>
              <span className="text-[11px] font-mono-num font-medium text-slate-500 dark:text-slate-400">
                {shortDate}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

interface PriceTrendPoint {
  date: string;
  price: number;
  label: string;
}

export const PriceHistorySparkChart: React.FC<{ points: PriceTrendPoint[] }> = ({ points }) => {
  if (points.length === 0) {
    return (
      <div className="h-32 flex items-center justify-center text-xs text-[var(--text-muted)] rounded-xl border border-dashed border-slate-200 dark:border-slate-700/70 bg-slate-50/50 dark:bg-slate-900/30">
        No recorded historical price observations yet.
      </div>
    );
  }

  if (points.length === 1) {
    return (
      <div className="h-32 flex flex-col items-center justify-center text-center rounded-xl border border-dashed border-slate-200 dark:border-slate-700/70 bg-slate-50/50 dark:bg-slate-900/30 px-4">
        <span className="font-mono-num text-xl font-bold text-[var(--text-primary)]">
          {formatINR(points[0].price)}
        </span>
        <span className="text-xs text-[var(--text-muted)] mt-1">
          Single observation recorded on {points[0].date} · {points[0].label}
        </span>
      </div>
    );
  }

  const width = 480;
  const height = 128;
  const padX = 16;
  const padY = 18;
  const minVal = Math.min(...points.map((p) => p.price));
  const maxVal = Math.max(...points.map((p) => p.price));
  const span = maxVal - minVal || 1;

  const coords = points.map((p, idx) => {
    const x = padX + (idx / (points.length - 1)) * (width - padX * 2);
    const y = height - padY - ((p.price - minVal) / span) * (height - padY * 2);
    return { ...p, x, y };
  });

  const polyline = coords.map((c) => `${c.x},${c.y}`).join(' ');

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-32 overflow-visible" aria-label="Price trend chart">
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth="2.75"
          strokeLinejoin="round"
          strokeLinecap="round"
          className="text-indigo-600 dark:text-indigo-400"
          points={polyline}
        />
        {coords.map((c, i) => (
          <g key={`${c.date}-${i}`}>
            <circle
              cx={c.x}
              cy={c.y}
              r="4.5"
              className="fill-white dark:fill-slate-800 stroke-indigo-600 dark:stroke-indigo-400"
              strokeWidth="2.25"
            />
          </g>
        ))}
      </svg>
      <div className="flex items-center justify-between text-[11px] font-mono-num text-[var(--text-muted)] px-1 mt-1">
        <span>{points[0].date} ({formatINR(points[0].price)})</span>
        <span>{points[points.length - 1].date} ({formatINR(points[points.length - 1].price)})</span>
      </div>
    </div>
  );
};
