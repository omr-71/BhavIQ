import React, { useEffect, useRef, useState } from 'react';
import { BhaviqLogo } from '../components/BhaviqLogo';
import { validateAuthForm, type AuthMode } from '../lib/authValidation';
import { apiRequest, setClientToken } from '../lib/api';
import {
  buildAuthResultFromSupabaseSession,
  completeSupabasePopupCallback,
  extractAuthSessionFromUrl,
  fetchShopProfile,
  getSupabaseGoogleOAuthUrl,
  isSupabaseConfigured,
  signInWithSupabaseEmail,
  signUpWithSupabaseEmail,
} from '../lib/supabaseClient';
import {
  isTauri,
  openExternalBrowser,
  getOAuthRedirectUrl,
  onDeepLink,
  getCurrentDeepLinks,
} from '../lib/tauriBridge';
import type { Shop, UserProfile } from '../lib/types';
import {
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  Lock,
  Moon,
  ShieldCheck,
  Sun,
  TrendingUp,
} from 'lucide-react';

interface AuthResultPayload {
  token: string;
  user: UserProfile;
  shops: Shop[];
  activeShopId: string | null;
}

interface AuthPageProps {
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onAuthenticated: (data: {
    user: UserProfile;
    shops: Shop[];
    activeShopId: string | null;
  }) => void;
}

const GoogleGIcon: React.FC = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
    <path
      fill="#4285F4"
      d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
    />
    <path
      fill="#34A853"
      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
    />
    <path
      fill="#FBBC05"
      d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
    />
    <path
      fill="#EA4335"
      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
    />
  </svg>
);

