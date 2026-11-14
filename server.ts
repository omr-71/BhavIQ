import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import express, { type Request, type Response, type NextFunction } from 'express';
import { createServer as createViteServer } from 'vite';
import { db, initSchema, logAudit, withTransaction } from './server/db';
import {
  computePriceAlertsForShop,
  ensureDefaultPriceSourcesForShop,
  getMarketAlertsStateForShop,
  loadProductsTypedForShop,
  syncAgmarknetForShop,
} from './server/market';
import { fetchLiveMasterMatrixFeed, startDailyMarketScheduler } from './server/marketFeed';
import { convertToBaseQuantity, roundCurrency, roundQty } from './src/lib/units';
import { allocatePurchaseLandedCosts } from './src/lib/pricing';
import { calculateInvoiceTotals, validatePaymentSplit } from './src/lib/finance';
import {
  buildProductWholesaleSummaries,
  calculateQuotationLandedCost,
  getTodayIsoDate,
  isPackSizeCompatible,
  isQuotationExpired,
} from './src/lib/wholesale';
import type {
  HistoricalPurchaseRatePoint,
  MarketPrice,
  PaymentMode,
  SupplierQuotation,
  UserRole,
} from './src/lib/types';

initSchema();

const app = express();
app.use(express.json({ limit: '2mb' }));

// --- Password & Session Helpers ---
function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, expectedHex] = stored.split(':');
  if (!salt || !expectedHex) return false;
  const actual = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

function parseCookies(cookieHeader?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = decodeURIComponent(part.slice(idx + 1).trim());
    out[key] = val;
  }
  return out;
}

function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const cookies = parseCookies(req.headers.cookie);
  return cookies.bhaviq_session || null;
}

interface AuthedRequest extends Request {
  userId?: string;
  sessionToken?: string;
  memberRole?: UserRole;
  memberPermissions?: Record<string, boolean>;
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const session = db
    .prepare(`SELECT * FROM sessions WHERE token = ? AND expires_at > ?`)
    .get(token, new Date().toISOString()) as { token: string; user_id: string } | undefined;

  if (!session) {
    res.status(401).json({ error: 'Session expired or invalid' });
    return;
  }
  req.userId = session.user_id;
  req.sessionToken = session.token;
  next();
}

function requireShopAccess(requiredPermission?: string) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    const shopId = req.params.shopId;
    if (!shopId || !req.userId) {
      res.status(400).json({ error: 'Invalid shop context' });
      return;
    }
    const membership = db
      .prepare(`SELECT role, permissions_json, status FROM shop_members WHERE shop_id = ? AND user_id = ?`)
      .get(shopId, req.userId) as
      | { role: UserRole; permissions_json: string; status: string }
      | undefined;

    if (!membership || membership.status !== 'active') {
      res.status(403).json({ error: 'You do not have access to this shop' });
      return;
    }

    const perms = JSON.parse(membership.permissions_json || '{}') as Record<string, boolean>;
    if (membership.role !== 'owner' && requiredPermission && !perms[requiredPermission]) {
      res.status(403).json({ error: `Permission "${requiredPermission}" required for this action` });
      return;
    }

    req.memberRole = membership.role;
    req.memberPermissions = perms;
    next();
  };
}

function getUserShops(userId: string) {
  const rows = db
    .prepare(`
      SELECT s.*, sm.role, sm.permissions_json
      FROM shops s
      JOIN shop_members sm ON sm.shop_id = s.id
      WHERE sm.user_id = ? AND sm.status = 'active'
      ORDER BY s.created_at ASC
    `)
    .all(userId) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: r.id as string,
    ownerId: r.owner_id as string,
    name: r.name as string,
    businessType: r.business_type as string,
    gstin: (r.gstin as string | null) ?? null,
    address: (r.address as string | null) ?? null,
    city: r.city as string,
    state: r.state as string,
    pincode: (r.pincode as string | null) ?? null,
    phone: (r.phone as string | null) ?? null,
    taxMode: r.tax_mode as 'gst_inclusive' | 'gst_exclusive' | 'non_gst',
    currency: r.currency as string,
    defaultMarginPct: Number(r.default_margin_pct),
    lowStockAlertEnabled: Boolean(r.low_stock_alert_enabled),
    role: r.role as UserRole,
    permissions: JSON.parse((r.permissions_json as string) || '{}') as Record<string, boolean>,
    createdAt: r.created_at as string,
  }));
}

function formatProfile(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    email: row.email as string,
    fullName: row.full_name as string,
    phone: (row.phone as string | null) ?? null,
    preferredLanguage: row.preferred_language as 'en' | 'hi' | 'mr',
    theme: row.theme as 'light' | 'dark',
    createdAt: row.created_at as string,
  };
}

function isHttpsRequest(req: Request): boolean {
  if (req.secure) return true;
  const proto = req.headers['x-forwarded-proto'];
  if (typeof proto === 'string' && proto.split(',')[0].trim() === 'https') return true;
  const origin = req.headers.origin || req.headers.referer || '';
  return origin.startsWith('https://');
}

function buildSessionCookie(req: Request, token: string, maxAgeSeconds: number): string {
  const secure = isHttpsRequest(req);
  if (secure) {
    return `bhaviq_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=${maxAgeSeconds}`;
  }
  return `bhaviq_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

function getAppBaseUrl(req: Request): string {
  const envUrl = process.env.APP_URL?.trim();
  if (envUrl) return envUrl.replace(/\/+$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
  const proto = isHttpsRequest(req) ? 'https' : 'http';
  return `${proto}://${host}`;
}

function upsertOAuthProfileAndCreateSession(params: {
  email: string;
  fullName: string;
  phone?: string | null;
  authProvider: 'supabase' | 'google';
  supabaseUid?: string | null;
}) {
  const normalizedEmail = params.email.trim().toLowerCase();
  const nowIso = new Date().toISOString();

  let profileRow = (
    params.supabaseUid
      ? db.prepare(`SELECT * FROM profiles WHERE supabase_uid = ?`).get(params.supabaseUid)
      : undefined
  ) as Record<string, unknown> | undefined;

  if (!profileRow) {
    profileRow = db.prepare(`SELECT * FROM profiles WHERE email = ?`).get(normalizedEmail) as
      | Record<string, unknown>
      | undefined;
  }

  let userId: string;
  if (profileRow) {
    userId = profileRow.id as string;
    db.prepare(`
      UPDATE profiles
      SET supabase_uid = COALESCE(?, supabase_uid),
          auth_provider = CASE WHEN auth_provider = 'password' THEN auth_provider ELSE ? END,
          full_name = CASE WHEN length(trim(full_name)) = 0 THEN ? ELSE full_name END,
          phone = COALESCE(phone, ?)
      WHERE id = ?
    `).run(
      params.supabaseUid || null,
      params.authProvider,
      params.fullName.trim() || normalizedEmail.split('@')[0],
      params.phone ?? null,
      userId
    );
    profileRow = db.prepare(`SELECT * FROM profiles WHERE id = ?`).get(userId) as Record<string, unknown>;
  } else {
    userId = crypto.randomUUID();
    const displayName = params.fullName.trim() || normalizedEmail.split('@')[0];
    db.prepare(`
      INSERT INTO profiles (
        id, email, password_hash, full_name, phone, preferred_language, theme, auth_provider, supabase_uid, created_at
      ) VALUES (?, ?, '!oauth-only!', ?, ?, 'en', 'light', ?, ?, ?)
    `).run(
      userId,
      normalizedEmail,
      displayName,
      params.phone ?? null,
      params.authProvider,
      params.supabaseUid ?? null,
      nowIso
    );
    profileRow = db.prepare(`SELECT * FROM profiles WHERE id = ?`).get(userId) as Record<string, unknown>;
  }

  const shops = getUserShops(userId);
  const activeShopId = shops[0]?.id ?? null;
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 86400 * 1000).toISOString();

  db.prepare(`INSERT INTO sessions (token, user_id, active_shop_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`).run(
    token,
    userId,
    activeShopId,
    expiresAt,
    nowIso
  );

  return {
    token,
    user: formatProfile(profileRow),
    shops,
    activeShopId,
  };
}

// --- Auth Routes ---
app.post('/api/auth/register', (req, res) => {
  const { email, password, fullName, phone } = req.body ?? {};
  if (!email || !password || !fullName) {
    res.status(400).json({ error: 'Full name, email, and password are required' });
    return;
  }
  const normalizedEmail = String(email).trim().toLowerCase();
  if (String(password).length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters' });
    return;
  }

  const existing = db.prepare(`SELECT id FROM profiles WHERE email = ?`).get(normalizedEmail);
  if (existing) {
    res.status(409).json({ error: 'An account with this email already exists' });
    return;
  }

  const userId = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  const passwordHash = hashPassword(String(password));

  db.prepare(`
    INSERT INTO profiles (id, email, password_hash, full_name, phone, preferred_language, theme, auth_provider, created_at)
    VALUES (?, ?, ?, ?, ?, 'en', 'light', 'password', ?)
  `).run(userId, normalizedEmail, passwordHash, String(fullName).trim(), phone ? String(phone).trim() : null, nowIso);

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 86400 * 1000).toISOString();
  db.prepare(`INSERT INTO sessions (token, user_id, active_shop_id, expires_at, created_at) VALUES (?, ?, NULL, ?, ?)`).run(
    token,
    userId,
    expiresAt,
    nowIso
  );

  res.setHeader('Set-Cookie', buildSessionCookie(req, token, 2592000));
  const profileRow = db.prepare(`SELECT * FROM profiles WHERE id = ?`).get(userId) as Record<string, unknown>;
  res.status(201).json({
    token,
    user: formatProfile(profileRow),
    shops: [],
    activeShopId: null,
  });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required' });
    return;
  }
  const normalizedEmail = String(email).trim().toLowerCase();
  const profileRow = db.prepare(`SELECT * FROM profiles WHERE email = ?`).get(normalizedEmail) as
    | Record<string, unknown>
    | undefined;

  if (!profileRow || !verifyPassword(String(password), profileRow.password_hash as string)) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  const userId = profileRow.id as string;
  const shops = getUserShops(userId);
  const activeShopId = shops[0]?.id ?? null;

  const token = crypto.randomBytes(32).toString('hex');
  const nowIso = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 30 * 86400 * 1000).toISOString();
  db.prepare(`INSERT INTO sessions (token, user_id, active_shop_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`).run(
    token,
    userId,
    activeShopId,
    expiresAt,
    nowIso
  );

  res.setHeader('Set-Cookie', buildSessionCookie(req, token, 2592000));
  res.json({
    token,
    user: formatProfile(profileRow),
    shops,
    activeShopId,
  });
});

app.post('/api/auth/supabase-exchange', async (req, res) => {
  const { accessToken } = req.body ?? {};
  const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const supabaseApiKey = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    ''
  ).trim();

  if (!supabaseUrl || !supabaseApiKey) {
    res.status(503).json({ error: 'Supabase Auth is not configured on the server.' });
    return;
  }
  if (!accessToken || typeof accessToken !== 'string') {
    res.status(400).json({ error: 'Supabase accessToken is required.' });
    return;
  }

  try {
    const verifyRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: supabaseApiKey,
      },
    });
    if (!verifyRes.ok) {
      res.status(401).json({ error: 'Supabase session could not be verified.' });
      return;
    }
    const sbUser = (await verifyRes.json()) as {
      id?: string;
      email?: string;
      user_metadata?: Record<string, unknown>;
    };

    if (!sbUser.id || !sbUser.email) {
      res.status(400).json({ error: 'Supabase user record is missing an email address.' });
      return;
    }

    const meta = sbUser.user_metadata || {};
    const fullName = String(
      meta.full_name || meta.name || sbUser.email.split('@')[0] || 'BhavIQ Retailer'
    );
    const phone = typeof meta.phone === 'string' && meta.phone.trim() ? meta.phone.trim() : null;

    const authPayload = upsertOAuthProfileAndCreateSession({
      email: sbUser.email,
      fullName,
      phone,
      authProvider: 'supabase',
      supabaseUid: sbUser.id,
    });

    // If no shops exist locally, query the Supabase shop_profiles vault table by auth.uid()
    if (authPayload.shops.length === 0 && sbUser.id) {
      try {
        const vaultRes = await fetch(`${supabaseUrl}/rest/v1/shop_profiles?id=eq.${encodeURIComponent(sbUser.id)}&select=*`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            apikey: supabaseApiKey,
          },
        });
        if (vaultRes.ok) {
          const vaultRows = (await vaultRes.json()) as any[];
          if (Array.isArray(vaultRows) && vaultRows.length > 0) {
            const row = vaultRows[0];
            const shopId = row.id || crypto.randomUUID();
            const nowIso = new Date().toISOString();
            const localUserId = authPayload.user.id;
            db.prepare(`
              INSERT OR IGNORE INTO shops (
                id, owner_id, name, business_type, gstin, address, city, state, pincode, phone,
                tax_mode, currency, default_margin_pct, low_stock_alert_enabled, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'INR', ?, 1, ?)
            `).run(
              shopId,
              localUserId,
              String(row.shop_name || `${fullName}'s Store`).trim(),
              String(row.business_type || 'Kirana & General Store').trim(),
              row.gstin ? String(row.gstin).trim() : null,
              row.address ? String(row.address).trim() : null,
              String(row.city || 'Mumbai').trim(),
              String(row.state || 'Maharashtra').trim(),
              row.pincode ? String(row.pincode).trim() : null,
              row.phone ? String(row.phone).trim() : null,
              row.tax_mode || 'gst_inclusive',
              Number(row.default_margin_pct) || 15,
              row.created_at || nowIso
            );

            db.prepare(`
              INSERT OR IGNORE INTO shop_members (id, shop_id, user_id, role, permissions_json, status, created_at)
              VALUES (?, ?, ?, 'owner', '{}', 'active', ?)
            `).run(crypto.randomUUID(), shopId, localUserId, nowIso);

            authPayload.shops = getUserShops(localUserId);
            authPayload.activeShopId = authPayload.shops[0]?.id ?? null;
            if (authPayload.activeShopId) {
              db.prepare(`UPDATE sessions SET active_shop_id = ? WHERE token = ?`).run(
                authPayload.activeShopId,
                authPayload.token
              );
            }
          }
        }
      } catch (vaultErr) {
        console.warn('Could not restore shop profile from Supabase vault:', vaultErr);
      }
    }

    res.setHeader('Set-Cookie', buildSessionCookie(req, authPayload.token, 2592000));
    res.json(authPayload);
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : 'Unable to verify Supabase Auth session.',
    });
  }
});

// --- Tauri Desktop & Browser OAuth Relay Store ---
interface OAuthRelayEntry {
  relayId: string;
  type: string;
  payload?: any;
  search?: string;
  hash?: string;
  error?: string;
  createdAt: number;
}
const oauthRelayStore = new Map<string, OAuthRelayEntry>();

function cleanOAuthRelayStore() {
  const now = Date.now();
  for (const [k, v] of oauthRelayStore.entries()) {
    if (now - v.createdAt > 10 * 60 * 1000) {
      oauthRelayStore.delete(k);
    }
  }
}

