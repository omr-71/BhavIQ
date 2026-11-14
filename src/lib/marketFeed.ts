import { roundCurrency } from './units';

export type LiveFeedCategory =
  | 'Grains'
  | 'Pulses'
  | 'Oils'
  | 'Spices'
  | 'Grocery'
  | 'Packaged FMCG'
  | 'Vegetables';

export type LiveFeedFilterPill = 'All products' | LiveFeedCategory;

export const LIVE_FEED_FILTER_PILLS: LiveFeedFilterPill[] = [
  'All products',
  'Packaged FMCG',
  'Grocery',
  'Grains',
  'Pulses',
  'Oils',
  'Spices',
  'Vegetables',
];

export interface LiveCommodityQuote {
  id: string;
  commodity: string;
  variety: string;
  category: LiveFeedCategory;
  market: string;
  district: string;
  state: string;
  pricePerQuintal: number;
  pricePerKg: number;
  minPerQuintal: number;
  maxPerQuintal: number;
  previousPricePerKg: number;
  changePct: number;
  trend: 'up' | 'down' | 'flat';
  sparkline: number[];
  arrivalDate: string;
  sourceMode: 'live_api' | 'fallback_reference';
  unitLabel: string;
}

export interface LiveMarketFeedResponse {
  sourceMode: 'live_api' | 'fallback_reference';
  configured: boolean;
  lastSyncedAt: string;
  dataDate: string;
  recordsCount: number;
  fallbackReason: string | null;
  commodities: LiveCommodityQuote[];
}

export interface RawDataGovRecord {
  state?: string;
  district?: string;
  market?: string;
  commodity?: string;
  variety?: string;
  grade?: string;
  arrival_date?: string;
  min_price?: string | number;
  max_price?: string | number;
  modal_price?: string | number;
}

/**
 * Formats an ISO timestamp into a clean human-readable relative string
 * e.g. "Just now", "2 minutes ago", "1 hour ago".
 */
