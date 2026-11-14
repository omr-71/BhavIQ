export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

let authTokenCache: string | null = null;

export function setClientToken(token: string | null) {
  authTokenCache = token;
  if (token) {
    localStorage.setItem('bhaviq_token', token);
  } else {
    localStorage.removeItem('bhaviq_token');
  }
}

export function getClientToken(): string | null {
  if (authTokenCache) return authTokenCache;
  const stored = localStorage.getItem('bhaviq_token');
  authTokenCache = stored;
  return stored;
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getClientToken();
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const resp = await fetch(path, {
    ...options,
    headers,
    credentials: 'include',
  });

  const text = await resp.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    data = {};
  }

  if (!resp.ok) {
    const errText =
      typeof data.error === 'string'
        ? data.error
        : typeof data.message === 'string'
          ? data.message
          : `Request failed (${resp.status})`;
    throw new ApiError(errText, resp.status);
  }
  return data as T;
}
