import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiRequest } from './api';
import { detectDailyMarketAlerts, mergeShopAndMarketAlerts } from './marketAlerts';
import type { LiveAgriRateOverride } from './masterCatalog';
import type { PriceAlert, Product } from './types';

interface UseDailyMarketAlertsParams {
  shopId: string;
  products: Product[];
  defaultMarginPct?: number;
  serverAlerts?: PriceAlert[];
  serverAcknowledgedAlerts?: PriceAlert[];
  liveAgriOverrides?: Record<string, LiveAgriRateOverride>;
  onAfterAcknowledge?: () => Promise<void> | void;
}

/**
 * Daily price-tracking hook that monitors daily calendar rollover, live data.gov.in overrides,
 * and shop inventory replacement impacts while keeping alert acknowledgements synchronized with SQLite.
 */
export function useDailyMarketAlerts({
  shopId,
  products,
  defaultMarginPct = 15,
  serverAlerts = [],
  serverAcknowledgedAlerts = [],
  liveAgriOverrides = {},
  onAfterAcknowledge,
}: UseDailyMarketAlertsParams) {
  const [todayIso, setTodayIso] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [localAckMap, setLocalAckMap] = useState<Map<string, string>>(() => new Map());
  const [localUnackIds, setLocalUnackIds] = useState<Set<string>>(() => new Set());
  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null);

  // Reset optimistic map when shop changes
  useEffect(() => {
    setLocalAckMap(new Map());
    setLocalUnackIds(new Set());
  }, [shopId]);

  // Monitor 24-hour calendar rollover continuously for daily volatility alert updates
  useEffect(() => {
    const id = window.setInterval(() => {
      const nextDay = new Date().toISOString().slice(0, 10);
      setTodayIso((prev) => (prev !== nextDay ? nextDay : prev));
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);

  const effectiveAckMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of serverAcknowledgedAlerts) {
      map.set(a.id, a.acknowledgedAt || new Date().toISOString());
    }
    for (const [k, v] of localAckMap.entries()) {
      map.set(k, v);
    }
    for (const id of localUnackIds) {
      map.delete(id);
    }
    return map;
  }, [serverAcknowledgedAlerts, localAckMap, localUnackIds]);

  const { activeAlerts, acknowledgedAlerts } = useMemo(() => {
    const dedupeById = (items: PriceAlert[]): PriceAlert[] => {
      const seen = new Set<string>();
      const out: PriceAlert[] = [];
      for (const item of items) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        out.push(item);
      }
      return out;
    };

    const inventoryAlerts = dedupeById([
      ...serverAlerts.filter((a) => a.alertKind === 'inventory_replacement'),
      ...serverAcknowledgedAlerts.filter((a) => a.alertKind === 'inventory_replacement'),
    ]);
    const serverMarketAlerts = dedupeById([
      ...serverAlerts.filter((a) => a.alertKind !== 'inventory_replacement'),
      ...serverAcknowledgedAlerts.filter((a) => a.alertKind !== 'inventory_replacement'),
    ]);

    // Recompute live daily volatility alerts on client whenever live overrides or day rollover changes
    const hasOverrides = Object.keys(liveAgriOverrides).length > 0;
    const marketAlerts =
      hasOverrides || serverMarketAlerts.length === 0
        ? detectDailyMarketAlerts({
            todayIso,
            liveAgriOverrides,
            shopProducts: products,
            defaultMarginPct,
            includeAcknowledged: true,
            maxAlerts: 12,
          })
        : serverMarketAlerts;

    return mergeShopAndMarketAlerts({
      inventoryAlerts,
      marketAlerts,
      acknowledgedMap: effectiveAckMap,
    });
  }, [
    serverAlerts,
    serverAcknowledgedAlerts,
    liveAgriOverrides,
    todayIso,
    products,
    defaultMarginPct,
    effectiveAckMap,
  ]);

  const acknowledgeAlert = useCallback(
    async (alertId: string) => {
      if (!shopId || acknowledgingId) return;
      const nowIso = new Date().toISOString();
      setAcknowledgingId(alertId);
      setLocalUnackIds((prev) => {
        const next = new Set(prev);
        next.delete(alertId);
        return next;
      });
      setLocalAckMap((prev) => {
        const next = new Map(prev);
        next.set(alertId, nowIso);
        return next;
      });
      try {
        await apiRequest(`/api/shops/${shopId}/market/alerts/${encodeURIComponent(alertId)}/acknowledge`, {
          method: 'POST',
        });
        await onAfterAcknowledge?.();
      } catch {
        // Revert optimistic update if request failed
        setLocalAckMap((prev) => {
          const next = new Map(prev);
          next.delete(alertId);
          return next;
        });
      } finally {
        setAcknowledgingId(null);
      }
    },
    [shopId, acknowledgingId, onAfterAcknowledge]
  );

  const restoreAlert = useCallback(
    async (alertId: string) => {
      if (!shopId || acknowledgingId) return;
      setAcknowledgingId(alertId);
      setLocalAckMap((prev) => {
        const next = new Map(prev);
        next.delete(alertId);
        return next;
      });
      setLocalUnackIds((prev) => {
        const next = new Set(prev);
        next.add(alertId);
        return next;
      });
      try {
        await apiRequest(`/api/shops/${shopId}/market/alerts/${encodeURIComponent(alertId)}/acknowledge`, {
          method: 'DELETE',
        });
        await onAfterAcknowledge?.();
      } catch {
        setLocalUnackIds((prev) => {
          const next = new Set(prev);
          next.delete(alertId);
          return next;
        });
      } finally {
        setAcknowledgingId(null);
      }
    },
    [shopId, acknowledgingId, onAfterAcknowledge]
  );

  return {
    todayIso,
    activeAlerts,
    acknowledgedAlerts,
    acknowledgingId,
    acknowledgeAlert,
    restoreAlert,
  };
}
