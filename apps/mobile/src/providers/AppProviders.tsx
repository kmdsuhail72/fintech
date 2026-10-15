import { useEffect, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { AppState } from 'react-native';
import { QueryClientProvider, focusManager } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { session } from '../services/runtime';
import { queryClient } from '../services/queryClient';
import { SessionContext } from '../hooks/useSession';
import { io } from 'socket.io-client';
import { SOCKET_URL } from '../config/env';
function SessionProvider({ children }: { children: ReactNode }) {
  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  useEffect(() => {
    void session.boot();
    const subscription = AppState.addEventListener('change', (state) => {
      focusManager.setFocused(state === 'active' && session.getSnapshot().status === 'ready');
      if (state !== 'active') session.lock();
    });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    focusManager.setFocused(snapshot.status === 'ready' && AppState.currentState === 'active');
    if (snapshot.status !== 'ready') {
      void queryClient.cancelQueries();
      queryClient.clear();
    }
  }, [snapshot.status, snapshot.user?.id]);
  useEffect(() => {
    if (snapshot.status !== 'ready') return;
    let stopped = false;
    let socket: ReturnType<typeof io> | undefined;
    const seen = new Set<string>();
    void session
      .token()
      .then((token) => {
        if (stopped) return;
        socket = io(SOCKET_URL, { auth: { token }, transports: ['websocket'], reconnection: true });
        socket.on('notification:new', (notice: { id?: unknown }) => {
          if (typeof notice?.id !== 'string' || seen.has(notice.id)) return;
          seen.add(notice.id);
          if (seen.size > 1000) seen.delete(seen.values().next().value!);
          void queryClient.invalidateQueries({ queryKey: ['alerts'] });
          void queryClient.invalidateQueries({ queryKey: ['notifications'] });
        });
      })
      .catch(() => {});
    return () => {
      stopped = true;
      socket?.disconnect();
    };
  }, [snapshot.status, snapshot.user?.id]);
  return <SessionContext.Provider value={snapshot}>{children}</SessionContext.Provider>;
}
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>{children}</SessionProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
