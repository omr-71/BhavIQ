import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { getOAuthRedirectUrl } from './tauriBridge';
import type { Shop, UserProfile } from './types';

let cachedClient: SupabaseClient | null = null;

export function resetCachedSupabaseClientForTesting() {
  cachedClient = null;
}

function readEnv(key: string): string {
  const val = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[key];
  return typeof val === 'string' ? val.trim() : '';
}

export function isValidHttpUrl(candidate: string): boolean {
  if (!candidate || typeof candidate !== 'string') return false;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function getSupabaseConfig() {
  const url = readEnv('VITE_SUPABASE_URL');
  const anonKey = readEnv('VITE_SUPABASE_ANON_KEY');
  const configured = Boolean(url && anonKey && isValidHttpUrl(url));
  return {
    url,
    anonKey,
    configured,
  };
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseConfig().configured;
}

export function getSupabaseClient(): SupabaseClient | null {
  if (cachedClient) return cachedClient;
  const { url, anonKey, configured } = getSupabaseConfig();
  if (!configured) return null;

  try {
    cachedClient = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
    });
    return cachedClient;
  } catch (err) {
    console.warn('[BhavIQ] Supabase client initialization safely bypassed:', err);
    return null;
  }
}

export async function getActiveSupabaseSession(): Promise<Session | null> {
  try {
    const client = getSupabaseClient();
    if (!client) return null;
    const { data } = await client.auth.getSession();
    return data.session ?? null;
  } catch (err) {
    console.warn('[BhavIQ] Supabase getSession safely bypassed:', err);
    return null;
  }
}

export async function signInWithSupabaseEmail(email: string, password: string) {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Supabase Auth is not configured in environment.');
  }
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  if (!data.session) throw new Error('No active session returned by Supabase.');
  return data;
}

export async function signUpWithSupabaseEmail(params: {
  email: string;
  password: string;
  fullName: string;
  phone: string | null;
}) {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Supabase Auth is not configured in environment.');
  }
  const { data, error } = await client.auth.signUp({
    email: params.email,
    password: params.password,
    options: {
      data: {
        full_name: params.fullName,
        phone: params.phone,
      },
      emailRedirectTo: getOAuthRedirectUrl(),
    },
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function getSupabaseGoogleOAuthUrl(options?: { redirectTo?: string }): Promise<string> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Supabase Auth is not configured in environment.');
  }
  const callbackUrl = options?.redirectTo || getOAuthRedirectUrl();
  const { data, error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: callbackUrl,
      skipBrowserRedirect: true,
      queryParams: {
        access_type: 'offline',
        prompt: 'select_account',
      },
    },
  });
  if (error) throw new Error(error.message);
  if (!data?.url) throw new Error('Supabase did not return a Google authorization URL.');
  return data.url;
}

export async function completeSupabasePopupCallback(payload: {
  search?: string;
  hash?: string;
  url?: string;
}): Promise<Session | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  let search = payload.search || '';
  let hash = payload.hash || '';

  if (payload.url) {
    const raw = payload.url.trim();
    try {
      // Normalizing scheme so URL constructor can parse custom schemes like bhaviq://
      const normalized = raw.replace(/^[a-zA-Z0-9_-]+:\/\//, 'http://localhost/');
      const parsed = new URL(normalized);
      search = parsed.search || search;
      hash = parsed.hash || hash;
    } catch {
      const qIndex = raw.indexOf('?');
      const hIndex = raw.indexOf('#');
      if (qIndex !== -1) {
        search = hIndex !== -1 && hIndex > qIndex ? raw.slice(qIndex, hIndex) : raw.slice(qIndex);
      }
      if (hIndex !== -1) {
        hash = raw.slice(hIndex);
      }
    }
  }

  const searchParams = new URLSearchParams(search);
  const errorDesc = searchParams.get('error_description') || searchParams.get('error');
  if (errorDesc) {
    throw new Error(errorDesc);
  }

  const code = searchParams.get('code');
  if (code) {
    const { data, error } = await client.auth.exchangeCodeForSession(code);
    if (error) throw new Error(error.message);
    return data.session;
  }

  const rawHash = hash.replace(/^#/, '');
  const hashParams = new URLSearchParams(rawHash);
  const hashErr = hashParams.get('error_description') || hashParams.get('error');
  if (hashErr) {
    throw new Error(hashErr);
  }
  const accessToken = hashParams.get('access_token');
  const refreshToken = hashParams.get('refresh_token');
  if (accessToken && refreshToken) {
    const { data, error } = await client.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) throw new Error(error.message);
    return data.session;
  }

  return getActiveSupabaseSession();
}

/**
 * Extracts and sets an active Supabase session directly from a raw URL or code string.
 * Supports deep link URLs (bhaviq://auth-callback?code=...), web URLs, hash fragments,
 * or direct authorization codes.
 */