app.post('/api/auth/oauth-relay', (req, res) => {
  cleanOAuthRelayStore();
  const { relayId, type, payload, search, hash, error } = req.body || {};
  if (!relayId || typeof relayId !== 'string') {
    res.status(400).json({ error: 'relayId is required' });
    return;
  }
  oauthRelayStore.set(relayId, {
    relayId,
    type: type || 'BHAVIQ_SUPABASE_OAUTH_CALLBACK',
    payload,
    search,
    hash,
    error,
    createdAt: Date.now(),
  });
  res.json({ ok: true });
});

app.get('/api/auth/oauth-relay/status', (req, res) => {
  cleanOAuthRelayStore();
  const relayId = typeof req.query.relayId === 'string' ? req.query.relayId.trim() : '';
  if (!relayId) {
    res.status(400).json({ error: 'relayId is required' });
    return;
  }
  const entry = oauthRelayStore.get(relayId);
  if (!entry) {
    res.json({ status: 'pending' });
    return;
  }
  oauthRelayStore.delete(relayId);
  res.json({ status: 'completed', data: entry });
});

app.get('/api/auth/google/url', (req, res) => {
  const clientId = (process.env.GOOGLE_CLIENT_ID || process.env.OAUTH_CLIENT_ID || '').trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || process.env.OAUTH_CLIENT_SECRET || '').trim();
  const baseUrl = getAppBaseUrl(req);
  const relayId = typeof req.query.relay_id === 'string' ? req.query.relay_id.trim() : '';
  const callbackUrl = relayId
    ? `${baseUrl}/auth/callback?relay_id=${encodeURIComponent(relayId)}`
    : `${baseUrl}/auth/callback`;

  if (!clientId || !clientSecret) {
    res.json({
      configured: false,
      provider: 'unconfigured',
      callbackUrl,
    });
    return;
  }

  const state = relayId
    ? `google-oauth:${encodeURIComponent(relayId)}:${crypto.randomBytes(12).toString('hex')}`
    : `google-oauth:${crypto.randomBytes(16).toString('hex')}`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'select_account',
    state,
  });

  res.json({
    configured: true,
    provider: 'google',
    callbackUrl,
    url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
  });
});

