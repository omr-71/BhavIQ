/**
 * Tauri desktop bridge utilities for BhavIQ.
 * Provides runtime detection, system integration, and custom deep-linking (bhaviq://auth-callback)
 * to comply with Google OAuth policies and eliminate dependencies on local callback servers.
 */

/**
 * Detects if the BhavIQ application is running inside the Tauri desktop runtime.
 * Evaluates window.__TAURI__, window.__TAURI_INTERNALS__, or Tauri API availability.
 */
export function isTauri(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as Record<string, unknown>;
  return Boolean(
    w.__TAURI__ ||
    w.__TAURI_INTERNALS__ ||
    w.isTauri === true
  );
}

/**
 * Opens a URL in the user's default external web browser (Chrome, Edge, Firefox, etc.).
 * In Tauri, uses @tauri-apps/plugin-shell `open()`.
 * In standard browser environments, uses window.open with a new tab.
 */
export async function openExternalBrowser(url: string): Promise<boolean> {
  if (isTauri()) {
    try {
      const shell = await import('@tauri-apps/plugin-shell');
      if (typeof shell.open === 'function') {
        await shell.open(url);
        return true;
      }
    } catch (err) {
      console.warn('[BhavIQ Tauri] Failed to invoke @tauri-apps/plugin-shell open():', err);
    }
  }

  // Fallback for standard web browser or if plugin-shell fails
  try {
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    return Boolean(opened);
  } catch (err) {
    console.error('[BhavIQ Tauri] Failed to open external browser window:', err);
    return false;
  }
}

/**
 * Custom deep-link URI scheme registered for BhavIQ desktop.
 */
export const BHAVIQ_DEEP_LINK_SCHEME = 'bhaviq';
export const BHAVIQ_AUTH_CALLBACK_URL = 'bhaviq://auth-callback';

/**
 * Gets the authoritative redirect URL for OAuth flows.
 * Inside the Tauri desktop app, uses the custom deep link scheme `bhaviq://auth-callback`
 * to eliminate any dependency on a running localhost:3000 callback server.
 * In a standard web browser environment, returns `${window.location.origin}/auth/callback`.
 */
export function getOAuthRedirectUrl(): string {
  if (isTauri()) {
    return BHAVIQ_AUTH_CALLBACK_URL;
  }
  if (
    typeof window !== 'undefined' &&
    window.location?.origin &&
    !window.location.origin.includes('tauri.localhost') &&
    !window.location.origin.startsWith('tauri:')
  ) {
    return `${window.location.origin}/auth/callback`;
  }
  return BHAVIQ_AUTH_CALLBACK_URL;
}

/**
 * Legacy helper maintained for backward compatibility.
 */
export function getOAuthRedirectOrigin(): string {
  return getOAuthRedirectUrl();
}

/**
 * Registers a listener for desktop deep link URLs (e.g. bhaviq://auth-callback?code=...).
 * When an incoming deep link is received, executes the handler with the raw URL.
 * Returns an unlisten function.
 */
export async function onDeepLink(handler: (urls: string[]) => void): Promise<() => void> {
  if (!isTauri()) {
    return () => {};
  }
  try {
    const { onOpenUrl } = await import('@tauri-apps/plugin-deep-link');
    const unsubscribe = await onOpenUrl((urls) => {
      if (Array.isArray(urls) && urls.length > 0) {
        handler(urls);
      }
    });
    return () => {
      try {
        unsubscribe();
      } catch (err) {
        console.warn('[BhavIQ Tauri] Error unregistering deep link listener:', err);
      }
    };
  } catch (err) {
    console.warn('[BhavIQ Tauri] Failed to attach deep link listener:', err);
    return () => {};
  }
}

/**
 * Retrieves any initial deep-link URLs present at application startup.
 */
export async function getCurrentDeepLinks(): Promise<string[] | null> {
  if (!isTauri()) return null;
  try {
    const { getCurrent } = await import('@tauri-apps/plugin-deep-link');
    return await getCurrent();
  } catch (err) {
    console.warn('[BhavIQ Tauri] Failed to retrieve startup deep link URLs:', err);
    return null;
  }
}
