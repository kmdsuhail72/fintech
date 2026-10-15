import { getAccessToken, getAuthSessionVersion, setAccessToken } from './authToken.js';
const apiUrl = import.meta.env?.VITE_API_URL ?? 'http://localhost:3000/api/v1';

type ApiEnvelope<T> = { ok: boolean; data?: T; error?: { message?: string } };

let refreshFlight: Promise<boolean> | null = null;
let sessionChanging = false;
export function refreshSession(): Promise<boolean> {
  if (sessionChanging) return Promise.resolve(false);
  if (refreshFlight) return refreshFlight;
  const version = getAuthSessionVersion();
  refreshFlight = (async () => {
    try {
      const response = await fetch(`${apiUrl}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        signal: AbortSignal.timeout(15_000),
      });
      const result = (await response.json()) as ApiEnvelope<{ accessToken: string }>;
      if (version !== getAuthSessionVersion()) return false;
      if (!response.ok || !result.ok || !result.data?.accessToken) {
        setAccessToken(null, false);
        return false;
      }
      setAccessToken(result.data.accessToken, false);
      return true;
    } catch {
      return false;
    } finally {
      refreshFlight = null;
    }
  })();
  return refreshFlight;
}

export async function runSessionChange<T>(action: () => Promise<T>): Promise<T> {
  if (sessionChanging) throw new Error('Another session change is in progress.');
  sessionChanging = true;
  const pending = refreshFlight;
  setAccessToken(null);
  try {
    await pending;
    return await action();
  } finally {
    sessionChanging = false;
  }
}

export async function logoutSession() {
  await runSessionChange(async () => {
    const response = await fetch(`${apiUrl}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error('Server logout failed. Retry to revoke the session.');
  });
}

export async function requestApi<T>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const send = () =>
    fetch(`${apiUrl}${path}`, {
      method: options.method ?? 'GET',
      credentials: 'include',
      ...(options.signal ? { signal: options.signal } : {}),
      headers: {
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(getAccessToken() ? { Authorization: `Bearer ${getAccessToken()}` } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
  let response = await send();
  if (response.status === 401 && !path.startsWith('/auth/') && (await refreshSession())) {
    response = await send();
  }
  if (response.ok && response.status === 204) return undefined as T;
  const result = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!response.ok || !result?.ok || result.data === undefined) {
    throw new Error(result?.error?.message ?? `Request failed (${response.status})`);
  }
  return result.data;
}