export function formatRelativeSyncTime(
  isoTimestamp: string | null | undefined,
  nowMs: number = Date.now()
): string {
  if (!isoTimestamp) return 'Not synced yet';
  const parsed = new Date(isoTimestamp).getTime();
  if (!Number.isFinite(parsed)) return 'Just now';

  const diffSec = Math.max(0, Math.floor((nowMs - parsed) / 1000));
  if (diffSec < 45) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin === 1) return '1 minute ago';
  if (diffMin < 60) return `${diffMin} minutes ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr === 1) return '1 hour ago';
  if (diffHr < 24) return `${diffHr} hours ago`;
  const diffDay = Math.floor(diffHr / 24);
  return diffDay === 1 ? '1 day ago' : `${diffDay} days ago`;
}

export function inferFeedCategory(commodityName: string): LiveFeedCategory {
  const s = commodityName.toLowerCase();
  if (
    /\b(turmeric|haldi|cumin|jeera|coriander|dhania|chilli|pepper|cardamom|clove|ginger)\b/.test(s)
  ) {
    return 'Spices';
  }
  if (
    /\b(oil|mustard|groundnut|sunflower|soyabean|sesame|ghee)\b/.test(s)
  ) {
    return 'Oils';
  }
  if (
    /\b(dal|tur|arhar|moong|urad|masoor|chana|gram|lentil|pigeon pea|green gram|black gram)\b/.test(s)
  ) {
    return 'Pulses';
  }
  if (
    /\b(rice|wheat|bajra|jowar|maize|paddy|atta|flour|ragi)\b/.test(s)
  ) {
    return 'Grains';
  }
  if (
    /\b(onion|potato|tomato|garlic)\b/.test(s)
  ) {
    return 'Vegetables';
  }
  if (
    /\b(biscuit|biscuits|noodle|noodles|soap|detergent|packaged)\b/.test(s)
  ) {
    return 'Packaged FMCG';
  }
  return 'Grocery';
}

function deterministicSparkline(seedText: string, currentKg: number, prevKg: number): number[] {
  let hash = 0;
  for (let i = 0; i < seedText.length; i++) {
    hash = (hash * 31 + seedText.charCodeAt(i)) >>> 0;
  }
  const points: number[] = [];
  const start = prevKg * (0.985 + ((hash % 30) / 1000));
  for (let idx = 0; idx < 6; idx++) {
    const t = idx / 5;
    const base = start + (prevKg - start) * t;
    const wobble = (((hash >> (idx * 3)) & 7) - 3.5) * 0.006 * prevKg;
    points.push(roundCurrency(Math.max(1, base + wobble)));
  }
  points.push(roundCurrency(currentKg));
  return points;
}

export function mapAgmarknetFeedRecords(
  records: RawDataGovRecord[],
  sourceMode: 'live_api' | 'fallback_reference' = 'live_api'
): LiveCommodityQuote[] {
  const seen = new Set<string>();
  const mapped: LiveCommodityQuote[] = [];

  for (const rec of records) {
    const commodity = (rec.commodity || '').trim();
    const market = (rec.market || '').trim();
    const modal = Number(rec.modal_price);
    if (!commodity || !market || !Number.isFinite(modal) || modal <= 0) continue;

    const variety = (rec.variety || rec.grade || 'Standard FAQ').trim();
    const dedupeKey = `${commodity.toLowerCase()}::${variety.toLowerCase()}::${market.toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const pricePerKg = roundCurrency(modal / 100);
    const minQ = Number.isFinite(Number(rec.min_price)) && Number(rec.min_price) > 0
      ? Number(rec.min_price)
      : Math.round(modal * 0.94);
    const maxQ = Number.isFinite(Number(rec.max_price)) && Number(rec.max_price) > 0
      ? Number(rec.max_price)
      : Math.round(modal * 1.06);

    const midKg = roundCurrency(((minQ + maxQ) / 2) / 100);
    const previousPricePerKg = midKg > 0 ? midKg : pricePerKg;
    const changePct =
      previousPricePerKg > 0
        ? roundCurrency(((pricePerKg - previousPricePerKg) / previousPricePerKg) * 100)
        : 0;

    mapped.push({
      id: `agm-${commodity.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${market.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      commodity,
      variety,
      category: inferFeedCategory(commodity),
      market,
      district: (rec.district || market).trim(),
      state: (rec.state || 'India').trim(),
      pricePerQuintal: roundCurrency(modal),
      pricePerKg,
      minPerQuintal: roundCurrency(minQ),
      maxPerQuintal: roundCurrency(maxQ),
      previousPricePerKg,
      changePct,
      trend: changePct > 0.15 ? 'up' : changePct < -0.15 ? 'down' : 'flat',
      sparkline: deterministicSparkline(dedupeKey, pricePerKg, previousPricePerKg),
      arrivalDate: (rec.arrival_date || new Date().toISOString().slice(0, 10)).trim(),
      sourceMode,
      unitLabel: 'Kg',
    });
  }

  return mapped;
}

export function filterLiveCommodities(
  commodities: LiveCommodityQuote[],
  search: string,
  filterPill: LiveFeedFilterPill
): LiveCommodityQuote[] {
  const q = search.trim().toLowerCase();
  return commodities.filter((item) => {
    if (filterPill !== 'All products' && item.category !== filterPill) {
      return false;
    }
    if (!q) return true;
    return (
      item.commodity.toLowerCase().includes(q) ||
      item.variety.toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q) ||
      item.market.toLowerCase().includes(q) ||
      item.district.toLowerCase().includes(q) ||
      item.state.toLowerCase().includes(q)
    );
  });
}

/**
 * Curated realistic staple Kirana wholesale market fallback dataset (INR per Quintal & INR per Kg)
 * Used gracefully whenever live data.gov.in requests are offline, unconfigured, or rate-limited.
 */
export function buildFallbackKiranaFeed(todayIso: string): LiveCommodityQuote[] {
  const items: Array<Omit<LiveCommodityQuote, 'id' | 'changePct' | 'trend' | 'arrivalDate' | 'sourceMode' | 'unitLabel'>> = [
    {
      commodity: 'Basmati Rice (1121 Steam)',
      variety: 'Export Grade · Aged',
      category: 'Grains',
      market: 'Vashi APMC Mandi',
      district: 'Navi Mumbai',
      state: 'Maharashtra',
      pricePerQuintal: 8850,
      pricePerKg: 88.5,
      minPerQuintal: 8600,
      maxPerQuintal: 9200,
      previousPricePerKg: 91.0,
      sparkline: [93.0, 92.4, 91.8, 91.2, 90.6, 89.4, 88.5],
    },
    {
      commodity: 'Sharbati Wheat',
      variety: 'MP Sehore · Milling FAQ',
      category: 'Grains',
      market: 'Indore Grain Mandi',
      district: 'Indore',
      state: 'Madhya Pradesh',
      pricePerQuintal: 3180,
      pricePerKg: 31.8,
      minPerQuintal: 3050,
      maxPerQuintal: 3320,
      previousPricePerKg: 30.9,
      sparkline: [29.8, 30.1, 30.4, 30.8, 31.1, 31.4, 31.8],
    },
    {
      commodity: 'Chakki Fresh Wheat Flour (Atta)',
      variety: '50 Kg Bulk Sack',
      category: 'Grains',
      market: 'Pune Market Yard',
      district: 'Pune',
      state: 'Maharashtra',
      pricePerQuintal: 3560,
      pricePerKg: 35.6,
      minPerQuintal: 3450,
      maxPerQuintal: 3680,
      previousPricePerKg: 34.8,
      sparkline: [34.0, 34.2, 34.5, 34.8, 35.1, 35.3, 35.6],
    },
    {
      commodity: 'Toor / Arhar Dal (Fatka)',
      variety: 'Latur Bold · Unpolished',
      category: 'Pulses',
      market: 'Latur Dal Mandi',
      district: 'Latur',
      state: 'Maharashtra',
      pricePerQuintal: 12650,
      pricePerKg: 126.5,
      minPerQuintal: 12300,
      maxPerQuintal: 13100,
      previousPricePerKg: 131.0,
      sparkline: [134.5, 133.2, 132.8, 131.5, 129.8, 128.0, 126.5],
    },
    {
      commodity: 'Moong Dal (Dhuli)',
      variety: 'Rajasthan Merta · Sortex',
      category: 'Pulses',
      market: 'Akola Pulses Yard',
      district: 'Akola',
      state: 'Maharashtra',
      pricePerQuintal: 10420,
      pricePerKg: 104.2,
      minPerQuintal: 10150,
      maxPerQuintal: 10750,
      previousPricePerKg: 106.4,
      sparkline: [108.0, 107.6, 107.0, 106.4, 105.7, 104.9, 104.2],
    },
    {
      commodity: 'Chana Dal (Desi)',
      variety: 'Medium Bold · Clean',
      category: 'Pulses',
      market: 'Bikaner Anaj Mandi',
      district: 'Bikaner',
      state: 'Rajasthan',
      pricePerQuintal: 8450,
      pricePerKg: 84.5,
      minPerQuintal: 8200,
      maxPerQuintal: 8700,
      previousPricePerKg: 82.1,
      sparkline: [80.4, 81.0, 81.6, 82.1, 83.0, 83.8, 84.5],
    },
    {
      commodity: 'Refined Sunflower Oil',
      variety: '15 Ltr Tin Equivalent',
      category: 'Oils',
      market: 'Kandla Port Bulk',
      district: 'Kutch',
      state: 'Gujarat',
      pricePerQuintal: 13450,
      pricePerKg: 134.5,
      minPerQuintal: 13200,
      maxPerQuintal: 13750,
      previousPricePerKg: 129.8,
      sparkline: [127.5, 128.2, 129.0, 129.8, 131.4, 133.0, 134.5],
    },
    {
      commodity: 'Kachi Ghani Mustard Oil',
      variety: 'Pure Expeller · Agmark',
      category: 'Oils',
      market: 'Alwar Oilseed Mandi',
      district: 'Alwar',
      state: 'Rajasthan',
      pricePerQuintal: 15200,
      pricePerKg: 152.0,
      minPerQuintal: 14900,
      maxPerQuintal: 15600,
      previousPricePerKg: 155.4,
      sparkline: [158.0, 157.2, 156.5, 155.4, 154.1, 153.0, 152.0],
    },
    {
      commodity: 'Filtered Groundnut Oil',
      variety: 'Rajkot Mill Grade',
      category: 'Oils',
      market: 'Rajkot APMC',
      district: 'Rajkot',
      state: 'Gujarat',
      pricePerQuintal: 16400,
      pricePerKg: 164.0,
      minPerQuintal: 16100,
      maxPerQuintal: 16800,
      previousPricePerKg: 166.5,
      sparkline: [168.4, 167.9, 167.1, 166.5, 165.4, 164.8, 164.0],
    },
    {
      commodity: 'Turmeric Finger (Salem)',
      variety: 'Double Polished · Whole',
      category: 'Spices',
      market: 'Sangli Haldi Mandi',
      district: 'Sangli',
      state: 'Maharashtra',
      pricePerQuintal: 14800,
      pricePerKg: 148.0,
      minPerQuintal: 14300,
      maxPerQuintal: 15400,
      previousPricePerKg: 141.5,
      sparkline: [137.0, 138.4, 140.0, 141.5, 143.8, 146.2, 148.0],
    },
    {
      commodity: 'Cumin Seeds (Jeera Bold)',
      variety: '99% Machine Clean',
      category: 'Spices',
      market: 'Unjha Spices APMC',
      district: 'Mehsana',
      state: 'Gujarat',
      pricePerQuintal: 25600,
      pricePerKg: 256.0,
      minPerQuintal: 24900,
      maxPerQuintal: 26400,
      previousPricePerKg: 268.0,
      sparkline: [275.0, 273.5, 271.2, 268.0, 263.5, 259.4, 256.0],
    },
    {
      commodity: 'Coriander Seeds (Eagle)',
      variety: 'Split & Whole FAQ',
      category: 'Spices',
      market: 'Kota Spice Mandi',
      district: 'Kota',
      state: 'Rajasthan',
      pricePerQuintal: 8120,
      pricePerKg: 81.2,
      minPerQuintal: 7900,
      maxPerQuintal: 8400,
      previousPricePerKg: 79.4,
      sparkline: [78.0, 78.4, 78.9, 79.4, 80.1, 80.7, 81.2],
    },
    {
      commodity: 'Refined White Sugar (M-30)',
      variety: 'Medium Crystal · Mill Gate',
      category: 'Grocery',
      market: 'Kolhapur Sugar Yard',
      district: 'Kolhapur',
      state: 'Maharashtra',
      pricePerQuintal: 3940,
      pricePerKg: 39.4,
      minPerQuintal: 3880,
      maxPerQuintal: 4020,
      previousPricePerKg: 40.2,
      sparkline: [41.0, 40.8, 40.5, 40.2, 39.9, 39.6, 39.4],
    },
    {
      commodity: 'Assam CTC Leaf Tea (BP/BOP)',
      variety: 'Upper Assam Garden Lot',
      category: 'Grocery',
      market: 'Guwahati Tea Auction',
      district: 'Kamrup',
      state: 'Assam',
      pricePerQuintal: 24200,
      pricePerKg: 242.0,
      minPerQuintal: 23400,
      maxPerQuintal: 25100,
      previousPricePerKg: 233.5,
      sparkline: [228.0, 229.5, 231.0, 233.5, 236.4, 239.2, 242.0],
    },
    {
      commodity: 'Parle-G / Glucose Biscuits (Case)',
      variety: '800g Family Pack · 12 Units',
      category: 'Packaged FMCG',
      market: 'Pune FMCG Depot',
      district: 'Pune',
      state: 'Maharashtra',
      pricePerQuintal: 8650,
      pricePerKg: 86.5,
      minPerQuintal: 8500,
      maxPerQuintal: 8800,
      previousPricePerKg: 87.2,
      sparkline: [88.0, 87.8, 87.5, 87.2, 87.0, 86.7, 86.5],
    },
    {
      commodity: 'Instant Masala Noodles (Master Carton)',
      variety: '70g × 96 Packs Wholesale',
      category: 'Packaged FMCG',
      market: 'Bhiwandi Distributor Hub',
      district: 'Thane',
      state: 'Maharashtra',
      pricePerQuintal: 15800,
      pricePerKg: 158.0,
      minPerQuintal: 15600,
      maxPerQuintal: 16050,
      previousPricePerKg: 155.0,
      sparkline: [153.5, 154.0, 154.5, 155.0, 156.2, 157.1, 158.0],
    },
    {
      commodity: 'Red Onion (Garva)',
      variety: 'Nashik Pole · Medium-Bold',
      category: 'Vegetables',
      market: 'Lasalgaon Onion APMC',
      district: 'Nashik',
      state: 'Maharashtra',
      pricePerQuintal: 3250,
      pricePerKg: 32.5,
      minPerQuintal: 2900,
      maxPerQuintal: 3600,
      previousPricePerKg: 35.8,
      sparkline: [38.2, 37.6, 36.9, 35.8, 34.4, 33.3, 32.5],
    },
  ];

  return items.map((item, idx) => {
    const changePct =
      item.previousPricePerKg > 0
        ? roundCurrency(
            ((item.pricePerKg - item.previousPricePerKg) / item.previousPricePerKg) * 100
          )
        : 0;
    return {
      ...item,
      id: `fallback-kirana-${idx + 1}`,
      changePct,
      trend: changePct > 0.15 ? 'up' : changePct < -0.15 ? 'down' : 'flat',
      arrivalDate: todayIso,
      sourceMode: 'fallback_reference',
      unitLabel: 'Kg',
    };
  });
}
