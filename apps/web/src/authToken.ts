import { useSyncExternalStore } from 'react';

let accessToken: string | null = null;
let authSessionVersion = 0;
const listeners = new Set<() => void>();

export function setAccessToken(token: string | null, replaceSession = true) {
  const changed = replaceSession || Boolean(accessToken) !== Boolean(token);
  accessToken = token;
  if (changed) {
    authSessionVersion += 1;
    listeners.forEach((listener) => listener());
  }
}

export function getAccessToken() {
  return accessToken;
}

export function getAuthSessionVersion() {
  return authSessionVersion;
}

export function subscribeAuth(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAuthSessionVersion() {
  return useSyncExternalStore(subscribeAuth, getAuthSessionVersion, () => 0);
}