export async function extractAuthSessionFromUrl(rawUrlOrParams: string): Promise<Session | null> {
  const client = getSupabaseClient();
  if (!client) {
    console.warn('[BhavIQ] extractAuthSessionFromUrl: Supabase Auth is not configured in environment.');
    return null;
  }

  const clean = rawUrlOrParams.trim();
  if (!clean) return null;

  // Direct bare authorization code check
  if (!clean.includes('?') && !clean.includes('#') && !clean.includes('=') && !clean.includes('/')) {
    const { data, error } = await client.auth.exchangeCodeForSession(clean);
    if (error) throw new Error(error.message);
    return data.session;
  }

  return completeSupabasePopupCallback({ url: clean });
}

const LOCAL_PROFILE_PREFIX = 'bhaviq_shop_profile_';
const inMemoryProfileStore = new Map<string, string>();

function getStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
    if (typeof globalThis !== 'undefined' && (globalThis as any).localStorage) return (globalThis as any).localStorage;
  } catch {
    // ignore
  }
  return null;
}

export function getLocalShopProfile(userId: string): Shop | null {
  if (!userId) return null;
  const storage = getStorage();
  try {
    const raw = storage
      ? storage.getItem(LOCAL_PROFILE_PREFIX + userId)
      : inMemoryProfileStore.get(LOCAL_PROFILE_PREFIX + userId);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveLocalShopProfile(userId: string, shop: Shop): void {
  if (!userId) return;
  const storage = getStorage();
  try {
    const serialized = JSON.stringify(shop);
    if (storage) {
      storage.setItem(LOCAL_PROFILE_PREFIX + userId, serialized);
      storage.setItem('bhaviq_active_user_id', userId);
    } else {
      inMemoryProfileStore.set(LOCAL_PROFILE_PREFIX + userId, serialized);
      inMemoryProfileStore.set('bhaviq_active_user_id', userId);
    }
  } catch {
    // ignore
  }
}

/**
 * Fetches the user's persistent shop profile from the Supabase database (shop_profiles vault)
 * linked strictly to auth.uid(). Returns null if the user has never onboarded.
 */
export async function fetchShopProfile(userId: string): Promise<Shop | null> {
  if (!userId) return null;
  const client = getSupabaseClient();
  if (client) {
    try {
      // 1. Direct query against shop_profiles vault table keyed by auth.uid()
      const { data, error } = await client
        .from('shop_profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (!error && data) {
        const mapped: Shop = {
          id: data.id,
          ownerId: data.user_id || userId,
          name: data.shop_name,
          businessType: data.business_type || 'Kirana & General Store',
          gstin: data.gstin || null,
          address: data.address || '',
          city: data.city || 'Mumbai',
          state: data.state || 'Maharashtra',
          pincode: data.pincode || null,
          phone: data.phone || null,
          taxMode: (data.tax_mode as 'gst_inclusive' | 'gst_exclusive' | 'non_gst') || 'gst_inclusive',
          currency: data.currency || 'INR',
          defaultMarginPct: Number(data.default_margin_pct) || 15,
          lowStockAlertEnabled: data.low_stock_alert_enabled !== false,
          role: 'owner',
          permissions: { all: true },
          createdAt: data.created_at || new Date().toISOString(),
        };
        saveLocalShopProfile(userId, mapped);
        return mapped;
      }

      // 2. Compatibility query against existing shops table
      const { data: fallbackShop } = await client
        .from('shops')
        .select('*')
        .eq('owner_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (fallbackShop) {
        const mapped: Shop = {
          id: fallbackShop.id,
          ownerId: fallbackShop.owner_id,
          name: fallbackShop.name,
          businessType: fallbackShop.business_type || 'Kirana & General Store',
          gstin: fallbackShop.gstin || null,
          address: fallbackShop.address || '',
          city: fallbackShop.city || 'Mumbai',
          state: fallbackShop.state || 'Maharashtra',
          pincode: fallbackShop.pincode || null,
          phone: fallbackShop.phone || null,
          taxMode: (fallbackShop.tax_mode as 'gst_inclusive' | 'gst_exclusive' | 'non_gst') || 'gst_inclusive',
          currency: fallbackShop.currency || 'INR',
          defaultMarginPct: Number(fallbackShop.default_margin_pct) || 15,
          lowStockAlertEnabled: fallbackShop.low_stock_alert_enabled !== false,
          role: 'owner',
          permissions: { all: true },
          createdAt: fallbackShop.created_at || new Date().toISOString(),
        };
        saveLocalShopProfile(userId, mapped);
        return mapped;
      }
    } catch (err) {
      console.warn('[BhavIQ] fetchShopProfile network query bypassed:', err);
    }
  }

  return getLocalShopProfile(userId);
}

/**
 * Permanently UPSERTs onboarding details into the Supabase shop_profiles table,
 * keyed by the authenticated user's ID (auth.uid()).
 */
export async function upsertShopProfile(profile: Partial<Shop> & { ownerName?: string }): Promise<Shop> {
  const client = getSupabaseClient();
  let userId = profile.ownerId || '';
  let fallbackOwnerName = profile.ownerName || 'BhavIQ Retailer';

  if (client) {
    try {
      const { data: userRes } = await client.auth.getUser();
      if (userRes?.user) {
        userId = userRes.user.id;
        fallbackOwnerName =
          profile.ownerName ||
          userRes.user.user_metadata?.full_name ||
          userRes.user.user_metadata?.name ||
          userRes.user.email?.split('@')[0] ||
          'BhavIQ Retailer';
      }
    } catch {
      // offline fallback
    }
  }

  if (!userId && typeof window !== 'undefined') {
    const cached = localStorage.getItem('bhaviq_active_user_id');
    if (cached) userId = cached;
  }

  if (!userId) {
    userId = `user_${Date.now().toString(36)}`;
  }

  const resolvedShop: Shop = {
    id: profile.id || userId,
    ownerId: userId,
    name: profile.name || `${fallbackOwnerName}'s Store`,
    businessType: profile.businessType || 'Kirana & General Store',
    gstin: profile.gstin || null,
    address: profile.address || '',
    city: profile.city || 'Mumbai',
    state: profile.state || 'Maharashtra',
    pincode: profile.pincode || null,
    phone: profile.phone || null,
    taxMode: profile.taxMode || 'gst_inclusive',
    currency: profile.currency || 'INR',
    defaultMarginPct: Number(profile.defaultMarginPct) || 15,
    lowStockAlertEnabled: profile.lowStockAlertEnabled !== false,
    role: 'owner',
    permissions: { all: true },
    createdAt: profile.createdAt || new Date().toISOString(),
  };

  // 1. Immediately cache locally
  saveLocalShopProfile(userId, resolvedShop);

  // 2. Persist to Supabase shop_profiles vault table
  if (client) {
    try {
      const payload = {
        id: userId, // primary key strictly linked to auth.uid()
        user_id: userId,
        owner_name: fallbackOwnerName,
        shop_name: resolvedShop.name,
        business_type: resolvedShop.businessType,
        gstin: resolvedShop.gstin,
        address: resolvedShop.address,
        city: resolvedShop.city,
        state: resolvedShop.state,
        pincode: resolvedShop.pincode,
        phone: resolvedShop.phone,
        tax_mode: resolvedShop.taxMode,
        currency: resolvedShop.currency,
        default_margin_pct: resolvedShop.defaultMarginPct,
        low_stock_alert_enabled: resolvedShop.lowStockAlertEnabled,
        updated_at: new Date().toISOString(),
      };

      const { error } = await client
        .from('shop_profiles')
        .upsert(payload, { onConflict: 'id' });

      if (error) {
        console.warn('[BhavIQ] Supabase shop_profiles upsert note:', error.message);
      }
    } catch (err) {
      console.warn('[BhavIQ] Supabase upsertShopProfile bypassed:', err);
    }
  }

  return resolvedShop;
}

/**
 * Constructs an AuthResultPayload directly from an active Supabase session.
 * If an existing shop profile exists in database, loads it; otherwise returns
 * an empty shops array so first-time users complete the onboarding setup.
 */
export function buildAuthResultFromSupabaseSession(
  session: Session,
  existingShop?: Shop | null
): {
  token: string;
  user: UserProfile;
  shops: Shop[];
  activeShopId: string | null;
} {
  const user = session.user;
  const meta = user.user_metadata || {};
  const fullName = String(
    meta.full_name || meta.name || user.email?.split('@')[0] || 'BhavIQ Retailer'
  );
  const phone = typeof meta.phone === 'string' && meta.phone.trim() ? meta.phone.trim() : null;

  const userProfile: UserProfile = {
    id: user.id,
    email: user.email || '',
    fullName,
    phone,
    preferredLanguage: 'en',
    theme: 'light',
    createdAt: user.created_at || new Date().toISOString(),
  };

  // 1. If explicit shop profile was provided
  if (existingShop) {
    return {
      token: session.access_token,
      user: userProfile,
      shops: [existingShop],
      activeShopId: existingShop.id,
    };
  }

  // 2. Check local persistent vault
  const cached = getLocalShopProfile(user.id);
  if (cached) {
    return {
      token: session.access_token,
      user: userProfile,
      shops: [cached],
      activeShopId: cached.id,
    };
  }

  // 3. First time user: no shop profile found
  return {
    token: session.access_token,
    user: userProfile,
    shops: [],
    activeShopId: null,
  };
}

export async function signOutSupabase(): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;
  try {
    await client.auth.signOut();
  } catch {
    // ignore cleanup error
  }
}