export const AuthPage: React.FC<AuthPageProps> = ({
  theme,
  onToggleTheme,
  onAuthenticated,
}) => {
  const [mode, setMode] = useState<AuthMode>('login');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<'fullName' | 'phone' | 'email' | 'password', string>>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [manualCallbackUrl, setManualCallbackUrl] = useState('');

  const completeLogin = (res: AuthResultPayload) => {
    setClientToken(res.token);
    onAuthenticated({
      user: res.user,
      shops: res.shops,
      activeShopId: res.activeShopId,
    });
  };

  const activePollTimerRef = useRef<number | null>(null);

  const clearActivePoll = () => {
    if (activePollTimerRef.current !== null) {
      window.clearInterval(activePollTimerRef.current);
      activePollTimerRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      clearActivePoll();
    };
  }, []);

  const handleOAuthCallbackPayload = async (data?: {
    type?: string;
    search?: string;
    hash?: string;
    url?: string;
    payload?: AuthResultPayload;
    error?: string;
  }) => {
    if (!data?.type) return;

    if (data.type === 'BHAVIQ_OAUTH_ERROR') {
      clearActivePoll();
      setOauthLoading(false);
      setError(data.error || 'Google sign-in was cancelled.');
      return;
    }

    if (data.type === 'BHAVIQ_GOOGLE_AUTH_SUCCESS' && data.payload) {
      clearActivePoll();
      setOauthLoading(false);
      completeLogin(data.payload);
      return;
    }

    if (data.type === 'BHAVIQ_SUPABASE_OAUTH_CALLBACK') {
      try {
        clearActivePoll();
        let session = null;
        if (data.url) {
          session = await extractAuthSessionFromUrl(data.url);
        } else {
          session = await completeSupabasePopupCallback({
            search: data.search,
            hash: data.hash,
          });
        }
        if (!session?.access_token) {
          throw new Error('Google sign-in completed without an active Supabase session.');
        }

        // Try local backend exchange if available; otherwise use direct Supabase profile
        try {
          const exchanged = await apiRequest<AuthResultPayload>('/api/auth/supabase-exchange', {
            method: 'POST',
            body: JSON.stringify({ accessToken: session.access_token }),
          });
          // If server profile has no shops, query Supabase shop_profiles directly
          if (exchanged.shops.length === 0) {
            const vaultShop = await fetchShopProfile(session.user.id);
            if (vaultShop) {
              exchanged.shops = [vaultShop];
              exchanged.activeShopId = vaultShop.id;
            }
          }
          setOauthLoading(false);
          completeLogin(exchanged);
          return;
        } catch {
          const savedShop = await fetchShopProfile(session.user.id);
          const direct = buildAuthResultFromSupabaseSession(session, savedShop);
          setOauthLoading(false);
          completeLogin(direct);
          return;
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to finalize Google sign-in.');
        setOauthLoading(false);
      }
    }
  };

  // Register desktop deep link listener (bhaviq://auth-callback)
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    if (isTauri()) {
      onDeepLink((urls) => {
        if (urls && urls.length > 0) {
          handleOAuthCallbackPayload({
            type: 'BHAVIQ_SUPABASE_OAUTH_CALLBACK',
            url: urls[0],
          });
        }
      }).then((unsub) => {
        unlisten = unsub;
      });

      getCurrentDeepLinks().then((urls) => {
        if (urls && urls.length > 0) {
          handleOAuthCallbackPayload({
            type: 'BHAVIQ_SUPABASE_OAUTH_CALLBACK',
            url: urls[0],
          });
        }
      });
    }

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // Listen for OAuth completion messages via postMessage and BroadcastChannel
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      const origin = event.origin;
      const isTrustedOrigin =
        origin === window.location.origin ||
        origin.endsWith('.run.app') ||
        origin.includes('localhost') ||
        origin.includes('tauri.localhost');
      if (!isTrustedOrigin) return;

      const data = event.data as
        | { type?: string; search?: string; hash?: string; payload?: AuthResultPayload; error?: string }
        | undefined;
      await handleOAuthCallbackPayload(data);
    };

    window.addEventListener('message', handleMessage);

    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel('bhaviq_oauth');
      bc.onmessage = (event) => {
        handleOAuthCallbackPayload(event.data);
      };
    } catch {
      // BroadcastChannel unsupported or restricted in this runtime
    }

    return () => {
      window.removeEventListener('message', handleMessage);
      if (bc) bc.close();
    };
  }, []);

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setError(null);
    setInfoMessage(null);
    setFieldErrors({});
    setOauthLoading(false);
    clearActivePoll();
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setInfoMessage(null);
    setOauthLoading(true);
    setManualCallbackUrl('');
    clearActivePoll();

    try {
      const inTauri = isTauri();
      const redirectUrl = getOAuthRedirectUrl(); // Custom deep link bhaviq://auth-callback in Tauri

      let authUrl = '';
      if (isSupabaseConfigured()) {
        authUrl = await getSupabaseGoogleOAuthUrl({ redirectTo: redirectUrl });
      } else {
        const res = await apiRequest<{
          configured: boolean;
          url?: string;
          callbackUrl: string;
        }>('/api/auth/google/url');

        if (!res.configured || !res.url) {
          setOauthLoading(false);
          setInfoMessage(
            `Google OAuth needs Supabase (VITE_SUPABASE_URL & VITE_SUPABASE_ANON_KEY) or Google OAuth credentials (GOOGLE_CLIENT_ID & GOOGLE_CLIENT_SECRET).`
          );
          return;
        }
        authUrl = res.url;
      }

      if (inTauri) {
        setInfoMessage('Google sign-in opened in your default browser. Once authenticated, your browser will return to BhavIQ.');
        const opened = await openExternalBrowser(authUrl);
        if (!opened) {
          setOauthLoading(false);
          setError('Unable to launch system browser. Please check system default browser settings.');
          return;
        }
        return;
      }

      // Standard browser popup flow
      const width = 540;
      const height = 680;
      const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
      const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));
      const popup = window.open(
        authUrl,
        'bhaviq_google_oauth',
        `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
      );

      if (!popup) {
        // Fallback when browser blocks popup: open in new tab
        setInfoMessage('Browser popup blocked. Opened in tab... Complete sign-in there to continue.');
        const opened = await openExternalBrowser(authUrl);
        if (!opened) {
          setOauthLoading(false);
          setError('Popup was blocked by your browser. Please allow popups and try again.');
          return;
        }
        return;
      }

      const pollTimer = window.setInterval(() => {
        if (popup.closed) {
          window.clearInterval(pollTimer);
          setTimeout(() => {
            setOauthLoading(false);
          }, 1500);
        }
      }, 600);
    } catch (err) {
      clearActivePoll();
      setOauthLoading(false);
      setError(err instanceof Error ? err.message : 'Unable to start Google sign-in.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMessage(null);

    const validation = validateAuthForm({
      mode,
      fullName,
      phone,
      email,
      password,
    });
    setFieldErrors(validation.fieldErrors);
    if (!validation.valid) {
      return;
    }

    setSubmitting(true);
    setOauthLoading(false);
    try {
      if (isSupabaseConfigured()) {
        if (mode === 'login') {
          try {
            const sbData = await signInWithSupabaseEmail(
              validation.normalizedEmail,
              password
            );
            try {
              const exchanged = await apiRequest<AuthResultPayload>('/api/auth/supabase-exchange', {
                method: 'POST',
                body: JSON.stringify({ accessToken: sbData.session.access_token }),
              });
              if (exchanged.shops.length === 0) {
                const vaultShop = await fetchShopProfile(sbData.session.user.id);
                if (vaultShop) {
                  exchanged.shops = [vaultShop];
                  exchanged.activeShopId = vaultShop.id;
                }
              }
              completeLogin(exchanged);
              return;
            } catch {
              // Standalone Supabase direct profile resolution
              const savedShop = await fetchShopProfile(sbData.session.user.id);
              const direct = buildAuthResultFromSupabaseSession(sbData.session, savedShop);
              completeLogin(direct);
              return;
            }
          } catch (sbErr) {
            // Fall back to local SQLite auth for pre-existing shop accounts not yet in Supabase Auth
            try {
              const localRes = await apiRequest<AuthResultPayload>('/api/auth/login', {
                method: 'POST',
                body: JSON.stringify({
                  email: validation.normalizedEmail,
                  password,
                }),
              });
              completeLogin(localRes);
              return;
            } catch {
              throw sbErr;
            }
          }
        } else {
          const sbSignUp = await signUpWithSupabaseEmail({
            email: validation.normalizedEmail,
            password,
            fullName: validation.normalizedFullName,
            phone: validation.normalizedPhone,
          });
          if (!sbSignUp.session) {
            setInfoMessage(
              `Verification link sent to ${validation.normalizedEmail}. Confirm your email, then sign in.`
            );
            setMode('login');
            return;
          }
          try {
            const exchanged = await apiRequest<AuthResultPayload>('/api/auth/supabase-exchange', {
              method: 'POST',
              body: JSON.stringify({ accessToken: sbSignUp.session.access_token }),
            });
            completeLogin(exchanged);
            return;
          } catch {
            const direct = buildAuthResultFromSupabaseSession(sbSignUp.session, null);
            completeLogin(direct);
            return;
          }
        }
      }

      // Built-in BhavIQ server auth (SQLite-backed)
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const payload =
        mode === 'login'
          ? { email: validation.normalizedEmail, password }
          : {
              fullName: validation.normalizedFullName,
              phone: validation.normalizedPhone,
              email: validation.normalizedEmail,
              password,
            };

      const res = await apiRequest<AuthResultPayload>(endpoint, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      completeLogin(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to authenticate');
    } finally {
      setSubmitting(false);
    }
  };

  const inputBaseClass =
    'w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 px-3.5 py-2.5 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 shadow-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/25 focus:border-indigo-500 dark:focus:border-indigo-400 min-h-[44px] transition-all duration-150';

  return (
    <div className="relative min-h-screen w-full max-w-full overflow-hidden overflow-x-hidden flex flex-col justify-between bg-[#F8FAFC] dark:bg-gradient-to-br dark:from-[#0B1120] dark:via-[#0F172A] dark:to-[#131C31] text-[var(--text-primary)] px-4 py-6 md:px-10">
      {/* Subtle Ambient Glow Accents */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-32 -left-24 w-[460px] h-[460px] rounded-full bg-indigo-500/[0.08] dark:bg-indigo-500/[0.15] blur-3xl overflow-hidden"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-36 -right-24 w-[440px] h-[440px] rounded-full bg-emerald-500/[0.07] dark:bg-blue-500/[0.12] blur-3xl overflow-hidden"
      />

      {/* Top Navigation Bar */}
      <header className="relative z-10 max-w-6xl w-full mx-auto flex items-center justify-between gap-4">
        <BhaviqLogo size="md" />
        <button
          type="button"
          onClick={onToggleTheme}
          aria-label="Toggle color theme"
          className="min-h-[42px] px-4 py-2 rounded-xl border border-slate-200/90 dark:border-slate-700/80 bg-white/90 dark:bg-slate-800/90 backdrop-blur-md text-xs font-semibold text-slate-700 dark:text-slate-200 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 inline-flex items-center gap-2 whitespace-nowrap shrink-0"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-indigo-600" />}
          <span>{theme === 'dark' ? 'Light theme' : 'Dark theme'}</span>
        </button>
      </header>

      {/* Main 2-Column 3D Floating Cards Stage */}
      <main className="relative z-10 max-w-6xl w-full mx-auto my-auto py-8 lg:py-10 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-stretch bhaviq-page-enter max-w-full overflow-x-hidden">
        {/* Left Column: 3D Glassmorphic / White Branding & Feature Showcase Card */}
        <section
          aria-label="BhavIQ platform overview"
          className="lg:col-span-6 flex flex-col justify-between rounded-3xl bg-white/95 dark:bg-slate-900/90 backdrop-blur-xl p-7 md:p-9 border border-slate-200/80 dark:border-slate-700/75 ring-1 ring-white/80 dark:ring-white/5 shadow-2xl shadow-slate-300/60 dark:shadow-black/55"
        >
          <div className="space-y-5">
            <p className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 tracking-wide">
              Intelligent Retail Management for Modern India
            </p>
            <h1 className="font-display text-3xl sm:text-4xl lg:text-[42px] font-bold tracking-tight text-slate-900 dark:text-white leading-[1.12] [text-wrap:balance]">
              Know the market. Master your business.
            </h1>
            <p className="text-[15px] text-slate-600 dark:text-slate-300 leading-relaxed max-w-xl">
              BhavIQ unites fast POS billing, unit-accurate stock control, digital Khata credit ledgers, landed-cost purchasing, and verified wholesale price intelligence in one disciplined system.
            </p>

            {/* Interactive 3D Hover-Lift Feature Cards */}
            <div className="pt-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="group rounded-2xl bg-white dark:bg-slate-800/85 p-5 border border-slate-200/80 dark:border-slate-700/80 shadow-lg shadow-slate-200/60 dark:shadow-black/35 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-indigo-500/12 hover:border-indigo-200 dark:hover:border-indigo-500/40">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mb-3.5 transition-transform duration-300 group-hover:scale-105">
                  <TrendingUp className="w-5 h-5" />
                </div>
                <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-50">
                  Replacement-Cost Economics
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-300 mt-1.5 leading-relaxed">
                  Separate historical inventory profit from today&apos;s real restocking cost before setting shelf prices.
                </p>
              </div>

              <div className="group rounded-2xl bg-white dark:bg-slate-800/85 p-5 border border-slate-200/80 dark:border-slate-700/80 shadow-lg shadow-slate-200/60 dark:shadow-black/35 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-emerald-500/12 hover:border-emerald-200 dark:hover:border-emerald-500/40">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mb-3.5 transition-transform duration-300 group-hover:scale-105">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-50">
                  Zero Fabricated Data
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-300 mt-1.5 leading-relaxed">
                  Every metric, margin, and rate carries its exact source, timestamp, and calculation trail.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-7 pt-5 border-t border-slate-200/80 dark:border-slate-800 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>POS Counter</span>
            <span aria-hidden="true">·</span>
            <span>Digital Khata</span>
            <span aria-hidden="true">·</span>
            <span>Landed-Cost Ledger</span>
            <span aria-hidden="true">·</span>
            <span>Live Wholesale Matrix</span>
          </div>
        </section>

        {/* Right Column: Floating 3D Auth Card */}
        <section aria-label="Account authentication" className="lg:col-span-6 flex items-stretch">
          <div className="w-full max-w-md mx-auto lg:ml-auto rounded-3xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl p-7 md:p-9 border border-slate-200/80 dark:border-slate-700/75 ring-1 ring-white/80 dark:ring-white/5 shadow-2xl shadow-slate-300/60 dark:shadow-black/60 flex flex-col justify-center">
            {/* Segmented Toggle: Sign In / Create Account */}
            <div
              role="tablist"
              aria-label="Authentication mode"
              className="flex items-center gap-1 p-1 bg-slate-100/90 dark:bg-slate-800/90 border border-slate-200/70 dark:border-slate-700/70 rounded-xl mb-6"
            >
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'login'}
                onClick={() => switchMode('login')}
                className={`flex-1 py-2 px-3 text-xs font-semibold rounded-lg transition-all duration-200 min-h-[38px] whitespace-nowrap shrink-0 ${
                  mode === 'login'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm ring-1 ring-slate-200/80 dark:ring-slate-700'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'register'}
                onClick={() => switchMode('register')}
                className={`flex-1 py-2 px-3 text-xs font-semibold rounded-lg transition-all duration-200 min-h-[38px] whitespace-nowrap shrink-0 ${
                  mode === 'register'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm ring-1 ring-slate-200/80 dark:ring-slate-700'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Create Account
              </button>
            </div>

            <div className="mb-5">
              <h2 className="font-display text-xl font-bold tracking-tight text-slate-900 dark:text-white">
                {mode === 'login' ? 'Sign in to your shop' : 'Create your retailer account'}
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                {mode === 'login'
                  ? 'Access your billing counter, inventory, Khata, and live wholesale rates.'
                  : 'Start with a clean shop ledger — zero sample clutter or fabricated numbers.'}
              </p>
            </div>

            {/* Official Google OAuth Button */}
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={oauthLoading || submitting}
              className="w-full min-h-[46px] px-4 py-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-800 dark:text-slate-100 shadow-sm hover:shadow-md hover:-translate-y-0.5 hover:border-slate-300 dark:hover:border-slate-600 active:translate-y-0 disabled:opacity-60 transition-all duration-200 inline-flex items-center justify-center gap-3 whitespace-nowrap"
            >
              <GoogleGIcon />
              <span>{oauthLoading ? 'Connecting to Google...' : 'Sign in with Google'}</span>
            </button>

            {oauthLoading && (
              <div className="mt-3 p-3.5 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200/80 dark:border-indigo-800/60 text-xs">
                <div className="flex items-center gap-2 font-semibold text-indigo-950 dark:text-indigo-200 mb-1">
                  <span className="w-2 h-2 rounded-full bg-indigo-600 animate-ping" />
                  <span>Waiting for authentication...</span>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-300 mb-2 leading-relaxed">
                  Sign in completed in your browser? If BhavIQ does not open automatically, paste your redirected callback URL or code below:
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={manualCallbackUrl}
                    onChange={(e) => setManualCallbackUrl(e.target.value)}
                    onKeyDown={async (e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (manualCallbackUrl.trim()) {
                          await handleOAuthCallbackPayload({
                            type: 'BHAVIQ_SUPABASE_OAUTH_CALLBACK',
                            url: manualCallbackUrl.trim(),
                          });
                        }
                      }
                    }}
                    placeholder="bhaviq://auth-callback?code=... or authorization code"
                    className="flex-1 min-w-0 text-xs px-2.5 py-1.5 rounded-lg border border-indigo-200 dark:border-indigo-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      if (manualCallbackUrl.trim()) {
                        await handleOAuthCallbackPayload({
                          type: 'BHAVIQ_SUPABASE_OAUTH_CALLBACK',
                          url: manualCallbackUrl.trim(),
                        });
                      }
                    }}
                    className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs shrink-0 shadow-xs"
                  >
                    Authorize
                  </button>
                </div>
              </div>
            )}

            <div className="relative my-5 flex items-center">
              <div className="flex-grow border-t border-slate-200 dark:border-slate-700/80" />
              <span className="px-3 text-[11px] font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap">
                or continue with email
              </span>
              <div className="flex-grow border-t border-slate-200 dark:border-slate-700/80" />
            </div>

            {error && (
              <div
                role="alert"
                className="mb-4 px-3.5 py-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs font-medium text-rose-700 dark:text-rose-300"
              >
                {error}
              </div>
            )}

            {infoMessage && (
              <div
                role="status"
                className="mb-4 px-3.5 py-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/80 text-xs text-indigo-800 dark:text-indigo-200 flex items-start gap-2 leading-relaxed"
              >
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-indigo-600 dark:text-indigo-400" />
                <span className="break-words min-w-0">{infoMessage}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} noValidate className="space-y-4">
              {mode === 'register' && (
                <>
                  <div>
                    <label
                      htmlFor="auth-fullname"
                      className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                    >
                      Owner full name <span className="text-rose-600 dark:text-rose-400">*</span>
                    </label>
                    <input
                      id="auth-fullname"
                      type="text"
                      required
                      value={fullName}
                      onChange={(e) => {
                        setFullName(e.target.value);
                        if (fieldErrors.fullName) {
                          setFieldErrors((prev) => ({ ...prev, fullName: undefined }));
                        }
                      }}
                      aria-invalid={Boolean(fieldErrors.fullName)}
                      placeholder="e.g. Rajesh Kulkarni"
                      className={inputBaseClass}
                    />
                    {fieldErrors.fullName && (
                      <p className="mt-1 text-[11px] font-medium text-rose-600 dark:text-rose-400">
                        {fieldErrors.fullName}
                      </p>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="auth-phone"
                      className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                    >
                      Mobile number
                    </label>
                    <input
                      id="auth-phone"
                      type="tel"
                      value={phone}
                      onChange={(e) => {
                        setPhone(e.target.value);
                        if (fieldErrors.phone) {
                          setFieldErrors((prev) => ({ ...prev, phone: undefined }));
                        }
                      }}
                      aria-invalid={Boolean(fieldErrors.phone)}
                      placeholder="e.g. 9823012345"
                      className={inputBaseClass}
                    />
                    {fieldErrors.phone && (
                      <p className="mt-1 text-[11px] font-medium text-rose-600 dark:text-rose-400">
                        {fieldErrors.phone}
                      </p>
                    )}
                  </div>
                </>
              )}

              <div>
                <label
                  htmlFor="auth-email"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  Email address <span className="text-rose-600 dark:text-rose-400">*</span>
                </label>
                <input
                  id="auth-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (fieldErrors.email) {
                      setFieldErrors((prev) => ({ ...prev, email: undefined }));
                    }
                  }}
                  aria-invalid={Boolean(fieldErrors.email)}
                  placeholder="owner@yourshop.in"
                  className={inputBaseClass}
                />
                {fieldErrors.email && (
                  <p className="mt-1 text-[11px] font-medium text-rose-600 dark:text-rose-400">
                    {fieldErrors.email}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="auth-password"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  Password <span className="text-rose-600 dark:text-rose-400">*</span>
                </label>
                <div className="relative">
                  <input
                    id="auth-password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (fieldErrors.password) {
                        setFieldErrors((prev) => ({ ...prev, password: undefined }));
                      }
                    }}
                    aria-invalid={Boolean(fieldErrors.password)}
                    placeholder="Minimum 6 characters"
                    className={`${inputBaseClass} pr-11`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 min-w-[36px] min-h-[36px] rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {fieldErrors.password && (
                  <p className="mt-1 text-[11px] font-medium text-rose-600 dark:text-rose-400">
                    {fieldErrors.password}
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="bhaviq-btn-primary w-full min-h-[46px] px-5 py-2.5 rounded-xl disabled:opacity-60 text-sm font-semibold inline-flex items-center justify-center gap-2 whitespace-nowrap"
              >
                <span>
                  {submitting
                    ? 'Please wait...'
                    : mode === 'login'
                      ? 'Sign in to BhavIQ'
                      : 'Create BhavIQ Account & Set Up Shop'}
                </span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>

            <div className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              <Lock className="w-3.5 h-3.5 shrink-0 text-slate-400 dark:text-slate-500" />
              <span>Protected with encrypted session persistence</span>
            </div>
          </div>
        </section>
      </main>

      <footer className="relative z-10 max-w-6xl w-full mx-auto pt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
        <span>BhavIQ · Retail Management &amp; Market Intelligence</span>
        <span>Built for Indian Kirana, Grocery &amp; FMCG Retailers</span>
      </footer>
    </div>
  );
};