app.get(['/auth/callback', '/auth/callback/'], async (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const oauthError = typeof req.query.error === 'string' ? req.query.error : '';

  let relayId = typeof req.query.relay_id === 'string' ? req.query.relay_id.trim() : '';
  if (!relayId && state.startsWith('google-oauth:')) {
    const parts = state.split(':');
    if (parts.length >= 3) {
      relayId = decodeURIComponent(parts[1]);
    }
  }

  if (oauthError) {
    if (relayId) {
      oauthRelayStore.set(relayId, {
        relayId,
        type: 'BHAVIQ_OAUTH_ERROR',
        error: oauthError,
        createdAt: Date.now(),
      });
    }
    res.status(200).send(`<!doctype html><html><head><meta charset="utf-8"><title>Authentication Cancelled - BhavIQ</title><style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f8fafc; color: #0f172a; }
      .card { background: white; border-radius: 16px; padding: 36px 32px; max-width: 440px; text-align: center; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.08); border: 1px solid #e2e8f0; }
      h2 { margin: 12px 0 8px; font-size: 20px; font-weight: 700; color: #dc2626; }
      p { font-size: 14px; color: #64748b; margin: 0 0 20px; line-height: 1.5; }
      button { background: #0f172a; color: white; border: none; padding: 10px 22px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; }
    </style></head><body>
      <div class="card">
        <div style="font-size: 40px; margin-bottom: 8px;">⚠️</div>
        <h2>Sign-in Cancelled</h2>
        <p>${oauthError.replace(/</g, '&lt;')}</p>
        <button onclick="window.close()">Close Window</button>
      </div>
      <script>
        if (window.opener) {
          window.opener.postMessage({ type: 'BHAVIQ_OAUTH_ERROR', error: ${JSON.stringify(oauthError)} }, '*');
          setTimeout(() => { try { window.close(); } catch(e){} }, 1000);
        }
        try { const bc = new BroadcastChannel('bhaviq_oauth'); bc.postMessage({ type: 'BHAVIQ_OAUTH_ERROR', error: ${JSON.stringify(oauthError)} }); } catch(e){}
      </script>
    </body></html>`);
    return;
  }

  // Handle direct Google OAuth server callback when state starts with google-oauth:
  const clientId = (process.env.GOOGLE_CLIENT_ID || process.env.OAUTH_CLIENT_ID || '').trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || process.env.OAUTH_CLIENT_SECRET || '').trim();
  if (code && state.startsWith('google-oauth:') && clientId && clientSecret) {
    try {
      const baseUrl = getAppBaseUrl(req);
      const callbackUrl = relayId
        ? `${baseUrl}/auth/callback?relay_id=${encodeURIComponent(relayId)}`
        : `${baseUrl}/auth/callback`;

      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: callbackUrl,
          grant_type: 'authorization_code',
        }),
      });
      if (!tokenRes.ok) {
        throw new Error(`Google token exchange failed (${tokenRes.status})`);
      }
      const tokenJson = (await tokenRes.json()) as { access_token?: string };
      if (!tokenJson.access_token) {
        throw new Error('Google did not return an access token.');
      }

      const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${tokenJson.access_token}` },
      });
      if (!userRes.ok) {
        throw new Error('Failed to fetch Google user profile.');
      }
      const gUser = (await userRes.json()) as { email?: string; name?: string };
      if (!gUser.email) {
        throw new Error('Google account has no verified email address.');
      }

      const authPayload = upsertOAuthProfileAndCreateSession({
        email: gUser.email,
        fullName: gUser.name || gUser.email.split('@')[0],
        authProvider: 'google',
      });

      if (relayId) {
        oauthRelayStore.set(relayId, {
          relayId,
          type: 'BHAVIQ_GOOGLE_AUTH_SUCCESS',
          payload: authPayload,
          createdAt: Date.now(),
        });
      }

      res.setHeader('Set-Cookie', buildSessionCookie(req, authPayload.token, 2592000));
      res.status(200).send(`<!doctype html><html><head><meta charset="utf-8"><title>Authentication Successful - BhavIQ</title><style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #0f172a; color: white; }
        .card { background: #1e293b; border-radius: 20px; padding: 40px 32px; max-width: 440px; text-align: center; box-shadow: 0 20px 40px -10px rgba(0,0,0,0.5); border: 1px solid #334155; }
        .icon { width: 64px; height: 64px; border-radius: 50%; background: rgba(34, 197, 94, 0.15); border: 2px solid #22c55e; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; font-size: 28px; }
        h2 { margin: 0 0 8px; font-size: 22px; font-weight: 700; color: #ffffff; }
        p { font-size: 14px; color: #94a3b8; margin: 0 0 24px; line-height: 1.5; }
        button { background: #2563eb; color: white; border: none; padding: 11px 24px; border-radius: 10px; font-size: 14px; font-weight: 600; cursor: pointer; transition: background 0.15s; }
        button:hover { background: #1d4ed8; }
      </style></head><body>
        <div class="card">
          <div class="icon">✓</div>
          <h2>Authentication Successful!</h2>
          <p>You have signed in to BhavIQ. You can close this browser window and return to the BhavIQ Desktop app.</p>
          <button onclick="window.close()">Close Window</button>
        </div>
        <script>
          if (window.opener) {
            window.opener.postMessage({ type: 'BHAVIQ_GOOGLE_AUTH_SUCCESS', payload: ${JSON.stringify(authPayload)} }, '*');
            setTimeout(() => { try { window.close(); } catch(e){} }, 1000);
          }
          try {
            const bc = new BroadcastChannel('bhaviq_oauth');
            bc.postMessage({ type: 'BHAVIQ_GOOGLE_AUTH_SUCCESS', payload: ${JSON.stringify(authPayload)} });
          } catch(e){}
        </script>
      </body></html>`);
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google OAuth failed';
      if (relayId) {
        oauthRelayStore.set(relayId, {
          relayId,
          type: 'BHAVIQ_OAUTH_ERROR',
          error: msg,
          createdAt: Date.now(),
        });
      }
      res.status(200).send(`<!doctype html><html><body style="font-family:system-ui,sans-serif;padding:24px;color:#0f172a">
        <script>
          if (window.opener) {
            window.opener.postMessage({ type: 'BHAVIQ_OAUTH_ERROR', error: ${JSON.stringify(msg)} }, '*');
            setTimeout(() => { try { window.close(); } catch(e){} }, 1000);
          }
          try { const bc = new BroadcastChannel('bhaviq_oauth'); bc.postMessage({ type: 'BHAVIQ_OAUTH_ERROR', error: ${JSON.stringify(msg)} }); } catch(e){}
        </script>
        <p>Google sign-in error: ${msg.replace(/</g, '&lt;')}</p>
        <button onclick="window.close()">Close Window</button>
      </body></html>`);
      return;
    }
  }

  // Supabase OAuth PKCE (?code=...) or implicit (#access_token=...) callback bridge
  res.status(200).send(`<!doctype html><html><head><meta charset="utf-8"><title>Signing In - BhavIQ</title><style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #0f172a; color: white; }
    .card { background: #1e293b; border-radius: 20px; padding: 40px 32px; max-width: 440px; text-align: center; box-shadow: 0 20px 40px -10px rgba(0,0,0,0.5); border: 1px solid #334155; }
    .icon { width: 64px; height: 64px; border-radius: 50%; background: rgba(34, 197, 94, 0.15); border: 2px solid #22c55e; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; font-size: 28px; }
    h2 { margin: 0 0 8px; font-size: 22px; font-weight: 700; color: #ffffff; }
    p { font-size: 14px; color: #94a3b8; margin: 0 0 24px; line-height: 1.5; }
    button { background: #2563eb; color: white; border: none; padding: 11px 24px; border-radius: 10px; font-size: 14px; font-weight: 600; cursor: pointer; }
    button:hover { background: #1d4ed8; }
  </style></head><body>
    <div class="card">
      <div class="icon">✓</div>
      <h2>Authentication Completed!</h2>
      <p>Synchronizing session with BhavIQ Desktop POS. You may close this tab now.</p>
      <button onclick="window.close()">Close Window</button>
    </div>
    <script>
      (function() {
        const search = window.location.search;
        const hash = window.location.hash;
        const searchParams = new URLSearchParams(search);
        let relayId = searchParams.get('relay_id') || searchParams.get('state_relay') || '';
        if (!relayId) {
          const state = searchParams.get('state') || '';
          if (state.startsWith('google-oauth:')) {
            const parts = state.split(':');
            if (parts.length >= 3) relayId = decodeURIComponent(parts[1]);
          }
        }

        const payload = {
          type: 'BHAVIQ_SUPABASE_OAUTH_CALLBACK',
          search: search,
          hash: hash,
          relayId: relayId
        };

        if (window.opener) {
          window.opener.postMessage(payload, '*');
          setTimeout(() => { try { window.close(); } catch(e){} }, 1000);
        }

        try {
          const bc = new BroadcastChannel('bhaviq_oauth');
          bc.postMessage(payload);
        } catch(e) {}

        if (relayId) {
          fetch('/api/auth/oauth-relay', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              relayId: relayId,
              type: 'BHAVIQ_SUPABASE_OAUTH_CALLBACK',
              search: search,
              hash: hash
            })
          }).then(() => {
            setTimeout(() => { try { window.close(); } catch(e){} }, 1200);
          }).catch(console.error);
        } else if (!window.opener) {
          setTimeout(() => { window.location.href = '/'; }, 2000);
        }
      })();
    </script>
  </body></html>`);
});

app.post('/api/auth/logout', requireAuth, (req: AuthedRequest, res) => {
  if (req.sessionToken) {
    db.prepare(`DELETE FROM sessions WHERE token = ?`).run(req.sessionToken);
  }
  res.setHeader('Set-Cookie', buildSessionCookie(req, '', 0));
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res) => {
  const profileRow = db.prepare(`SELECT * FROM profiles WHERE id = ?`).get(req.userId!) as
    | Record<string, unknown>
    | undefined;
  if (!profileRow) {
    res.status(404).json({ error: 'Profile not found' });
    return;
  }
  const sessionRow = db.prepare(`SELECT active_shop_id FROM sessions WHERE token = ?`).get(req.sessionToken!) as
    | { active_shop_id: string | null }
    | undefined;
  const shops = getUserShops(req.userId!);
  const activeShopId =
    shops.find((s) => s.id === sessionRow?.active_shop_id)?.id ?? shops[0]?.id ?? null;

  res.json({
    user: formatProfile(profileRow),
    shops,
    activeShopId,
  });
});

app.patch('/api/auth/preferences', requireAuth, (req: AuthedRequest, res) => {
  const { theme, preferredLanguage, fullName, phone } = req.body ?? {};
  const current = db.prepare(`SELECT * FROM profiles WHERE id = ?`).get(req.userId!) as Record<string, string | null>;
  const nextTheme = theme === 'dark' || theme === 'light' ? String(theme) : String(current.theme || 'light');
  const nextLang =
    preferredLanguage === 'en' || preferredLanguage === 'hi' || preferredLanguage === 'mr'
      ? String(preferredLanguage)
      : String(current.preferred_language || 'en');
  const nextName = fullName ? String(fullName).trim() : String(current.full_name || '');
  const nextPhone = phone !== undefined ? (phone ? String(phone).trim() : null) : current.phone;

  db.prepare(`UPDATE profiles SET theme = ?, preferred_language = ?, full_name = ?, phone = ? WHERE id = ?`).run(
    nextTheme,
    nextLang,
    nextName,
    nextPhone,
    req.userId!
  );
  const updated = db.prepare(`SELECT * FROM profiles WHERE id = ?`).get(req.userId!) as Record<string, unknown>;
  res.json({ user: formatProfile(updated) });
});

// --- Shops & RBAC ---
app.post('/api/shops', requireAuth, (req: AuthedRequest, res) => {
  const { name, businessType, gstin, address, city, state, pincode, phone, taxMode, defaultMarginPct } =
    req.body ?? {};
  if (!name || !businessType || !city || !state) {
    res.status(400).json({ error: 'Shop name, business type, city, and state are required' });
    return;
  }

  const shopId = crypto.randomUUID();
  const nowIso = new Date().toISOString();

  withTransaction(() => {
    db.prepare(`
      INSERT INTO shops (
        id, owner_id, name, business_type, gstin, address, city, state, pincode, phone,
        tax_mode, currency, default_margin_pct, low_stock_alert_enabled, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'INR', ?, 1, ?)
    `).run(
      shopId,
      req.userId!,
      String(name).trim(),
      String(businessType).trim(),
      gstin ? String(gstin).trim() : null,
      address ? String(address).trim() : null,
      String(city).trim(),
      String(state).trim(),
      pincode ? String(pincode).trim() : null,
      phone ? String(phone).trim() : null,
      taxMode === 'gst_exclusive' || taxMode === 'non_gst' ? taxMode : 'gst_inclusive',
      Number.isFinite(Number(defaultMarginPct)) ? Number(defaultMarginPct) : 15,
      nowIso
    );

    const ownerPermissions = {
      billing: true,
      inventory: true,
      khata: true,
      purchases: true,
      suppliers: true,
      market: true,
      reports: true,
      expenses: true,
      settings: true,
    };

    db.prepare(`
      INSERT INTO shop_members (id, shop_id, user_id, role, permissions_json, status, created_at)
      VALUES (?, ?, ?, 'owner', ?, 'active', ?)
    `).run(crypto.randomUUID(), shopId, req.userId!, JSON.stringify(ownerPermissions), nowIso);

    db.prepare(`UPDATE sessions SET active_shop_id = ? WHERE token = ?`).run(shopId, req.sessionToken!);

    ensureDefaultPriceSourcesForShop(shopId);

    logAudit({
      id: crypto.randomUUID(),
      shopId,
      userId: req.userId!,
      action: 'shop.created',
      entityType: 'shop',
      entityId: shopId,
      details: { name, businessType, city, state },
    });
  });

  const shops = getUserShops(req.userId!);
  const createdShop = shops.find((s) => s.id === shopId);

  // Background sync to Supabase shop_profiles table if user is linked to Supabase Auth UID
  const userProfileRow = db.prepare(`SELECT supabase_uid, full_name, phone FROM profiles WHERE id = ?`).get(req.userId!) as
    | { supabase_uid: string | null; full_name: string; phone: string | null }
    | undefined;

  const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();

  if (userProfileRow?.supabase_uid && supabaseUrl && supabaseKey) {
    const vaultPayload = {
      id: userProfileRow.supabase_uid,
      user_id: userProfileRow.supabase_uid,
      owner_name: userProfileRow.full_name || 'BhavIQ Retailer',
      shop_name: String(name).trim(),
      business_type: String(businessType).trim(),
      gstin: gstin ? String(gstin).trim() : null,
      address: address ? String(address).trim() : null,
      city: String(city).trim(),
      state: String(state).trim(),
      pincode: pincode ? String(pincode).trim() : null,
      phone: phone ? String(phone).trim() : userProfileRow.phone,
      tax_mode: taxMode === 'gst_exclusive' || taxMode === 'non_gst' ? taxMode : 'gst_inclusive',
      currency: 'INR',
      default_margin_pct: Number.isFinite(Number(defaultMarginPct)) ? Number(defaultMarginPct) : 15,
      low_stock_alert_enabled: true,
      updated_at: new Date().toISOString(),
    };

    fetch(`${supabaseUrl}/rest/v1/shop_profiles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supabaseKey}`,
        apikey: supabaseKey,
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify(vaultPayload),
    }).catch((err) => {
      console.warn('Background shop_profiles sync note:', err);
    });
  }

  res.status(201).json({ shop: createdShop, shops });
});

app.post('/api/shops/switch', requireAuth, (req: AuthedRequest, res) => {
  const { shopId } = req.body ?? {};
  const member = db
    .prepare(`SELECT id FROM shop_members WHERE shop_id = ? AND user_id = ? AND status = 'active'`)
    .get(shopId, req.userId!);
  if (!member) {
    res.status(403).json({ error: 'Shop access denied' });
    return;
  }
  db.prepare(`UPDATE sessions SET active_shop_id = ? WHERE token = ?`).run(shopId, req.sessionToken!);
  res.json({ activeShopId: shopId });
});

app.patch('/api/shops/:shopId', requireAuth, requireShopAccess('settings'), (req: AuthedRequest, res) => {
  if (req.memberRole !== 'owner') {
    res.status(403).json({ error: 'Only the shop owner can modify shop settings' });
    return;
  }
  const shopId = req.params.shopId;
  const current = db.prepare(`SELECT * FROM shops WHERE id = ?`).get(shopId) as Record<string, string | number | null>;
  const b = req.body ?? {};

  db.prepare(`
    UPDATE shops SET
      name = ?, business_type = ?, gstin = ?, address = ?, city = ?, state = ?, pincode = ?, phone = ?,
      tax_mode = ?, default_margin_pct = ?, low_stock_alert_enabled = ?
    WHERE id = ?
  `).run(
    b.name ? String(b.name).trim() : String(current.name),
    b.businessType ? String(b.businessType).trim() : String(current.business_type),
    b.gstin !== undefined ? (b.gstin ? String(b.gstin).trim() : null) : current.gstin,
    b.address !== undefined ? (b.address ? String(b.address).trim() : null) : current.address,
    b.city ? String(b.city).trim() : String(current.city),
    b.state ? String(b.state).trim() : String(current.state),
    b.pincode !== undefined ? (b.pincode ? String(b.pincode).trim() : null) : current.pincode,
    b.phone !== undefined ? (b.phone ? String(b.phone).trim() : null) : current.phone,
    b.taxMode ? String(b.taxMode) : String(current.tax_mode),
    Number.isFinite(Number(b.defaultMarginPct)) ? Number(b.defaultMarginPct) : Number(current.default_margin_pct),
    b.lowStockAlertEnabled !== undefined ? (b.lowStockAlertEnabled ? 1 : 0) : Number(current.low_stock_alert_enabled),
    shopId
  );

  logAudit({
    id: crypto.randomUUID(),
    shopId,
    userId: req.userId!,
    action: 'shop.updated',
    entityType: 'shop',
    entityId: shopId,
    details: b,
  });

  const shops = getUserShops(req.userId!);
  res.json({ shop: shops.find((s) => s.id === shopId) });
});

app.get('/api/shops/:shopId/members', requireAuth, requireShopAccess('settings'), (req: AuthedRequest, res) => {
  const rows = db
    .prepare(`
      SELECT sm.*, p.email, p.full_name, p.phone
      FROM shop_members sm
      JOIN profiles p ON p.id = sm.user_id
      WHERE sm.shop_id = ?
      ORDER BY sm.created_at ASC
    `)
    .all(req.params.shopId) as Array<Record<string, unknown>>;

  res.json({
    members: rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      email: r.email,
      fullName: r.full_name,
      phone: r.phone,
      role: r.role,
      permissions: JSON.parse((r.permissions_json as string) || '{}'),
      status: r.status,
      createdAt: r.created_at,
    })),
  });
});

app.post('/api/shops/:shopId/members', requireAuth, requireShopAccess('settings'), (req: AuthedRequest, res) => {
  if (req.memberRole !== 'owner') {
    res.status(403).json({ error: 'Only the shop owner can add staff members' });
    return;
  }
  const { email, fullName, password, permissions } = req.body ?? {};
  if (!email || !fullName) {
    res.status(400).json({ error: 'Staff email and full name are required' });
    return;
  }
  const normalizedEmail = String(email).trim().toLowerCase();
  const shopId = req.params.shopId;
  const nowIso = new Date().toISOString();

  let profile = db.prepare(`SELECT * FROM profiles WHERE email = ?`).get(normalizedEmail) as
    | Record<string, unknown>
    | undefined;

  if (!profile) {
    if (!password || String(password).length < 6) {
      res.status(400).json({ error: 'Provide an initial password (min 6 chars) for new staff account' });
      return;
    }
    const newId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO profiles (id, email, password_hash, full_name, preferred_language, theme, created_at)
      VALUES (?, ?, ?, ?, 'en', 'light', ?)
    `).run(newId, normalizedEmail, hashPassword(String(password)), String(fullName).trim(), nowIso);
    profile = db.prepare(`SELECT * FROM profiles WHERE id = ?`).get(newId) as Record<string, unknown>;
  }

  const userId = profile.id as string;
  const existingMember = db
    .prepare(`SELECT id FROM shop_members WHERE shop_id = ? AND user_id = ?`)
    .get(shopId, userId);
  if (existingMember) {
    res.status(409).json({ error: 'User is already a member of this shop' });
    return;
  }

  const defaultStaffPerms = {
    billing: true,
    inventory: true,
    khata: true,
    purchases: false,
    suppliers: false,
    market: true,
    reports: false,
    expenses: false,
    settings: false,
    ...(permissions || {}),
  };

  db.prepare(`
    INSERT INTO shop_members (id, shop_id, user_id, role, permissions_json, status, created_at)
    VALUES (?, ?, ?, 'staff', ?, 'active', ?)
  `).run(crypto.randomUUID(), shopId, userId, JSON.stringify(defaultStaffPerms), nowIso);

  logAudit({
    id: crypto.randomUUID(),
    shopId,
    userId: req.userId!,
    action: 'staff.added',
    entityType: 'shop_member',
    entityId: userId,
    details: { email: normalizedEmail, permissions: defaultStaffPerms },
  });

  res.status(201).json({ ok: true });
});

// --- Suppliers ---
app.get('/api/shops/:shopId/suppliers', requireAuth, requireShopAccess('suppliers'), (req, res) => {
  const rows = db
    .prepare(`
      SELECT s.*,
        (SELECT COUNT(*) FROM purchases p WHERE p.supplier_id = s.id) as purchase_count,
        (SELECT COALESCE(SUM(p.total_amount), 0) FROM purchases p WHERE p.supplier_id = s.id) as total_purchased
      FROM suppliers s
      WHERE s.shop_id = ?
      ORDER BY s.name ASC
    `)
    .all(req.params.shopId) as Array<Record<string, unknown>>;

  res.json({
    suppliers: rows.map((r) => ({
      id: r.id,
      shopId: r.shop_id,
      name: r.name,
      contactPerson: r.contact_person,
      phone: r.phone,
      email: r.email,
      location: r.location,
      categories: JSON.parse((r.categories_json as string) || '[]'),
      gstin: r.gstin,
      notes: r.notes,
      purchaseCount: Number(r.purchase_count),
      totalPurchased: Number(r.total_purchased),
      createdAt: r.created_at,
    })),
  });
});

app.post('/api/shops/:shopId/suppliers', requireAuth, requireShopAccess('suppliers'), (req: AuthedRequest, res) => {
  const { name, contactPerson, phone, email, location, categories, gstin, notes } = req.body ?? {};
  if (!name || !String(name).trim()) {
    res.status(400).json({ error: 'Supplier name is required' });
    return;
  }
  const id = crypto.randomUUID();
  const nowIso = new Date().toISOString();

  db.prepare(`
    INSERT INTO suppliers (id, shop_id, name, contact_person, phone, email, location, categories_json, gstin, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    req.params.shopId,
    String(name).trim(),
    contactPerson ? String(contactPerson).trim() : null,
    phone ? String(phone).trim() : null,
    email ? String(email).trim() : null,
    location ? String(location).trim() : null,
    JSON.stringify(Array.isArray(categories) ? categories : []),
    gstin ? String(gstin).trim() : null,
    notes ? String(notes).trim() : null,
    nowIso
  );

  logAudit({
    id: crypto.randomUUID(),
    shopId: req.params.shopId,
    userId: req.userId!,
    action: 'supplier.created',
    entityType: 'supplier',
    entityId: id,
    details: { name },
  });

  res.status(201).json({ id });
});

// --- Products & Inventory ---
function loadProductsForShop(shopId: string) {
  return loadProductsTypedForShop(shopId);
}

app.get('/api/shops/:shopId/products', requireAuth, requireShopAccess('inventory'), (req, res) => {
  const products = loadProductsForShop(req.params.shopId);
  const movements = db
    .prepare(`
      SELECT sm.*, p.name as product_name
      FROM stock_movements sm
      JOIN products p ON p.id = sm.product_id
      WHERE sm.shop_id = ?
      ORDER BY sm.created_at DESC
      LIMIT 100
    `)
    .all(req.params.shopId) as Array<Record<string, unknown>>;

  res.json({
    products,
    movements: movements.map((m) => ({
      id: m.id,
      shopId: m.shop_id,
      productId: m.product_id,
      productName: m.product_name,
      movementType: m.movement_type,
      quantityDelta: Number(m.quantity_delta),
      unitName: m.unit_name,
      unitQuantity: Number(m.unit_quantity),
      referenceType: m.reference_type,
      referenceId: m.reference_id,
      note: m.note,
      createdBy: m.created_by,
      createdAt: m.created_at,
    })),
  });
});

app.post('/api/shops/:shopId/products', requireAuth, requireShopAccess('inventory'), (req: AuthedRequest, res) => {
  const b = req.body ?? {};
  if (!b.name || !b.category || !b.baseUnit || !Number.isFinite(Number(b.sellingPrice))) {
    res.status(400).json({ error: 'Product name, category, base unit, and selling price are required' });
    return;
  }
  const shopId = req.params.shopId;
  const productId = crypto.randomUUID();
  const nowIso = new Date().toISOString();

  const initialStock = Number.isFinite(Number(b.currentStock)) ? Math.max(0, Number(b.currentStock)) : 0;
  const purchasePrice =
    b.purchasePrice !== null && b.purchasePrice !== undefined && b.purchasePrice !== ''
      ? Number(b.purchasePrice)
      : null;
  const landedCost =
    b.landedCost !== null && b.landedCost !== undefined && b.landedCost !== ''
      ? Number(b.landedCost)
      : purchasePrice;

  const isAgri =
    b.category === 'Vegetables' ||
    b.category === 'Fruits' ||
    b.category === 'Grains' ||
    b.category === 'Pulses' ||
    b.category === 'Loose Products';
  const coverageStatus = b.marketCommodityName
    ? isAgri
      ? 'available'
      : 'historical_only'
    : isAgri
      ? 'partial'
      : 'supplier_quote_only';

  withTransaction(() => {
    db.prepare(`
      INSERT INTO products (
        id, shop_id, name, brand, pack_size, variety, category, barcode, sku, base_unit,
        purchase_price, landed_cost, selling_price, mrp, tax_rate_pct, mrp_restricted,
        current_stock, min_stock_level, primary_supplier_id, expiry_date, batch_number,
        image_url, market_commodity_name, market_coverage_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      productId,
      shopId,
      String(b.name).trim(),
      b.brand ? String(b.brand).trim() : null,
      b.packSize ? String(b.packSize).trim() : null,
      b.variety ? String(b.variety).trim() : null,
      String(b.category),
      b.barcode ? String(b.barcode).trim() : null,
      b.sku ? String(b.sku).trim() : null,
      String(b.baseUnit),
      purchasePrice,
      landedCost,
      Number(b.sellingPrice),
      b.mrp !== null && b.mrp !== undefined && b.mrp !== '' ? Number(b.mrp) : null,
      Number.isFinite(Number(b.taxRatePct)) ? Number(b.taxRatePct) : 0,
      b.mrpRestricted === false ? 0 : 1,
      initialStock,
      Number.isFinite(Number(b.minStockLevel)) ? Math.max(0, Number(b.minStockLevel)) : 0,
      b.primarySupplierId || null,
      b.expiryDate || null,
      b.batchNumber || null,
      b.imageUrl || null,
      b.marketCommodityName ? String(b.marketCommodityName).trim() : null,
      coverageStatus,
      nowIso,
      nowIso
    );

    if (Array.isArray(b.units)) {
      const unitStmt = db.prepare(`
        INSERT INTO product_units (id, shop_id, product_id, unit_name, conversion_to_base, is_default_sell_unit, is_default_buy_unit)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const u of b.units) {
        if (!u.unitName || !Number.isFinite(Number(u.conversionToBase)) || Number(u.conversionToBase) <= 0) {
          continue;
        }
        unitStmt.run(
          crypto.randomUUID(),
          shopId,
          productId,
          String(u.unitName).trim(),
          Number(u.conversionToBase),
          u.isDefaultSellUnit ? 1 : 0,
          u.isDefaultBuyUnit ? 1 : 0
        );
      }
    }

    if (initialStock > 0) {
      db.prepare(`
        INSERT INTO stock_movements (id, shop_id, product_id, movement_type, quantity_delta, unit_name, unit_quantity, reference_type, reference_id, note, created_by, created_at)
        VALUES (?, ?, ?, 'adjustment', ?, ?, ?, 'opening_stock', ?, 'Opening stock on product creation', ?, ?)
      `).run(crypto.randomUUID(), shopId, productId, initialStock, String(b.baseUnit), initialStock, productId, req.userId!, nowIso);
    }

    logAudit({
      id: crypto.randomUUID(),
      shopId,
      userId: req.userId!,
      action: 'product.created',
      entityType: 'product',
      entityId: productId,
      details: { name: b.name, sellingPrice: b.sellingPrice, initialStock },
    });
  });

  res.status(201).json({ id: productId });
});

app.post(
  '/api/shops/:shopId/products/:productId/stock-adjustment',
  requireAuth,
  requireShopAccess('inventory'),
  (req: AuthedRequest, res) => {
    const { movementType, quantity, unitName, note } = req.body ?? {};
    const validTypes = ['return', 'damaged', 'expiry', 'adjustment'];
    if (!validTypes.includes(movementType)) {
      res.status(400).json({ error: 'Invalid stock movement type' });
      return;
    }
    const qtyNum = Number(quantity);
    if (!Number.isFinite(qtyNum) || qtyNum === 0) {
      res.status(400).json({ error: 'Quantity must be non-zero' });
      return;
    }
    if (!note || !String(note).trim()) {
      res.status(400).json({ error: 'An audit note is required for manual stock adjustments' });
      return;
    }

    const shopId = req.params.shopId;
    const productId = req.params.productId;
    const prod = loadProductsForShop(shopId).find((p) => p.id === productId);
    if (!prod) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    const chosenUnit = unitName || prod.baseUnit;
    const absBaseQty = convertToBaseQuantity(Math.abs(qtyNum), chosenUnit, prod.baseUnit, prod.units);
    const delta =
      movementType === 'damaged' || movementType === 'expiry'
        ? -absBaseQty
        : movementType === 'return'
          ? absBaseQty
          : qtyNum > 0
            ? absBaseQty
            : -absBaseQty;

    const nextStock = roundQty(prod.currentStock + delta);
    if (nextStock < 0) {
      res.status(400).json({ error: `Adjustment would reduce stock below zero (current: ${prod.currentStock})` });
      return;
    }

    const nowIso = new Date().toISOString();
    withTransaction(() => {
      db.prepare(`UPDATE products SET current_stock = ?, updated_at = ? WHERE id = ? AND shop_id = ?`).run(
        nextStock,
        nowIso,
        productId,
        shopId
      );
      db.prepare(`
        INSERT INTO stock_movements (id, shop_id, product_id, movement_type, quantity_delta, unit_name, unit_quantity, reference_type, reference_id, note, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'manual_audit', ?, ?, ?, ?)
      `).run(
        crypto.randomUUID(),
        shopId,
        productId,
        movementType,
        delta,
        chosenUnit,
        Math.abs(qtyNum),
        productId,
        String(note).trim(),
        req.userId!,
        nowIso
      );
      logAudit({
        id: crypto.randomUUID(),
        shopId,
        userId: req.userId!,
        action: 'stock.adjusted',
        entityType: 'product',
        entityId: productId,
        details: { movementType, delta, chosenUnit, note },
      });
    });

    res.json({ ok: true, currentStock: nextStock });
  }
);

// --- Khata / Customers ---
app.get('/api/shops/:shopId/customers', requireAuth, requireShopAccess('khata'), (req, res) => {
  const customers = db
    .prepare(`SELECT * FROM customers WHERE shop_id = ? ORDER BY name ASC`)
    .all(req.params.shopId) as Array<Record<string, unknown>>;

  res.json({
    customers: customers.map((c) => ({
      id: c.id,
      shopId: c.shop_id,
      name: c.name,
      phone: c.phone,
      address: c.address,
      openingBalance: Number(c.opening_balance),
      currentBalance: Number(c.current_balance),
      creditLimit: c.credit_limit !== null ? Number(c.credit_limit) : null,
      notes: c.notes,
      createdAt: c.created_at,
    })),
  });
});

app.post('/api/shops/:shopId/customers', requireAuth, requireShopAccess('khata'), (req: AuthedRequest, res) => {
  const { name, phone, address, openingBalance, creditLimit, notes } = req.body ?? {};
  if (!name || !String(name).trim()) {
    res.status(400).json({ error: 'Customer name is required' });
    return;
  }
  const shopId = req.params.shopId;
  const customerId = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  const opening = Number.isFinite(Number(openingBalance)) ? roundCurrency(Math.max(0, Number(openingBalance))) : 0;

  withTransaction(() => {
    db.prepare(`
      INSERT INTO customers (id, shop_id, name, phone, address, opening_balance, current_balance, credit_limit, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      customerId,
      shopId,
      String(name).trim(),
      phone ? String(phone).trim() : null,
      address ? String(address).trim() : null,
      opening,
      opening,
      creditLimit !== null && creditLimit !== undefined && creditLimit !== '' ? Number(creditLimit) : null,
      notes ? String(notes).trim() : null,
      nowIso
    );

    if (opening > 0) {
      db.prepare(`
        INSERT INTO credit_entries (id, shop_id, customer_id, entry_type, amount, balance_after, payment_mode, invoice_id, note, created_by, created_at)
        VALUES (?, ?, ?, 'opening', ?, ?, NULL, NULL, 'Opening Khata balance', ?, ?)
      `).run(crypto.randomUUID(), shopId, customerId, opening, opening, req.userId!, nowIso);
    }

    logAudit({
      id: crypto.randomUUID(),
      shopId,
      userId: req.userId!,
      action: 'customer.created',
      entityType: 'customer',
      entityId: customerId,
      details: { name, opening },
    });
  });

  res.status(201).json({ id: customerId });
});

app.get('/api/shops/:shopId/customers/:customerId/ledger', requireAuth, requireShopAccess('khata'), (req, res) => {
  const rows = db
    .prepare(`
      SELECT ce.*, c.name as customer_name
      FROM credit_entries ce
      JOIN customers c ON c.id = ce.customer_id
      WHERE ce.shop_id = ? AND ce.customer_id = ?
      ORDER BY ce.created_at DESC
    `)
    .all(req.params.shopId, req.params.customerId) as Array<Record<string, unknown>>;

  res.json({
    entries: rows.map((r) => ({
      id: r.id,
      shopId: r.shop_id,
      customerId: r.customer_id,
      customerName: r.customer_name,
      entryType: r.entry_type,
      amount: Number(r.amount),
      balanceAfter: Number(r.balance_after),
      paymentMode: r.payment_mode,
      invoiceId: r.invoice_id,
      note: r.note,
      createdBy: r.created_by,
      createdAt: r.created_at,
    })),
  });
});

app.post('/api/shops/:shopId/customers/:customerId/repay', requireAuth, requireShopAccess('khata'), (req: AuthedRequest, res) => {
  const { amount, paymentMode, note } = req.body ?? {};
  const amt = roundCurrency(Number(amount));
  if (!Number.isFinite(amt) || amt <= 0) {
    res.status(400).json({ error: 'Repayment amount must be positive' });
    return;
  }
  const shopId = req.params.shopId;
  const customerId = req.params.customerId;
  const nowIso = new Date().toISOString();

  const updatedBalance = withTransaction(() => {
    const cust = db
      .prepare(`SELECT * FROM customers WHERE id = ? AND shop_id = ?`)
      .get(customerId, shopId) as Record<string, unknown> | undefined;
    if (!cust) {
      throw Object.assign(new Error('Customer not found'), { status: 404 });
    }
    const current = Number(cust.current_balance);
    if (amt > current + 0.01) {
      throw Object.assign(new Error(`Repayment ₹${amt} exceeds outstanding balance ₹${current.toFixed(2)}`), {
        status: 400,
      });
    }
    const nextBalance = roundCurrency(Math.max(0, current - amt));
    db.prepare(`UPDATE customers SET current_balance = ? WHERE id = ?`).run(nextBalance, customerId);
    db.prepare(`
      INSERT INTO credit_entries (id, shop_id, customer_id, entry_type, amount, balance_after, payment_mode, invoice_id, note, created_by, created_at)
      VALUES (?, ?, ?, 'repayment', ?, ?, ?, NULL, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      shopId,
      customerId,
      amt,
      nextBalance,
      paymentMode || 'cash',
      note ? String(note).trim() : 'Khata repayment received',
      req.userId!,
      nowIso
    );
    db.prepare(`
      INSERT INTO payments (id, shop_id, invoice_id, customer_id, payment_mode, amount, reference_no, received_by, created_at)
      VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      shopId,
      customerId,
      paymentMode || 'cash',
      amt,
      note ? String(note).trim() : null,
      req.userId!,
      nowIso
    );
    logAudit({
      id: crypto.randomUUID(),
      shopId,
      userId: req.userId!,
      action: 'khata.repayment',
      entityType: 'customer',
      entityId: customerId,
      details: { amount: amt, paymentMode, nextBalance },
    });
    return nextBalance;
  });

  res.json({ ok: true, currentBalance: updatedBalance });
});

// --- Billing & Invoices (Atomic) ---
function loadInvoicesForShop(shopId: string, limit = 100) {
  const invoices = db
    .prepare(`SELECT * FROM invoices WHERE shop_id = ? ORDER BY created_at DESC LIMIT ?`)
    .all(shopId, limit) as Array<Record<string, unknown>>;

  const itemsStmt = db.prepare(`SELECT * FROM invoice_items WHERE invoice_id = ?`);

  return invoices.map((inv) => {
    const itemRows = itemsStmt.all(inv.id as string) as Array<Record<string, unknown>>;
    return {
      id: inv.id as string,
      shopId: inv.shop_id as string,
      clientTxId: inv.client_tx_id as string,
      invoiceNumber: inv.invoice_number as string,
      customerId: (inv.customer_id as string | null) ?? null,
      customerNameSnapshot: (inv.customer_name_snapshot as string | null) ?? null,
      subtotal: Number(inv.subtotal),
      discountAmount: Number(inv.discount_amount),
      discountAuthorizedBy: (inv.discount_authorized_by as string | null) ?? null,
      taxAmount: Number(inv.tax_amount),
      totalAmount: Number(inv.total_amount),
      paidAmount: Number(inv.paid_amount),
      creditAmount: Number(inv.credit_amount),
      paymentMode: inv.payment_mode as PaymentMode,
      status: inv.status as string,
      createdBy: inv.created_by as string,
      createdAt: inv.created_at as string,
      items: itemRows.map((it) => ({
        id: it.id as string,
        invoiceId: it.invoice_id as string,
        productId: it.product_id as string,
        productNameSnapshot: it.product_name_snapshot as string,
        brandSnapshot: (it.brand_snapshot as string | null) ?? null,
        quantity: Number(it.quantity),
        unitName: it.unit_name as string,
        baseQuantityDeducted: Number(it.base_quantity_deducted),
        unitSellingPrice: Number(it.unit_selling_price),
        costPriceSnapshot: it.cost_price_snapshot !== null ? Number(it.cost_price_snapshot) : null,
        discountAmount: Number(it.discount_amount),
        taxRatePct: Number(it.tax_rate_pct),
        taxAmount: Number(it.tax_amount),
        lineTotal: Number(it.line_total),
      })),
    };
  });
}

app.get('/api/shops/:shopId/invoices', requireAuth, requireShopAccess('billing'), (req, res) => {
  res.json({ invoices: loadInvoicesForShop(req.params.shopId, 150) });
});

app.post('/api/shops/:shopId/invoices', requireAuth, requireShopAccess('billing'), (req: AuthedRequest, res) => {
  const shopId = req.params.shopId;
  const b = req.body ?? {};
  const clientTxId = String(b.clientTxId || crypto.randomUUID());

  // Idempotency check: prevent duplicate invoices or duplicate stock deductions
  const existingInv = db
    .prepare(`SELECT id FROM invoices WHERE shop_id = ? AND client_tx_id = ?`)
    .get(shopId, clientTxId) as { id: string } | undefined;
  if (existingInv) {
    const full = loadInvoicesForShop(shopId, 150).find((i) => i.id === existingInv.id);
    res.json({ invoice: full, deduplicated: true });
    return;
  }

  const lines = Array.isArray(b.items) ? b.items : [];
  if (lines.length === 0) {
    res.status(400).json({ error: 'Add at least one product to create a bill' });
    return;
  }

  const shopRow = db.prepare(`SELECT tax_mode FROM shops WHERE id = ?`).get(shopId) as {
    tax_mode: 'gst_inclusive' | 'gst_exclusive' | 'non_gst';
  };
  const products = loadProductsForShop(shopId);
  const nowIso = new Date().toISOString();

  try {
    const invoiceId = withTransaction(() => {
      const resolvedLines: Array<{
        productId: string;
        productNameSnapshot: string;
        brandSnapshot: string | null;
        quantity: number;
        unitName: string;
        baseQuantityDeducted: number;
        unitSellingPrice: number;
        costPriceSnapshot: number | null;
        discountAmount: number;
        taxRatePct: number;
        taxAmount: number;
        lineTotal: number;
      }> = [];

      for (const rawLine of lines) {
        const prod = products.find((p) => p.id === rawLine.productId);
        if (!prod) {
          throw Object.assign(new Error('Selected product no longer exists'), { status: 400 });
        }
        const qty = Number(rawLine.quantity);
        if (!Number.isFinite(qty) || qty <= 0) {
          throw Object.assign(new Error(`Invalid quantity for ${prod.name}`), { status: 400 });
        }
        const unitName = String(rawLine.unitName || prod.baseUnit);
        const baseDeducted = convertToBaseQuantity(qty, unitName, prod.baseUnit, prod.units);

        // Lock-safe stock check inside BEGIN IMMEDIATE transaction
        const freshProd = db
          .prepare(`SELECT current_stock, landed_cost, purchase_price FROM products WHERE id = ? AND shop_id = ?`)
          .get(prod.id, shopId) as { current_stock: number; landed_cost: number | null; purchase_price: number | null };

        if (freshProd.current_stock + 0.0001 < baseDeducted) {
          throw Object.assign(
            new Error(
              `Insufficient stock for ${prod.name}: requested ${baseDeducted} ${prod.baseUnit}, available ${freshProd.current_stock} ${prod.baseUnit}`
            ),
            { status: 400 }
          );
        }

        const factor = convertToBaseQuantity(1, unitName, prod.baseUnit, prod.units);
        const unitPrice =
          rawLine.unitSellingPrice !== undefined
            ? Number(rawLine.unitSellingPrice)
            : roundCurrency(prod.sellingPrice * factor);

        const lineDiscount = Number.isFinite(Number(rawLine.discountAmount))
          ? Math.max(0, Number(rawLine.discountAmount))
          : 0;

        const netBeforeTax = Math.max(0, qty * unitPrice - lineDiscount);
        const taxRate = shopRow.tax_mode === 'non_gst' ? 0 : prod.taxRatePct;
        let lineTax = 0;
        let lineTotal = netBeforeTax;

        if (shopRow.tax_mode === 'gst_exclusive' && taxRate > 0) {
          lineTax = roundCurrency(netBeforeTax * (taxRate / 100));
          lineTotal = roundCurrency(netBeforeTax + lineTax);
        } else if (shopRow.tax_mode === 'gst_inclusive' && taxRate > 0) {
          const baseExcl = netBeforeTax / (1 + taxRate / 100);
          lineTax = roundCurrency(netBeforeTax - baseExcl);
          lineTotal = roundCurrency(netBeforeTax);
        }

        const costSnap =
          freshProd.landed_cost !== null
            ? Number(freshProd.landed_cost)
            : freshProd.purchase_price !== null
              ? Number(freshProd.purchase_price)
              : null;

        resolvedLines.push({
          productId: prod.id,
          productNameSnapshot: prod.name,
          brandSnapshot: prod.brand,
          quantity: qty,
          unitName,
          baseQuantityDeducted: baseDeducted,
          unitSellingPrice: unitPrice,
          costPriceSnapshot: costSnap,
          discountAmount: lineDiscount,
          taxRatePct: taxRate,
          taxAmount: lineTax,
          lineTotal,
        });
      }

      const invoiceDiscount = Number.isFinite(Number(b.discountAmount))
        ? Math.max(0, roundCurrency(Number(b.discountAmount)))
        : 0;

      if (invoiceDiscount > 0 && req.memberRole !== 'owner' && !b.discountAuthorizedBy) {
        throw Object.assign(new Error('Owner or supervisor authorization required for bill-level discount'), {
          status: 403,
        });
      }

      const totals = calculateInvoiceTotals(
        resolvedLines.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          unitSellingPrice: l.unitSellingPrice,
          discountAmount: l.discountAmount,
          taxRatePct: l.taxRatePct,
          costPricePerBaseUnit: l.costPriceSnapshot,
          baseQuantityDeducted: l.baseQuantityDeducted,
        })),
        invoiceDiscount,
        shopRow.tax_mode
      );

      const paymentMode = (b.paymentMode || 'cash') as PaymentMode;
      const splitCheck = validatePaymentSplit({
        totalAmount: totals.totalAmount,
        paymentMode,
        cashPaid: Number(b.cashPaid || 0),
        upiPaid: Number(b.upiPaid || 0),
        creditAmount: Number(b.creditAmount || 0),
        hasCustomer: Boolean(b.customerId),
      });

      if (!splitCheck.valid) {
        throw Object.assign(new Error(splitCheck.error || 'Invalid payment breakdown'), { status: 400 });
      }

      let customerSnapshot: string | null = b.customerNameSnapshot ? String(b.customerNameSnapshot).trim() : null;
      if (b.customerId) {
        const cust = db
          .prepare(`SELECT id, name, current_balance, credit_limit FROM customers WHERE id = ? AND shop_id = ?`)
          .get(b.customerId, shopId) as
          | { id: string; name: string; current_balance: number; credit_limit: number | null }
          | undefined;
        if (!cust) {
          throw Object.assign(new Error('Selected Khata customer not found'), { status: 404 });
        }
        customerSnapshot = cust.name;
        if (
          splitCheck.creditAmount > 0 &&
          cust.credit_limit !== null &&
          cust.current_balance + splitCheck.creditAmount > cust.credit_limit
        ) {
          throw Object.assign(
            new Error(`Credit exceeds customer's credit limit of ₹${cust.credit_limit.toFixed(2)}`),
            { status: 400 }
          );
        }
      }

      const countRow = db
        .prepare(`SELECT COUNT(*) as cnt FROM invoices WHERE shop_id = ?`)
        .get(shopId) as { cnt: number };
      const dateTag = nowIso.slice(0, 10).replace(/-/g, '');
      const invoiceNumber = `BHV-${dateTag}-${String(countRow.cnt + 1).padStart(4, '0')}`;
      const newInvId = crypto.randomUUID();

      db.prepare(`
        INSERT INTO invoices (
          id, shop_id, client_tx_id, invoice_number, customer_id, customer_name_snapshot,
          subtotal, discount_amount, discount_authorized_by, tax_amount, total_amount,
          paid_amount, credit_amount, payment_mode, status, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?)
      `).run(
        newInvId,
        shopId,
        clientTxId,
        invoiceNumber,
        b.customerId || null,
        customerSnapshot,
        totals.subtotal,
        roundCurrency(totals.lineDiscountTotal + totals.invoiceDiscount),
        b.discountAuthorizedBy || (invoiceDiscount > 0 ? req.userId! : null),
        totals.taxAmount,
        totals.totalAmount,
        splitCheck.paidAmount,
        splitCheck.creditAmount,
        paymentMode,
        req.userId!,
        nowIso
      );

      const insertItemStmt = db.prepare(`
        INSERT INTO invoice_items (
          id, shop_id, invoice_id, product_id, product_name_snapshot, brand_snapshot,
          quantity, unit_name, base_quantity_deducted, unit_selling_price, cost_price_snapshot,
          discount_amount, tax_rate_pct, tax_amount, line_total
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const deductStockStmt = db.prepare(
        `UPDATE products SET current_stock = ROUND(current_stock - ?, 4), updated_at = ? WHERE id = ? AND shop_id = ?`
      );
      const insertMoveStmt = db.prepare(`
        INSERT INTO stock_movements (id, shop_id, product_id, movement_type, quantity_delta, unit_name, unit_quantity, reference_type, reference_id, note, created_by, created_at)
        VALUES (?, ?, ?, 'sale', ?, ?, ?, 'invoice', ?, ?, ?, ?)
      `);

      for (const l of resolvedLines) {
        insertItemStmt.run(
          crypto.randomUUID(),
          shopId,
          newInvId,
          l.productId,
          l.productNameSnapshot,
          l.brandSnapshot,
          l.quantity,
          l.unitName,
          l.baseQuantityDeducted,
          l.unitSellingPrice,
          l.costPriceSnapshot,
          l.discountAmount,
          l.taxRatePct,
          l.taxAmount,
          l.lineTotal
        );
        deductStockStmt.run(l.baseQuantityDeducted, nowIso, l.productId, shopId);
        insertMoveStmt.run(
          crypto.randomUUID(),
          shopId,
          l.productId,
          -l.baseQuantityDeducted,
          l.unitName,
          l.quantity,
          newInvId,
          `Bill ${invoiceNumber}`,
          req.userId!,
          nowIso
        );
      }

      // Payments & Khata ledger
      if (paymentMode === 'cash' || paymentMode === 'upi') {
        db.prepare(`
          INSERT INTO payments (id, shop_id, invoice_id, customer_id, payment_mode, amount, reference_no, received_by, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(crypto.randomUUID(), shopId, newInvId, b.customerId || null, paymentMode, splitCheck.paidAmount, invoiceNumber, req.userId!, nowIso);
      } else if (paymentMode === 'split') {
        if (Number(b.cashPaid) > 0) {
          db.prepare(`
            INSERT INTO payments (id, shop_id, invoice_id, customer_id, payment_mode, amount, reference_no, received_by, created_at)
            VALUES (?, ?, ?, ?, 'cash', ?, ?, ?, ?)
          `).run(crypto.randomUUID(), shopId, newInvId, b.customerId || null, roundCurrency(Number(b.cashPaid)), invoiceNumber, req.userId!, nowIso);
        }
        if (Number(b.upiPaid) > 0) {
          db.prepare(`
            INSERT INTO payments (id, shop_id, invoice_id, customer_id, payment_mode, amount, reference_no, received_by, created_at)
            VALUES (?, ?, ?, ?, 'upi', ?, ?, ?, ?)
          `).run(crypto.randomUUID(), shopId, newInvId, b.customerId || null, roundCurrency(Number(b.upiPaid)), invoiceNumber, req.userId!, nowIso);
        }
      }

      if (splitCheck.creditAmount > 0 && b.customerId) {
        const cust = db
          .prepare(`SELECT current_balance FROM customers WHERE id = ?`)
          .get(b.customerId) as { current_balance: number };
        const nextBal = roundCurrency(Number(cust.current_balance) + splitCheck.creditAmount);
        db.prepare(`UPDATE customers SET current_balance = ? WHERE id = ?`).run(nextBal, b.customerId);
        db.prepare(`
          INSERT INTO credit_entries (id, shop_id, customer_id, entry_type, amount, balance_after, payment_mode, invoice_id, note, created_by, created_at)
          VALUES (?, ?, ?, 'credit_sale', ?, ?, ?, ?, ?, ?, ?)
        `).run(
          crypto.randomUUID(),
          shopId,
          b.customerId,
          splitCheck.creditAmount,
          nextBal,
          paymentMode,
          newInvId,
          `Credit bill ${invoiceNumber}`,
          req.userId!,
          nowIso
        );
      }

      logAudit({
        id: crypto.randomUUID(),
        shopId,
        userId: req.userId!,
        action: 'invoice.created',
        entityType: 'invoice',
        entityId: newInvId,
        details: { invoiceNumber, totalAmount: totals.totalAmount, paymentMode },
      });

      return newInvId;
    });

    const created = loadInvoicesForShop(shopId, 50).find((i) => i.id === invoiceId);
    res.status(201).json({ invoice: created });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const message = err instanceof Error ? err.message : 'Failed to create invoice';
    res.status(status).json({ error: message });
  }
});

// --- Purchases (Atomic Stock Add & Landed Cost Allocation) ---
app.get('/api/shops/:shopId/purchases', requireAuth, requireShopAccess('purchases'), (req, res) => {
  const purchases = db
    .prepare(`
      SELECT p.*, s.name as supplier_name
      FROM purchases p
      JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.shop_id = ?
      ORDER BY p.purchase_date DESC, p.created_at DESC
      LIMIT 100
    `)
    .all(req.params.shopId) as Array<Record<string, unknown>>;

  const itemsStmt = db.prepare(`
    SELECT pi.*, pr.name as product_name
    FROM purchase_items pi
    JOIN products pr ON pr.id = pi.product_id
    WHERE pi.purchase_id = ?
  `);

  res.json({
    purchases: purchases.map((p) => ({
      id: p.id,
      shopId: p.shop_id,
      clientTxId: p.client_tx_id,
      supplierId: p.supplier_id,
      supplierName: p.supplier_name,
      supplierInvoiceNo: p.supplier_invoice_no,
      purchaseDate: p.purchase_date,
      subtotal: Number(p.subtotal),
      discountAmount: Number(p.discount_amount),
      taxAmount: Number(p.tax_amount),
      freightCost: Number(p.freight_cost),
      transportCost: Number(p.transport_cost),
      additionalCosts: Number(p.additional_costs),
      totalAmount: Number(p.total_amount),
      paidAmount: Number(p.paid_amount),
      paymentStatus: p.payment_status,
      notes: p.notes,
      createdBy: p.created_by,
      createdAt: p.created_at,
      items: (itemsStmt.all(p.id as string) as Array<Record<string, unknown>>).map((it) => ({
        id: it.id,
        purchaseId: it.purchase_id,
        productId: it.product_id,
        productName: it.product_name,
        brand: it.brand,
        packSize: it.pack_size,
        quantity: Number(it.quantity),
        unitName: it.unit_name,
        baseQuantityAdded: Number(it.base_quantity_added),
        purchaseRate: Number(it.purchase_rate),
        discountAmount: Number(it.discount_amount),
        taxAmount: Number(it.tax_amount),
        allocatedExtraCost: Number(it.allocated_extra_cost),
        landedCostPerBaseUnit: Number(it.landed_cost_per_base_unit),
        lineTotal: Number(it.line_total),
      })),
    })),
  });
});

app.post('/api/shops/:shopId/purchases', requireAuth, requireShopAccess('purchases'), (req: AuthedRequest, res) => {
  const shopId = req.params.shopId;
  const b = req.body ?? {};
  const clientTxId = String(b.clientTxId || crypto.randomUUID());

  const existing = db
    .prepare(`SELECT id FROM purchases WHERE shop_id = ? AND client_tx_id = ?`)
    .get(shopId, clientTxId);
  if (existing) {
    res.json({ ok: true, deduplicated: true });
    return;
  }

  const lines = Array.isArray(b.items) ? b.items : [];
  if (!b.supplierId || lines.length === 0) {
    res.status(400).json({ error: 'Supplier and at least one purchase item are required' });
    return;
  }

  const products = loadProductsForShop(shopId);
  const freightCost = Math.max(0, roundCurrency(Number(b.freightCost || 0)));
  const transportCost = Math.max(0, roundCurrency(Number(b.transportCost || 0)));
  const additionalCosts = Math.max(0, roundCurrency(Number(b.additionalCosts || 0)));
  const purchaseDate = b.purchaseDate || new Date().toISOString().slice(0, 10);
  const nowIso = new Date().toISOString();

  try {
    const purchaseId = withTransaction(() => {
      const prepared: Array<{
        productId: string;
        brand: string | null;
        packSize: string | null;
        quantity: number;
        unitName: string;
        baseQuantityAdded: number;
        purchaseRate: number;
        discountAmount: number;
        taxAmount: number;
      }> = [];

      for (const raw of lines) {
        const prod = products.find((p) => p.id === raw.productId);
        if (!prod) throw Object.assign(new Error('Product not found in purchase'), { status: 404 });
        const qty = Number(raw.quantity);
        const rate = Number(raw.purchaseRate);
        if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(rate) || rate < 0) {
          throw Object.assign(new Error(`Invalid quantity or rate for ${prod.name}`), { status: 400 });
        }
        const unitName = String(raw.unitName || prod.baseUnit);
        const baseAdded = convertToBaseQuantity(qty, unitName, prod.baseUnit, prod.units);

        prepared.push({
          productId: prod.id,
          brand: raw.brand ? String(raw.brand) : prod.brand,
          packSize: raw.packSize ? String(raw.packSize) : null,
          quantity: qty,
          unitName,
          baseQuantityAdded: baseAdded,
          purchaseRate: rate,
          discountAmount: Math.max(0, roundCurrency(Number(raw.discountAmount || 0))),
          taxAmount: Math.max(0, roundCurrency(Number(raw.taxAmount || 0))),
        });
      }

      const allocations = allocatePurchaseLandedCosts(
        prepared.map((l) => ({
          productId: l.productId,
          baseQuantityAdded: l.baseQuantityAdded,
          purchaseRatePerPurchaseUnit: l.purchaseRate,
          quantityInPurchaseUnit: l.quantity,
          discountAmount: l.discountAmount,
          taxAmount: l.taxAmount,
        })),
        freightCost,
        transportCost,
        additionalCosts
      );

      const subtotal = roundCurrency(prepared.reduce((s, l) => s + l.quantity * l.purchaseRate, 0));
      const discountTotal = roundCurrency(prepared.reduce((s, l) => s + l.discountAmount, 0));
      const taxTotal = roundCurrency(prepared.reduce((s, l) => s + l.taxAmount, 0));
      const totalAmount = roundCurrency(
        subtotal - discountTotal + taxTotal + freightCost + transportCost + additionalCosts
      );
      const paidAmount = Math.min(totalAmount, Math.max(0, roundCurrency(Number(b.paidAmount ?? totalAmount))));
      const paymentStatus =
        paidAmount >= totalAmount - 0.01 ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid';

      const newPurchaseId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO purchases (
          id, shop_id, client_tx_id, supplier_id, supplier_invoice_no, purchase_date,
          subtotal, discount_amount, tax_amount, freight_cost, transport_cost, additional_costs,
          total_amount, paid_amount, payment_status, notes, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        newPurchaseId,
        shopId,
        clientTxId,
        b.supplierId,
        b.supplierInvoiceNo ? String(b.supplierInvoiceNo).trim() : null,
        purchaseDate,
        subtotal,
        discountTotal,
        taxTotal,
        freightCost,
        transportCost,
        additionalCosts,
        totalAmount,
        paidAmount,
        paymentStatus,
        b.notes ? String(b.notes).trim() : null,
        req.userId!,
        nowIso
      );

      const insertItemStmt = db.prepare(`
        INSERT INTO purchase_items (
          id, shop_id, purchase_id, product_id, brand, pack_size, quantity, unit_name,
          base_quantity_added, purchase_rate, discount_amount, tax_amount,
          allocated_extra_cost, landed_cost_per_base_unit, line_total
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const updateProdStmt = db.prepare(`
        UPDATE products
        SET current_stock = ROUND(current_stock + ?, 4),
            purchase_price = ?,
            landed_cost = ?,
            updated_at = ?
        WHERE id = ? AND shop_id = ?
      `);
      const insertMoveStmt = db.prepare(`
        INSERT INTO stock_movements (id, shop_id, product_id, movement_type, quantity_delta, unit_name, unit_quantity, reference_type, reference_id, note, created_by, created_at)
        VALUES (?, ?, ?, 'purchase', ?, ?, ?, 'purchase', ?, ?, ?, ?)
      `);

      prepared.forEach((l, idx) => {
        const alloc = allocations[idx];
        const basePurchasePrice =
          l.baseQuantityAdded > 0
            ? roundCurrency((l.quantity * l.purchaseRate - l.discountAmount) / l.baseQuantityAdded)
            : 0;

        insertItemStmt.run(
          crypto.randomUUID(),
          shopId,
          newPurchaseId,
          l.productId,
          l.brand,
          l.packSize,
          l.quantity,
          l.unitName,
          l.baseQuantityAdded,
          l.purchaseRate,
          l.discountAmount,
          l.taxAmount,
          alloc.allocatedExtraCost,
          alloc.landedCostPerBaseUnit,
          alloc.totalLineCost
        );
        updateProdStmt.run(
          l.baseQuantityAdded,
          basePurchasePrice,
          alloc.landedCostPerBaseUnit,
          nowIso,
          l.productId,
          shopId
        );
        insertMoveStmt.run(
          crypto.randomUUID(),
          shopId,
          l.productId,
          l.baseQuantityAdded,
          l.unitName,
          l.quantity,
          newPurchaseId,
          `Purchase ${b.supplierInvoiceNo || purchaseDate}`,
          req.userId!,
          nowIso
        );
      });

      logAudit({
        id: crypto.randomUUID(),
        shopId,
        userId: req.userId!,
        action: 'purchase.created',
        entityType: 'purchase',
        entityId: newPurchaseId,
        details: { supplierId: b.supplierId, totalAmount, freightCost, transportCost },
      });

      return newPurchaseId;
    });

    res.status(201).json({ id: purchaseId });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Purchase failed' });
  }
});

// --- Expenses ---
app.get('/api/shops/:shopId/expenses', requireAuth, requireShopAccess('expenses'), (req, res) => {
  const rows = db
    .prepare(`SELECT * FROM expenses WHERE shop_id = ? ORDER BY expense_date DESC, created_at DESC LIMIT 150`)
    .all(req.params.shopId) as Array<Record<string, unknown>>;

  res.json({
    expenses: rows.map((e) => ({
      id: e.id,
      shopId: e.shop_id,
      category: e.category,
      description: e.description,
      amount: Number(e.amount),
      paymentMode: e.payment_mode,
      expenseDate: e.expense_date,
      receiptRef: e.receipt_ref,
      createdBy: e.created_by,
      createdAt: e.created_at,
    })),
  });
});

app.post('/api/shops/:shopId/expenses', requireAuth, requireShopAccess('expenses'), (req: AuthedRequest, res) => {
  const { category, description, amount, paymentMode, expenseDate, receiptRef } = req.body ?? {};
  const amt = roundCurrency(Number(amount));
  if (!category || !description || !Number.isFinite(amt) || amt <= 0) {
    res.status(400).json({ error: 'Category, description, and positive amount are required' });
    return;
  }
  const id = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  db.prepare(`
    INSERT INTO expenses (id, shop_id, category, description, amount, payment_mode, expense_date, receipt_ref, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    req.params.shopId,
    String(category),
    String(description).trim(),
    amt,
    paymentMode || 'cash',
    expenseDate || nowIso.slice(0, 10),
    receiptRef ? String(receiptRef).trim() : null,
    req.userId!,
    nowIso
  );

  logAudit({
    id: crypto.randomUUID(),
    shopId: req.params.shopId,
    userId: req.userId!,
    action: 'expense.created',
    entityType: 'expense',
    entityId: id,
    details: { category, amount: amt },
  });

  res.status(201).json({ id });
});

// --- Market Intelligence ---
function loadHistoricalPurchasesMap(shopId: string, productIdFilter?: string) {
  const query = productIdFilter
    ? `
      SELECT pi.*, p.purchase_date, p.supplier_id, p.supplier_invoice_no, p.created_at as purchase_created_at, s.name as supplier_name
      FROM purchase_items pi
      JOIN purchases p ON p.id = pi.purchase_id
      JOIN suppliers s ON s.id = p.supplier_id
      WHERE pi.shop_id = ? AND pi.product_id = ?
      ORDER BY p.purchase_date DESC, p.created_at DESC
    `
    : `
      SELECT pi.*, p.purchase_date, p.supplier_id, p.supplier_invoice_no, p.created_at as purchase_created_at, s.name as supplier_name
      FROM purchase_items pi
      JOIN purchases p ON p.id = pi.purchase_id
      JOIN suppliers s ON s.id = p.supplier_id
      WHERE pi.shop_id = ?
      ORDER BY p.purchase_date DESC, p.created_at DESC
    `;

  const rows = (
    productIdFilter ? db.prepare(query).all(shopId, productIdFilter) : db.prepare(query).all(shopId)
  ) as Array<Record<string, unknown>>;

  const map = new Map<string, HistoricalPurchaseRatePoint[]>();
  for (const r of rows) {
    const pid = r.product_id as string;
    const list = map.get(pid) || [];
    list.push({
      purchaseId: r.purchase_id as string,
      purchaseDate: r.purchase_date as string,
      supplierId: r.supplier_id as string,
      supplierName: r.supplier_name as string,
      brand: (r.brand as string | null) ?? null,
      packSize: (r.pack_size as string | null) ?? null,
      quantity: Number(r.quantity),
      unitName: r.unit_name as string,
      purchaseRate: Number(r.purchase_rate),
      landedCostPerBaseUnit: Number(r.landed_cost_per_base_unit),
      invoiceNo: (r.supplier_invoice_no as string | null) ?? null,
      createdAt: r.purchase_created_at as string,
    });
    map.set(pid, list);
  }
  return map;
}

function mapQuotationRow(q: Record<string, unknown>, todayDate: string): SupplierQuotation {
  const validUntil = (q.valid_until as string | null) ?? null;
  const finalLanded =
    q.final_landed_cost !== null && q.final_landed_cost !== undefined
      ? Number(q.final_landed_cost)
      : Number(q.landed_estimate);
  return {
    id: q.id as string,
    shopId: q.shop_id as string,
    productId: q.product_id as string,
    productName: (q.product_name as string | undefined) ?? undefined,
    supplierId: q.supplier_id as string,
    supplierName: (q.supplier_name as string | undefined) ?? undefined,
    brand: (q.brand as string | null) ?? null,
    packSize: (q.pack_size as string | null) ?? null,
    quantity: q.quantity !== null && q.quantity !== undefined ? Number(q.quantity) : 1,
    unit: q.unit as string,
    quotedRate: Number(q.quoted_rate),
    discountAmount: Number(q.discount_amount || 0),
    taxAmount: Number(q.tax_amount || 0),
    freightEstimatePerUnit: Number(q.freight_estimate_per_unit || 0),
    additionalCosts: Number(q.additional_costs || 0),
    finalLandedCost: finalLanded,
    landedEstimate: Number(q.landed_estimate),
    validUntil,
    isExpired: isQuotationExpired(validUntil, todayDate),
    quotationDate: q.quotation_date as string,
    sourceEvidence: (q.source_evidence as string | null) ?? null,
    verificationStatus: q.verification_status as SupplierQuotation['verificationStatus'],
    notes: (q.notes as string | null) ?? null,
    createdBy: q.created_by as string,
    createdAt: q.created_at as string,
  };
}

function mapMarketPriceRow(m: Record<string, unknown>): MarketPrice {
  return {
    id: m.id as string,
    shopId: m.shop_id as string,
    sourceId: m.source_id as string,
    sourceName: (m.source_name as string | undefined) ?? undefined,
    productId: (m.product_id as string | null) ?? null,
    commodityOrProductName: m.commodity_or_product_name as string,
    brand: (m.brand as string | null) ?? null,
    packSize: (m.pack_size as string | null) ?? null,
    unit: m.unit as string,
    marketName: m.market_name as string,
    state: (m.state as string | null) ?? null,
    district: (m.district as string | null) ?? null,
    location: m.location as string,
    minPrice: m.min_price !== null ? Number(m.min_price) : null,
    maxPrice: m.max_price !== null ? Number(m.max_price) : null,
    modalPrice: Number(m.modal_price),
    previousPrice: m.previous_price !== null ? Number(m.previous_price) : null,
    priceUnitBasis: m.price_unit_basis as string,
    normalizedPerBaseUnit:
      m.normalized_per_base_unit !== null ? Number(m.normalized_per_base_unit) : null,
    observationDate: m.observation_date as string,
    freshnessStatus: m.freshness_status as MarketPrice['freshnessStatus'],
    verificationStatus: m.verification_status as MarketPrice['verificationStatus'],
    confidenceLevel: m.confidence_level as MarketPrice['confidenceLevel'],
    createdAt: m.created_at as string,
  };
}

app.get('/api/shops/:shopId/market/overview', requireAuth, requireShopAccess('market'), (req, res) => {
  const shopId = req.params.shopId;
  ensureDefaultPriceSourcesForShop(shopId);
  const todayDate = getTodayIsoDate();

  const shop = db.prepare(`SELECT default_margin_pct FROM shops WHERE id = ?`).get(shopId) as {
    default_margin_pct: number;
  };
  const sources = db
    .prepare(`SELECT * FROM price_sources WHERE shop_id = ? ORDER BY source_type ASC`)
    .all(shopId) as Array<Record<string, unknown>>;

  const syncRuns = db
    .prepare(`
      SELECT * FROM market_sync_runs
      WHERE shop_id = ?
      ORDER BY attempted_at DESC
      LIMIT 25
    `)
    .all(shopId) as Array<Record<string, unknown>>;

  const marketPricesRows = db
    .prepare(`
      SELECT mp.*, ps.name as source_name
      FROM market_prices mp
      JOIN price_sources ps ON ps.id = mp.source_id
      WHERE mp.shop_id = ?
      ORDER BY mp.observation_date DESC, mp.created_at DESC
      LIMIT 300
    `)
    .all(shopId) as Array<Record<string, unknown>>;

  const quotationsRows = db
    .prepare(`
      SELECT sq.*, p.name as product_name, s.name as supplier_name
      FROM supplier_quotations sq
      JOIN products p ON p.id = sq.product_id
      JOIN suppliers s ON s.id = sq.supplier_id
      WHERE sq.shop_id = ?
      ORDER BY sq.quotation_date DESC, sq.created_at DESC
      LIMIT 300
    `)
    .all(shopId) as Array<Record<string, unknown>>;

  const marketPrices = marketPricesRows.map(mapMarketPriceRow);
  const quotations = quotationsRows.map((q) => mapQuotationRow(q, todayDate));
  const products = loadProductsTypedForShop(shopId);
  const historicalPurchasesMap = loadHistoricalPurchasesMap(shopId);
  const productRates = buildProductWholesaleSummaries({
    products,
    quotations,
    marketPrices,
    historicalPurchasesByProduct: historicalPurchasesMap,
    todayDate,
  });

  const alertState = getMarketAlertsStateForShop(shopId, Number(shop.default_margin_pct || 15));

  res.json({
    sources: sources.map((s) => ({
      id: s.id,
      shopId: s.shop_id,
      sourceKey: s.source_key,
      name: s.name,
      sourceType: s.source_type,
      endpointUrl: s.endpoint_url,
      isConfigured: Boolean(s.is_configured),
      updateFrequency: s.update_frequency,
      lastSyncAt: s.last_sync_at,
      lastAttemptedAt: s.last_attempted_at ?? null,
      lastDataDate: s.last_data_date ?? null,
      lastRecordsFetched: Number(s.last_records_fetched || 0),
      lastRecordsMatched: Number(s.last_records_matched || 0),
      lastSyncStatus: s.last_sync_status,
      lastError: s.last_error,
      coverageNotes: s.coverage_notes,
    })),
    syncRuns: syncRuns.map((r) => ({
      id: r.id,
      shopId: r.shop_id,
      sourceKey: r.source_key,
      sourceName: r.source_name,
      triggerType: r.trigger_type,
      status: r.status,
      attemptedAt: r.attempted_at,
      completedAt: r.completed_at,
      dataDate: r.data_date,
      recordsFetched: Number(r.records_fetched || 0),
      recordsInserted: Number(r.records_inserted || 0),
      recordsMatched: Number(r.records_matched || 0),
      httpStatus: r.http_status !== null ? Number(r.http_status) : null,
      errorCode: r.error_code,
      errorDetails: r.error_details,
    })),
    marketPrices,
    quotations,
    alerts: alertState.activeAlerts,
    acknowledgedAlerts: alertState.acknowledgedAlerts,
    productRates,
  });
});

app.post(
  '/api/shops/:shopId/market/alerts/:alertId/acknowledge',
  requireAuth,
  requireShopAccess('market'),
  (req: AuthedRequest, res) => {
    const shopId = req.params.shopId;
    const alertId = decodeURIComponent(req.params.alertId || '').trim();
    if (!alertId) {
      res.status(400).json({ error: 'Alert ID is required' });
      return;
    }
    const nowIso = new Date().toISOString();
    db.prepare(`
      INSERT INTO acknowledged_market_alerts (id, shop_id, alert_id, acknowledged_by, acknowledged_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(shop_id, alert_id) DO UPDATE SET
        acknowledged_by = excluded.acknowledged_by,
        acknowledged_at = excluded.acknowledged_at
    `).run(crypto.randomUUID(), shopId, alertId, req.userId!, nowIso);

    logAudit({
      id: crypto.randomUUID(),
      shopId,
      userId: req.userId!,
      action: 'market.alert_acknowledged',
      entityType: 'price_alert',
      entityId: alertId,
      details: { acknowledgedAt: nowIso },
    });

    res.json({ ok: true, alertId, acknowledgedAt: nowIso });
  }
);

app.delete(
  '/api/shops/:shopId/market/alerts/:alertId/acknowledge',
  requireAuth,
  requireShopAccess('market'),
  (req: AuthedRequest, res) => {
    const shopId = req.params.shopId;
    const alertId = decodeURIComponent(req.params.alertId || '').trim();
    if (!alertId) {
      res.status(400).json({ error: 'Alert ID is required' });
      return;
    }
    db.prepare(`DELETE FROM acknowledged_market_alerts WHERE shop_id = ? AND alert_id = ?`).run(
      shopId,
      alertId
    );
    res.json({ ok: true, alertId });
  }
);

app.get(
  '/api/shops/:shopId/market/products/:productId',
  requireAuth,
  requireShopAccess('market'),
  (req, res) => {
    const { shopId, productId } = req.params;
    const todayDate = getTodayIsoDate();
    const products = loadProductsTypedForShop(shopId);
    const product = products.find((p) => p.id === productId);
    if (!product) {
      res.status(404).json({ error: 'Product not found in this shop' });
      return;
    }

    const quotationsRows = db
      .prepare(`
        SELECT sq.*, p.name as product_name, s.name as supplier_name
        FROM supplier_quotations sq
        JOIN products p ON p.id = sq.product_id
        JOIN suppliers s ON s.id = sq.supplier_id
        WHERE sq.shop_id = ? AND sq.product_id = ?
        ORDER BY sq.quotation_date DESC, sq.created_at DESC
      `)
      .all(shopId, productId) as Array<Record<string, unknown>>;

    const quotations = quotationsRows
      .map((q) => mapQuotationRow(q, todayDate))
      .filter((q) => isPackSizeCompatible(product.packSize, q.packSize));

    const marketRows = db
      .prepare(`
        SELECT mp.*, ps.name as source_name
        FROM market_prices mp
        JOIN price_sources ps ON ps.id = mp.source_id
        WHERE mp.shop_id = ?
          AND (mp.product_id = ? OR LOWER(mp.commodity_or_product_name) = LOWER(?))
        ORDER BY mp.observation_date DESC, mp.created_at DESC
      `)
      .all(shopId, productId, product.marketCommodityName || '') as Array<Record<string, unknown>>;

    const marketObservations = marketRows
      .map(mapMarketPriceRow)
      .filter((m) => isPackSizeCompatible(product.packSize, m.packSize));

    const historicalPurchasesMap = loadHistoricalPurchasesMap(shopId, productId);
    const purchaseHistory = historicalPurchasesMap.get(productId) || [];

    const summary = buildProductWholesaleSummaries({
      products: [product],
      quotations,
      marketPrices: marketObservations,
      historicalPurchasesByProduct: historicalPurchasesMap,
      todayDate,
    })[0];

    const recommendations = db
      .prepare(`
        SELECT pr.*, u.full_name as approved_by_name
        FROM price_recommendations pr
        LEFT JOIN profiles u ON u.id = pr.approved_by
        WHERE pr.shop_id = ? AND pr.product_id = ?
        ORDER BY pr.created_at DESC
        LIMIT 30
      `)
      .all(shopId, productId) as Array<Record<string, unknown>>;

    res.json({
      product,
      summary,
      purchaseHistory,
      quotations,
      marketObservations,
      priceRecommendations: recommendations.map((r) => ({
        id: r.id,
        historicalLandedCost: r.historical_landed_cost !== null ? Number(r.historical_landed_cost) : null,
        replacementLandedCost: r.replacement_landed_cost !== null ? Number(r.replacement_landed_cost) : null,
        currentSellingPrice: Number(r.current_selling_price),
        recommendedPrice: Number(r.recommended_price),
        targetMarginPct: Number(r.target_margin_pct),
        strategy: r.strategy,
        alertReason: r.alert_reason,
        status: r.status,
        approvedByName: r.approved_by_name,
        approvedAt: r.approved_at,
        createdAt: r.created_at,
      })),
    });
  }
);

app.post('/api/shops/:shopId/market/sync-agmarknet', requireAuth, requireShopAccess('market'), async (req: AuthedRequest, res) => {
  const { commodity, state, limit } = req.body ?? {};
  const result = await syncAgmarknetForShop({
    shopId: req.params.shopId,
    commodity,
    state,
    limit: Number(limit) || 100,
    triggerType: 'manual',
  });
  logAudit({
    id: crypto.randomUUID(),
    shopId: req.params.shopId,
    userId: req.userId!,
    action: 'market.sync_agmarknet',
    entityType: 'price_source',
    entityId: 'agmarknet_ogd',
    details: result,
  });
  res.status(result.configured ? (result.ok ? 200 : 502) : 200).json({
    ...result,
    ...(result.ok ? {} : { error: result.message }),
  });
});

app.get('/api/shops/:shopId/market/live-feed', requireAuth, requireShopAccess('market'), async (req, res) => {
  const shopRow = db.prepare(`SELECT state FROM shops WHERE id = ?`).get(req.params.shopId) as
    | { state: string }
    | undefined;
  const forceRefresh = req.query.force === '1' || req.query.force === 'true';
  const feed = await fetchLiveMasterMatrixFeed({
    shopId: req.params.shopId,
    state: typeof req.query.state === 'string' ? req.query.state : shopRow?.state,
    forceRefresh,
  });
  res.json(feed);
});

app.post('/api/shops/:shopId/market/live-feed/sync', requireAuth, requireShopAccess('market'), async (req, res) => {
  const shopRow = db.prepare(`SELECT state FROM shops WHERE id = ?`).get(req.params.shopId) as
    | { state: string }
    | undefined;
  const state = typeof req.body?.state === 'string' ? req.body.state : shopRow?.state;
  const commodity = typeof req.body?.commodity === 'string' ? req.body.commodity : undefined;
  const feed = await fetchLiveMasterMatrixFeed({
    shopId: req.params.shopId,
    state,
    commodity,
    forceRefresh: true,
    triggerType: 'manual',
  });
  res.json(feed);
});

app.post('/api/shops/:shopId/market/observations', requireAuth, requireShopAccess('market'), (req: AuthedRequest, res) => {
  const shopId = req.params.shopId;
  const b = req.body ?? {};
  if (!b.commodityOrProductName || !b.marketName || !b.location || !Number.isFinite(Number(b.modalPrice))) {
    res.status(400).json({ error: 'Product/commodity, market, location, and observed rate are required' });
    return;
  }

  let linkedProduct = b.productId
    ? loadProductsTypedForShop(shopId).find((p) => p.id === b.productId)
    : undefined;

  if (linkedProduct && b.packSize && !isPackSizeCompatible(linkedProduct.packSize, String(b.packSize))) {
    res.status(400).json({
      error: `Pack size mismatch: product specifies "${linkedProduct.packSize}" while observation specifies "${b.packSize}".`,
    });
    return;
  }

  ensureDefaultPriceSourcesForShop(shopId);
  const manualSource = db
    .prepare(`SELECT id FROM price_sources WHERE shop_id = ? AND source_key = 'owner_market_observations'`)
    .get(shopId) as { id: string };

  const id = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  const obsDate = b.observationDate || nowIso.slice(0, 10);
  const modal = roundCurrency(Number(b.modalPrice));
  const unitName = String(b.unit || linkedProduct?.baseUnit || 'Kilogram');

  let normalizedPerBase = modal;
  if (linkedProduct) {
    try {
      const factor = convertToBaseQuantity(1, unitName, linkedProduct.baseUnit, linkedProduct.units);
      normalizedPerBase = factor > 0 ? roundCurrency(modal / factor) : modal;
    } catch {
      normalizedPerBase = modal;
    }
  }

  const prevRow = db
    .prepare(`
      SELECT modal_price FROM market_prices
      WHERE shop_id = ? AND commodity_or_product_name = ? AND market_name = ?
      ORDER BY observation_date DESC, created_at DESC LIMIT 1
    `)
    .get(shopId, String(b.commodityOrProductName).trim(), String(b.marketName).trim()) as
    | { modal_price: number }
    | undefined;

  db.prepare(`
    INSERT INTO market_prices (
      id, shop_id, source_id, product_id, commodity_or_product_name, brand, pack_size, unit,
      market_name, state, district, location, min_price, max_price, modal_price, previous_price,
      price_unit_basis, normalized_per_base_unit, observation_date, freshness_status,
      verification_status, confidence_level, raw_payload_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
  `).run(
    id,
    shopId,
    manualSource.id,
    b.productId || null,
    String(b.commodityOrProductName).trim(),
    b.brand ? String(b.brand).trim() : linkedProduct?.brand ?? null,
    b.packSize ? String(b.packSize).trim() : linkedProduct?.packSize ?? null,
    unitName,
    String(b.marketName).trim(),
    b.state ? String(b.state).trim() : null,
    b.district ? String(b.district).trim() : null,
    String(b.location).trim(),
    b.minPrice ? Number(b.minPrice) : null,
    b.maxPrice ? Number(b.maxPrice) : null,
    modal,
    prevRow ? prevRow.modal_price : null,
    `INR per ${unitName}`,
    normalizedPerBase,
    obsDate,
    obsDate === nowIso.slice(0, 10) ? 'manual_entry' : 'historical',
    'owner_observed',
    'medium',
    nowIso
  );

  if (b.productId) {
    db.prepare(`UPDATE products SET market_coverage_status = 'manual_only', updated_at = ? WHERE id = ? AND shop_id = ?`).run(
      nowIso,
      b.productId,
      shopId
    );
  }

  logAudit({
    id: crypto.randomUUID(),
    shopId,
    userId: req.userId!,
    action: 'market.observation_logged',
    entityType: 'market_price',
    entityId: id,
    details: { product: b.commodityOrProductName, modalPrice: modal, market: b.marketName },
  });

  res.status(201).json({ id });
});

app.post('/api/shops/:shopId/market/quotations', requireAuth, requireShopAccess('market'), (req: AuthedRequest, res) => {
  const shopId = req.params.shopId;
  const b = req.body ?? {};
  if (!b.productId || !b.supplierId || !Number.isFinite(Number(b.quotedRate))) {
    res.status(400).json({ error: 'Product, supplier, and quoted rate are required' });
    return;
  }

  const prod = loadProductsTypedForShop(shopId).find((p) => p.id === b.productId);
  if (!prod) {
    res.status(404).json({ error: 'Product not found' });
    return;
  }

  const sup = db
    .prepare(`SELECT id FROM suppliers WHERE id = ? AND shop_id = ?`)
    .get(b.supplierId, shopId);
  if (!sup) {
    res.status(404).json({ error: 'Supplier not found in this shop' });
    return;
  }

  if (b.packSize && !isPackSizeCompatible(prod.packSize, String(b.packSize))) {
    res.status(400).json({
      error: `Pack size mismatch: "${prod.name}" has pack size "${prod.packSize}" and cannot be mixed with "${b.packSize}".`,
    });
    return;
  }

  const unitName = String(b.unit || prod.baseUnit);
  const quantity = b.quantity !== undefined && Number(b.quantity) > 0 ? Number(b.quantity) : 1;
  const quotedRate = roundCurrency(Number(b.quotedRate));
  const discountAmount = Math.max(0, roundCurrency(Number(b.discountAmount || 0)));
  const taxAmount = Math.max(0, roundCurrency(Number(b.taxAmount || 0)));
  const transportFreight = Math.max(0, roundCurrency(Number(b.freightEstimatePerUnit || 0)));
  const additionalCosts = Math.max(0, roundCurrency(Number(b.additionalCosts || 0)));

  let costCalc;
  try {
    costCalc = calculateQuotationLandedCost({
      quantity,
      unitName,
      baseUnit: prod.baseUnit,
      productUnits: prod.units,
      wholesaleRatePerUnit: quotedRate,
      discountAmount,
      taxAmount,
      transportFreight,
      additionalCosts,
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid unit or cost values' });
    return;
  }

  const id = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  const quoteDate = b.quotationDate || nowIso.slice(0, 10);

  withTransaction(() => {
    db.prepare(`
      INSERT INTO supplier_quotations (
        id, shop_id, product_id, supplier_id, brand, pack_size, quantity, unit, quoted_rate,
        discount_amount, tax_amount, freight_estimate_per_unit, additional_costs,
        final_landed_cost, landed_estimate, valid_until, quotation_date, source_evidence,
        verification_status, notes, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      shopId,
      b.productId,
      b.supplierId,
      b.brand ? String(b.brand).trim() : prod.brand,
      b.packSize ? String(b.packSize).trim() : prod.packSize,
      quantity,
      unitName,
      quotedRate,
      discountAmount,
      taxAmount,
      transportFreight,
      additionalCosts,
      costCalc.landedCostPerBaseUnit,
      costCalc.landedCostPerBaseUnit,
      b.validUntil || null,
      quoteDate,
      b.sourceEvidence ? String(b.sourceEvidence).trim() : null,
      b.verificationStatus || 'verified_quotation',
      b.notes ? String(b.notes).trim() : null,
      req.userId!,
      nowIso
    );

    if (prod.marketCoverageStatus === 'unsupported') {
      db.prepare(`UPDATE products SET market_coverage_status = 'supplier_quote_only', updated_at = ? WHERE id = ?`).run(
        nowIso,
        prod.id
      );
    }

    logAudit({
      id: crypto.randomUUID(),
      shopId,
      userId: req.userId!,
      action: 'market.quotation_logged',
      entityType: 'supplier_quotation',
      entityId: id,
      details: {
        productId: prod.id,
        supplierId: b.supplierId,
        quantity,
        unitName,
        quotedRate,
        finalLandedCost: costCalc.landedCostPerBaseUnit,
        validUntil: b.validUntil || null,
      },
    });
  });

  res.status(201).json({ id, landedEstimate: costCalc.landedCostPerBaseUnit, finalLandedCost: costCalc.landedCostPerBaseUnit });
});

app.post('/api/shops/:shopId/market/apply-price', requireAuth, requireShopAccess('market'), (req: AuthedRequest, res) => {
  const shopId = req.params.shopId;
  const { productId, newSellingPrice, targetMarginPct, strategy, alertReason, replacementLandedCost } =
    req.body ?? {};
  const nextPrice = roundCurrency(Number(newSellingPrice));
  if (!productId || !Number.isFinite(nextPrice) || nextPrice <= 0) {
    res.status(400).json({ error: 'Valid productId and positive newSellingPrice are required' });
    return;
  }

  const prod = loadProductsForShop(shopId).find((p) => p.id === productId);
  if (!prod) {
    res.status(404).json({ error: 'Product not found' });
    return;
  }

  if (prod.mrpRestricted && prod.mrp !== null && nextPrice > prod.mrp) {
    res.status(400).json({ error: `Cannot set selling price ₹${nextPrice.toFixed(2)} above MRP ₹${prod.mrp.toFixed(2)}` });
    return;
  }

  const nowIso = new Date().toISOString();
  const recId = crypto.randomUUID();

  withTransaction(() => {
    db.prepare(`
      INSERT INTO price_recommendations (
        id, shop_id, product_id, historical_landed_cost, replacement_landed_cost,
        current_selling_price, mrp, target_margin_pct, recommended_price, strategy,
        alert_reason, status, approved_by, approved_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?)
    `).run(
      recId,
      shopId,
      prod.id,
      prod.landedCost,
      replacementLandedCost ?? prod.landedCost,
      prod.sellingPrice,
      prod.mrp,
      Number(targetMarginPct || 15),
      nextPrice,
      strategy || 'owner_confirmed',
      alertReason || 'Owner-approved selling price update from Market Intelligence calculator',
      req.userId!,
      nowIso,
      nowIso
    );

    db.prepare(`UPDATE products SET selling_price = ?, updated_at = ? WHERE id = ? AND shop_id = ?`).run(
      nextPrice,
      nowIso,
      prod.id,
      shopId
    );

    logAudit({
      id: crypto.randomUUID(),
      shopId,
      userId: req.userId!,
      action: 'product.price_approved',
      entityType: 'product',
      entityId: prod.id,
      details: { previousPrice: prod.sellingPrice, newSellingPrice: nextPrice, strategy },
    });
  });

  res.json({ ok: true, sellingPrice: nextPrice });
});

// --- Dashboard & Reports ---
app.get('/api/shops/:shopId/dashboard', requireAuth, requireShopAccess(), (req, res) => {
  const shopId = req.params.shopId;
  const todayStr = new Date().toISOString().slice(0, 10);
  const monthPrefix = todayStr.slice(0, 7);

  const shop = db.prepare(`SELECT default_margin_pct FROM shops WHERE id = ?`).get(shopId) as {
    default_margin_pct: number;
  };

  const todayInvoices = loadInvoicesForShop(shopId, 200).filter((inv) => inv.createdAt.startsWith(todayStr));
  const todaySales = roundCurrency(todayInvoices.reduce((s, i) => s + i.totalAmount, 0));
  const todayBillsCount = todayInvoices.length;

  let grossProfitSum = 0;
  let grossProfitComplete = todayInvoices.length > 0;
  for (const inv of todayInvoices) {
    let invCostSum = 0;
    for (const item of inv.items) {
      if (item.costPriceSnapshot === null) {
        grossProfitComplete = false;
        break;
      }
      invCostSum += item.baseQuantityDeducted * item.costPriceSnapshot;
    }
    if (!grossProfitComplete) break;
    grossProfitSum += inv.totalAmount - inv.taxAmount - invCostSum;
  }

  const creditRow = db
    .prepare(`SELECT COALESCE(SUM(current_balance), 0) as total_credit FROM customers WHERE shop_id = ?`)
    .get(shopId) as { total_credit: number };

  const products = loadProductsForShop(shopId);
  let stockValue = 0;
  let stockValuationCompleteCount = 0;
  for (const p of products) {
    const unitCost = p.landedCost ?? p.purchasePrice;
    if (unitCost !== null) {
      stockValue += p.currentStock * unitCost;
      stockValuationCompleteCount++;
    }
  }
  const lowStockProducts = products.filter((p) => p.minStockLevel > 0 && p.currentStock <= p.minStockLevel);

  const todayExpRow = db
    .prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE shop_id = ? AND expense_date = ?`)
    .get(shopId, todayStr) as { total: number };
  const monthExpRow = db
    .prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE shop_id = ? AND expense_date LIKE ?`)
    .get(shopId, `${monthPrefix}%`) as { total: number };

  const payRows = db
    .prepare(`SELECT payment_mode, COALESCE(SUM(amount), 0) as total FROM payments WHERE shop_id = ? AND created_at LIKE ? GROUP BY payment_mode`)
    .all(shopId, `${todayStr}%`) as Array<{ payment_mode: string; total: number }>;

  const paymentCollection = {
    cash: roundCurrency(payRows.find((r) => r.payment_mode === 'cash')?.total || 0),
    upi: roundCurrency(payRows.find((r) => r.payment_mode === 'upi')?.total || 0),
    credit: roundCurrency(todayInvoices.reduce((s, i) => s + i.creditAmount, 0)),
  };

  // 7-day Sales Trend (dynamically starting from the first available invoice date)
  const allRecentInvoices = loadInvoicesForShop(shopId, 400);
  const dailyTrend: Array<{ date: string; sales: number; bills: number; grossProfit: number | null }> = [];
  if (allRecentInvoices.length > 0) {
    const sortedDates = allRecentInvoices
      .map((i) => i.createdAt.slice(0, 10))
      .filter(Boolean)
      .sort();
    const earliestDateStr = sortedDates[0];
    const todayStr = new Date().toISOString().slice(0, 10);
    const msPerDay = 86400 * 1000;
    const earliestTime = new Date(earliestDateStr).getTime();
    const todayTime = new Date(todayStr).getTime();
    const daysSinceFirst = Math.max(0, Math.floor((todayTime - earliestTime) / msPerDay));
    const windowDays = Math.min(6, isNaN(daysSinceFirst) ? 6 : daysSinceFirst);

    for (let d = windowDays; d >= 0; d--) {
      const dayStr = new Date(Date.now() - d * 86400 * 1000).toISOString().slice(0, 10);
      const dayInvs = allRecentInvoices.filter((i) => i.createdAt.startsWith(dayStr));
      const daySales = roundCurrency(dayInvs.reduce((s, i) => s + i.totalAmount, 0));
      let dayGp: number | null = null;
      if (dayInvs.length > 0) {
        let ok = true;
        let gp = 0;
        for (const inv of dayInvs) {
          for (const it of inv.items) {
            if (it.costPriceSnapshot === null) {
              ok = false;
              break;
            }
            gp += it.lineTotal - it.taxAmount - it.baseQuantityDeducted * it.costPriceSnapshot;
          }
          if (!ok) break;
          gp -= Math.max(0, inv.discountAmount - inv.items.reduce((s, x) => s + x.discountAmount, 0));
        }
        dayGp = ok ? roundCurrency(gp) : null;
      }
      dailyTrend.push({ date: dayStr, sales: daySales, bills: dayInvs.length, grossProfit: dayGp });
    }
  }

  const recentPurchases = db
    .prepare(`
      SELECT p.*, s.name as supplier_name
      FROM purchases p
      JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.shop_id = ?
      ORDER BY p.created_at DESC
      LIMIT 5
    `)
    .all(shopId) as Array<Record<string, unknown>>;

  const priceAlerts = computePriceAlertsForShop(shopId, Number(shop.default_margin_pct || 15));

  res.json({
    todaySales,
    todayBillsCount,
    todayGrossProfit: grossProfitComplete ? roundCurrency(grossProfitSum) : null,
    grossProfitDataComplete: grossProfitComplete,
    creditOutstanding: roundCurrency(Number(creditRow.total_credit)),
    stockValue: products.length > 0 && stockValuationCompleteCount > 0 ? roundCurrency(stockValue) : null,
    stockValuationCompleteCount,
    totalProductsCount: products.length,
    lowStockProducts,
    todayExpenses: roundCurrency(Number(todayExpRow.total)),
    monthExpenses: roundCurrency(Number(monthExpRow.total)),
    paymentCollection,
    recentInvoices: allRecentInvoices.slice(0, 6),
    recentPurchases: recentPurchases.map((p) => ({
      id: p.id,
      supplierId: p.supplier_id,
      supplierName: p.supplier_name,
      supplierInvoiceNo: p.supplier_invoice_no,
      purchaseDate: p.purchase_date,
      totalAmount: Number(p.total_amount),
      paymentStatus: p.payment_status,
      createdAt: p.created_at,
    })),
    dailyTrend,
    priceAlerts,
  });
});

app.get('/api/shops/:shopId/reports', requireAuth, requireShopAccess('reports'), (req, res) => {
  const shopId = req.params.shopId;
  const fromDate = (req.query.from as string) || new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10);
  const toDate = (req.query.to as string) || new Date().toISOString().slice(0, 10);

  const invoices = loadInvoicesForShop(shopId, 500).filter((inv) => {
    const d = inv.createdAt.slice(0, 10);
    return d >= fromDate && d <= toDate;
  });

  const totalSales = roundCurrency(invoices.reduce((s, i) => s + i.totalAmount, 0));
  const totalTax = roundCurrency(invoices.reduce((s, i) => s + i.taxAmount, 0));
  const totalCreditIssued = roundCurrency(invoices.reduce((s, i) => s + i.creditAmount, 0));

  let grossProfitSum = 0;
  let grossProfitComplete = invoices.length > 0;
  const productPerf = new Map<
    string,
    { productId: string; name: string; qtySold: number; revenue: number; costSum: number; costKnown: boolean }
  >();
  const products = loadProductsForShop(shopId);
  const prodCatMap = new Map(products.map((p) => [p.id, p.category]));
  const categoryPerf = new Map<string, { category: string; revenue: number; itemsSold: number }>();

  for (const inv of invoices) {
    for (const item of inv.items) {
      if (item.costPriceSnapshot === null) {
        grossProfitComplete = false;
      } else {
        grossProfitSum += item.lineTotal - item.taxAmount - item.baseQuantityDeducted * item.costPriceSnapshot;
      }
      const existing = productPerf.get(item.productId) || {
        productId: item.productId,
        name: item.productNameSnapshot,
        qtySold: 0,
        revenue: 0,
        costSum: 0,
        costKnown: true,
      };
      existing.qtySold = roundQty(existing.qtySold + item.baseQuantityDeducted);
      existing.revenue = roundCurrency(existing.revenue + item.lineTotal);
      if (item.costPriceSnapshot === null) {
        existing.costKnown = false;
      } else {
        existing.costSum = roundCurrency(existing.costSum + item.baseQuantityDeducted * item.costPriceSnapshot);
      }
      productPerf.set(item.productId, existing);

      const cat = prodCatMap.get(item.productId) || 'Other';
      const catEntry = categoryPerf.get(cat) || { category: cat, revenue: 0, itemsSold: 0 };
      catEntry.revenue = roundCurrency(catEntry.revenue + item.lineTotal);
      catEntry.itemsSold = roundQty(catEntry.itemsSold + item.quantity);
      categoryPerf.set(cat, catEntry);
    }
  }

  const expensesRows = db
    .prepare(`SELECT * FROM expenses WHERE shop_id = ? AND expense_date >= ? AND expense_date <= ?`)
    .all(shopId, fromDate, toDate) as Array<Record<string, unknown>>;
  const totalExpenses = roundCurrency(expensesRows.reduce((s, e) => s + Number(e.amount), 0));

  const purchasesRows = db
    .prepare(`SELECT * FROM purchases WHERE shop_id = ? AND purchase_date >= ? AND purchase_date <= ?`)
    .all(shopId, fromDate, toDate) as Array<Record<string, unknown>>;
  const totalPurchases = roundCurrency(purchasesRows.reduce((s, p) => s + Number(p.total_amount), 0));

  const paymentsRows = db
    .prepare(`SELECT payment_mode, COALESCE(SUM(amount), 0) as total FROM payments WHERE shop_id = ? AND substr(created_at, 1, 10) >= ? AND substr(created_at, 1, 10) <= ? GROUP BY payment_mode`)
    .all(shopId, fromDate, toDate) as Array<{ payment_mode: string; total: number }>;

  res.json({
    range: { fromDate, toDate },
    summary: {
      billsCount: invoices.length,
      totalSales,
      totalTax,
      totalCreditIssued,
      totalPurchases,
      totalExpenses,
      grossProfit: grossProfitComplete ? roundCurrency(grossProfitSum) : null,
      operatingSurplusBeforeTax:
        grossProfitComplete && expensesRows.length > 0
          ? roundCurrency(grossProfitSum - totalExpenses)
          : null,
    },
    productPerformance: Array.from(productPerf.values()).sort((a, b) => b.revenue - a.revenue),
    categoryPerformance: Array.from(categoryPerf.values()).sort((a, b) => b.revenue - a.revenue),
    paymentReconciliation: paymentsRows.map((r) => ({ mode: r.payment_mode, total: roundCurrency(r.total) })),
  });
});

app.get('/api/shops/:shopId/audit-logs', requireAuth, requireShopAccess('settings'), (req, res) => {
  const rows = db
    .prepare(`
      SELECT al.*, p.full_name as user_name
      FROM audit_logs al
      JOIN profiles p ON p.id = al.user_id
      WHERE al.shop_id = ?
      ORDER BY al.created_at DESC
      LIMIT 100
    `)
    .all(req.params.shopId) as Array<Record<string, unknown>>;

  res.json({
    logs: rows.map((r) => ({
      id: r.id,
      shopId: r.shop_id,
      userId: r.user_id,
      userName: r.user_name,
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id,
      detailsJson: r.details_json,
      createdAt: r.created_at,
    })),
  });
});

// ============================================================================
// DEVICE PAIRING & MOBILE BARCODE BRIDGE RELAY
// ============================================================================
interface BridgeSseClient {
  role: 'desktop' | 'mobile';
  res: any;
}
const bridgeRelayClients = new Map<string, Set<BridgeSseClient>>();
const bridgeMessageHistory = new Map<string, Array<any>>();

app.get('/api/device-bridge/events', (req, res) => {
  const token = String(req.query.token || '').trim();
  const role = (req.query.role === 'mobile' ? 'mobile' : 'desktop') as 'desktop' | 'mobile';

  if (!token) {
    res.status(400).end();
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const client: BridgeSseClient = { role, res };
  if (!bridgeRelayClients.has(token)) {
    bridgeRelayClients.set(token, new Set());
  }
  bridgeRelayClients.get(token)!.add(client);

  // Send initial connected ping
  res.write(`data: ${JSON.stringify({ type: 'CONNECTED', token, role, timestamp: Date.now() })}\n\n`);

  req.on('close', () => {
    const set = bridgeRelayClients.get(token);
    if (set) {
      set.delete(client);
      if (set.size === 0) {
        bridgeRelayClients.delete(token);
      }
    }
  });
});

app.post('/api/device-bridge/broadcast', (req, res) => {
  const { token, type, sender, payload, id, timestamp } = req.body || {};
  if (!token || !type) {
    res.status(400).json({ error: 'Missing token or type' });
    return;
  }

  const message = {
    id: id || `${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    type,
    sender: sender || 'desktop',
    token,
    timestamp: timestamp || Date.now(),
    payload,
  };

  // Buffer in recent history
  if (!bridgeMessageHistory.has(token)) {
    bridgeMessageHistory.set(token, []);
  }
  const hist = bridgeMessageHistory.get(token)!;
  hist.push(message);
  if (hist.length > 50) hist.shift();

  // Fan out to active SSE subscribers
  const clients = bridgeRelayClients.get(token);
  if (clients && clients.size > 0) {
    const raw = `data: ${JSON.stringify(message)}\n\n`;
    for (const c of clients) {
      try {
        c.res.write(raw);
      } catch {
        // ignore write failure
      }
    }
  }

  res.json({ ok: true, deliveredTo: clients ? clients.size : 0 });
});

app.get('/api/device-bridge/poll', (req, res) => {
  const token = String(req.query.token || '').trim();
  if (!token) {
    res.json({ messages: [] });
    return;
  }
  const msgs = bridgeMessageHistory.get(token) || [];
  res.json({ messages: msgs.slice(-10) });
});

// Scheduled 24-hour market rate sync & logging engine
startDailyMarketScheduler();

async function startServer() {
  const PORT = 3000;
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`BhavIQ server listening on http://localhost:${PORT}`);
  });
}

startServer();
