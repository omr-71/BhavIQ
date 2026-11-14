import React from 'react';
import { KpiCard, SurfaceCard } from '../components/ui';
import { MarketAlertCard } from '../components/MarketAlertCard';
import { DailySalesChart } from '../components/Charts';
import { formatINR } from '../lib/finance';
import type { DashboardSummary, PriceAlert, Shop } from '../lib/types';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  IndianRupee,
  Package,
  PackagePlus,
  Receipt,
  TrendingUp,
} from 'lucide-react';

interface OverviewPageProps {
  shop: Shop;
  summary: DashboardSummary | null;
  alerts?: PriceAlert[];
  acknowledgingAlertId?: string | null;
  loading: boolean;
  isMobile: boolean;
  onNavigate: (tab: string) => void;
  onViewAlertSku?: (alert: PriceAlert) => void;
  onAcknowledgeAlert?: (alertId: string) => void;
  onOpenAlertsTab?: () => void;
}

export const OverviewPage: React.FC<OverviewPageProps> = ({
  shop,
  summary,
  alerts,
  acknowledgingAlertId,
  loading,
  isMobile,
  onNavigate,
  onViewAlertSku,
  onAcknowledgeAlert,
  onOpenAlertsTab,
}) => {
  if (loading && !summary) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {[...Array(5)].map((_, idx) => (
          <div
            key={idx}
            className="h-32 rounded-2xl bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 border-b-[3px] border-b-gray-200 dark:border-b-slate-700 shadow-[0_8px_30px_rgb(0,0,0,0.06)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.35)] animate-pulse"
          />
        ))}
      </div>
    );
  }

  const data = summary;
  const isEmptyAccount =
    data &&
    data.totalProductsCount === 0 &&
    data.recentInvoices.length === 0 &&
    data.recentPurchases.length === 0;

  return (
    <div className="space-y-6">
      {/* Empty-state first-run guidance with physical 3D tile finish */}
      {isEmptyAccount && (
        <SurfaceCard className="animate-in fade-in slide-in-from-bottom-5 duration-700 p-6 md:p-7 relative overflow-hidden">
          <div
            aria-hidden="true"
            className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-indigo-500 via-blue-500 to-emerald-500"
          />
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-5">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                New shop ready · {shop.name}
              </p>
              <h2 className="font-display text-lg md:text-xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100 mt-1">
                Start recording real inventory, suppliers, and sales
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-300 mt-1.5 max-w-2xl leading-relaxed">
                BhavIQ displays only verified database figures. Add your suppliers and products first, then record purchases and bills to unlock profit and replacement-cost insights.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={() => onNavigate('suppliers')}
                className="px-4 py-2.5 min-h-[42px] rounded-xl border border-gray-200 dark:border-slate-700 border-b-[2px] bg-white dark:bg-slate-800 hover:bg-gray-50 dark:hover:bg-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-100 whitespace-nowrap shadow-xs transition-all hover:-translate-y-0.5"
              >
                Add supplier
              </button>
              <button
                type="button"
                onClick={() => onNavigate('inventory')}
                className="bhaviq-btn-primary px-5 py-2.5 min-h-[42px] rounded-xl text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap shadow-md hover:-translate-y-0.5 transition-all"
              >
                <PackagePlus className="w-4 h-4" />
                <span>Add your first product</span>
              </button>
            </div>
          </div>
        </SurfaceCard>
      )}

      {/* Mobile Quick Actions Strip */}
      {isMobile && (
        <div className="flex items-center gap-2.5 overflow-x-auto no-scrollbar pb-1 animate-in fade-in slide-in-from-bottom-5 duration-700">
          <button
            type="button"
            onClick={() => onNavigate('billing')}
            className="bhaviq-btn-primary shrink-0 px-4 py-3 rounded-2xl text-xs font-semibold inline-flex items-center gap-2 min-h-[44px] shadow-sm hover:-translate-y-0.5 transition-all"
          >
            <Receipt className="w-4 h-4" />
            <span>New Bill</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('inventory')}
            className="shrink-0 px-4 py-3 rounded-2xl bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 border-b-[4px] border-r-[2px] border-b-gray-200 border-r-gray-200 dark:border-b-slate-700 dark:border-r-slate-700 shadow-sm text-slate-800 dark:text-slate-100 text-xs font-semibold inline-flex items-center gap-2 min-h-[44px] hover:-translate-y-0.5 transition-all"
          >
            <PackagePlus className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <span>Add Stock</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('market')}
            className="shrink-0 px-4 py-3 rounded-2xl bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 border-b-[4px] border-r-[2px] border-b-gray-200 border-r-gray-200 dark:border-b-slate-700 dark:border-r-slate-700 shadow-sm text-slate-800 dark:text-slate-100 text-xs font-semibold inline-flex items-center gap-2 min-h-[44px] hover:-translate-y-0.5 transition-all"
          >
            <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span>Check Rates</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('khata')}
            className="shrink-0 px-4 py-3 rounded-2xl bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 border-b-[4px] border-r-[2px] border-b-gray-200 border-r-gray-200 dark:border-b-slate-700 dark:border-r-slate-700 shadow-sm text-slate-800 dark:text-slate-100 text-xs font-semibold inline-flex items-center gap-2 min-h-[44px] hover:-translate-y-0.5 transition-all"
          >
            <BookOpen className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            <span>Khata</span>
          </button>
        </div>
      )}

      {/* Elevated 3D Metric Cards with Staggered Entrance & Smooth Lift Hover */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="animate-in fade-in slide-in-from-bottom-5 duration-700 delay-75">
          <KpiCard
            label="Today's sales"
            value={data ? formatINR(data.todaySales) : '—'}
            icon={<IndianRupee className="w-4 h-4" />}
            accentTop="indigo"
            subtext={
              data
                ? `${data.todayBillsCount} ${data.todayBillsCount === 1 ? 'bill' : 'bills'} recorded today`
                : 'Not enough recorded data.'
            }
            onClick={() => onNavigate('billing')}
          />
        </div>
        <div className="animate-in fade-in slide-in-from-bottom-5 duration-700 delay-100">
          <KpiCard
            label="Today's gross profit"
            value={
              data && data.todayGrossProfit !== null
                ? formatINR(data.todayGrossProfit)
                : 'Not enough data'
            }
            icon={<TrendingUp className="w-4 h-4" />}
            accentTop={
              data && data.todayGrossProfit !== null
                ? data.todayGrossProfit >= 0
                  ? 'emerald'
                  : 'rose'
                : 'slate'
            }
            tone={
              data && data.todayGrossProfit !== null
                ? data.todayGrossProfit >= 0
                  ? 'positive'
                  : 'danger'
                : 'neutral'
            }
            subtext={
              data && data.todayGrossProfit !== null
                ? 'Revenue excl. tax minus recorded landed cost'
                : 'Not enough recorded data.'
            }
          />
        </div>
        <div className="animate-in fade-in slide-in-from-bottom-5 duration-700 delay-150">
          <KpiCard
            label="Credit outstanding"
            value={data ? formatINR(data.creditOutstanding) : '—'}
            icon={<BookOpen className="w-4 h-4" />}
            accentTop={data && data.creditOutstanding > 0 ? 'amber' : 'slate'}
            tone={data && data.creditOutstanding > 0 ? 'warning' : 'neutral'}
            subtext="Customer Khata receivables"
            onClick={() => onNavigate('khata')}
          />
        </div>
        <div className="animate-in fade-in slide-in-from-bottom-5 duration-700 delay-200">
          <KpiCard
            label="Current stock value"
            value={
              data && data.stockValue !== null
                ? formatINR(data.stockValue)
                : 'Not enough data'
            }
            icon={<Package className="w-4 h-4" />}
            accentTop="purple"
            subtext={
              data
                ? `${data.stockValuationCompleteCount} of ${data.totalProductsCount} items with cost recorded`
                : 'Not enough recorded data.'
            }
            onClick={() => onNavigate('inventory')}
          />
        </div>
        <div className="col-span-2 lg:col-span-1 animate-in fade-in slide-in-from-bottom-5 duration-700 delay-300">
          <KpiCard
            label="Low-stock alerts"
            value={data ? String(data.lowStockProducts.length) : '0'}
            icon={<AlertTriangle className="w-4 h-4" />}
            accentTop={data && data.lowStockProducts.length > 0 ? 'rose' : 'emerald'}
            tone={data && data.lowStockProducts.length > 0 ? 'warning' : 'neutral'}
            subtext={
              data && data.lowStockProducts.length > 0
                ? 'At or below minimum stock level'
                : 'All tracked items above minimum'
            }
            onClick={() => onNavigate('inventory')}
          />
        </div>
      </div>

      {/* Main Analytics + Collections with 3D Depth & Staggered Entrance */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <SurfaceCard className="lg:col-span-7 p-6 animate-in fade-in slide-in-from-bottom-5 duration-700 delay-300">
          <div className="flex items-center justify-between gap-4 mb-5">
            <div>
              <h3 className="font-display text-base font-extrabold text-slate-900 dark:text-slate-100">
                7-Day Sales Trend
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Daily billed revenue from completed invoices
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('reports')}
              className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 inline-flex items-center gap-1 whitespace-nowrap transition-colors"
            >
              <span>Full reports</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <DailySalesChart data={data?.dailyTrend || []} />
        </SurfaceCard>

        <SurfaceCard className="lg:col-span-5 p-6 flex flex-col justify-between gap-5 animate-in fade-in slide-in-from-bottom-5 duration-700 delay-400">
          <div>
            <h3 className="font-display text-base font-extrabold text-slate-900 dark:text-slate-100">
              Today&apos;s Collection & Expenses
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Actual recorded payment settlements and shop expenses
            </p>
          </div>

          <div className="divide-y divide-gray-100 dark:divide-slate-800">
            <div className="flex items-center justify-between py-3.5">
              <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Cash collected</span>
              <span className="font-mono-num text-base font-extrabold text-slate-900 dark:text-slate-100">
                {formatINR(data?.paymentCollection.cash ?? 0)}
              </span>
            </div>
            <div className="flex items-center justify-between py-3.5">
              <span className="text-sm font-medium text-slate-600 dark:text-slate-300">UPI collected</span>
              <span className="font-mono-num text-base font-extrabold text-slate-900 dark:text-slate-100">
                {formatINR(data?.paymentCollection.upi ?? 0)}
              </span>
            </div>
            <div className="flex items-center justify-between py-3.5">
              <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Issued on Khata credit</span>
              <span className="font-mono-num text-base font-extrabold text-amber-600 dark:text-amber-400">
                {formatINR(data?.paymentCollection.credit ?? 0)}
              </span>
            </div>
            <div className="flex items-center justify-between py-3.5">
              <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Expenses today / month</span>
              <span className="font-mono-num text-sm font-bold text-slate-900 dark:text-slate-100">
                {formatINR(data?.todayExpenses ?? 0)} · {formatINR(data?.monthExpenses ?? 0)}
              </span>
            </div>
          </div>
        </SurfaceCard>
      </div>

      {/* Market Price Alerts + Low Stock & Recent Bills */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <SurfaceCard className="lg:col-span-6 p-6 animate-in fade-in slide-in-from-bottom-5 duration-700 delay-500">
          {(() => {
            const activeAlerts = alerts ?? data?.priceAlerts ?? [];
            const surgeCount = activeAlerts.filter((a) => a.severity !== 'opportunity').length;
            const oppCount = activeAlerts.filter((a) => a.severity === 'opportunity').length;

            return (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-display text-base font-extrabold text-slate-900 dark:text-slate-100">
                        Market Price Alerts
                      </h3>
                      {activeAlerts.length > 0 && (
                        <div className="flex items-center gap-1.5">
                          {surgeCount > 0 && (
                            <span className="px-2.5 py-1 rounded-full bg-red-100 dark:bg-rose-950/70 border border-red-200 dark:border-rose-800/60 text-xs font-mono-num font-bold text-red-700 dark:text-rose-300 shadow-xs shadow-red-500/10">
                              {surgeCount} surge
                            </span>
                          )}
                          {oppCount > 0 && (
                            <span className="px-2.5 py-1 rounded-full bg-green-100 dark:bg-emerald-950/70 border border-green-200 dark:border-emerald-800/60 text-xs font-mono-num font-bold text-green-700 dark:text-emerald-300 shadow-xs shadow-green-500/10">
                              {oppCount} opportunity
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Live daily wholesale spikes, drops &amp; replacement-cost margin impact
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => (onOpenAlertsTab ? onOpenAlertsTab() : onNavigate('market'))}
                    className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 whitespace-nowrap transition-colors"
                  >
                    {activeAlerts.length > 4
                      ? `View all (${activeAlerts.length})`
                      : 'Open Market IQ'}
                  </button>
                </div>

                {activeAlerts.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400 rounded-xl border border-dashed border-gray-200 dark:border-slate-700/70 bg-gray-50/50 dark:bg-slate-900/30">
                    All active daily price movement alerts have been acknowledged. Open Market Intelligence to review acknowledged logs or sync live rates.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {activeAlerts.slice(0, 4).map((alert) => (
                      <MarketAlertCard
                        key={alert.id}
                        alert={alert}
                        compact
                        acknowledging={acknowledgingAlertId === alert.id}
                        onViewSku={onViewAlertSku}
                        onAcknowledge={onAcknowledgeAlert}
                      />
                    ))}
                  </div>
                )}
              </>
            );
          })()}
        </SurfaceCard>

        <SurfaceCard className="lg:col-span-6 p-6 animate-in fade-in slide-in-from-bottom-5 duration-700 delay-500">
          <div className="flex items-center justify-between gap-4 mb-4">
            <div>
              <h3 className="font-display text-base font-extrabold text-slate-900 dark:text-slate-100">
                Low-Stock & Recent Bills
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Immediate stock attention and latest completed bills
              </p>
            </div>
          </div>

          {data && data.lowStockProducts.length > 0 && (
            <div className="mb-4 space-y-2">
              {data.lowStockProducts.slice(0, 3).map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/70 shadow-xs"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                    <span className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                      {p.name}
                    </span>
                  </div>
                  <span className="font-mono-num text-xs font-extrabold text-amber-800 dark:text-amber-300 whitespace-nowrap">
                    {p.currentStock} / min {p.minStockLevel} {p.baseUnit}
                  </span>
                </div>
              ))}
            </div>
          )}

          {!data || data.recentInvoices.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400 rounded-xl border border-dashed border-gray-200 dark:border-slate-700/70 bg-gray-50/50 dark:bg-slate-900/30">
              No invoices recorded yet.
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-slate-800">
              {data.recentInvoices.slice(0, 4).map((inv) => (
                <div key={inv.id} className="py-3.5 first:pt-1 last:pb-1 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-bold font-mono-num text-slate-900 dark:text-slate-100 truncate">
                      {inv.invoiceNumber} · {inv.customerNameSnapshot || 'Walk-in customer'}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {inv.items.length} {inv.items.length === 1 ? 'item' : 'items'} · {inv.paymentMode.toUpperCase()} · {new Date(inv.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <span className="font-mono-num text-base font-extrabold text-slate-900 dark:text-slate-100 shrink-0">
                    {formatINR(inv.totalAmount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </SurfaceCard>
      </div>
    </div>
  );
};
