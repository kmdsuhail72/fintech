import { useIsFocused } from '@react-navigation/native';
import { useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import { SOCKET_URL } from '../config/env';
import { session } from '../services/runtime';
import { useApiQuery } from './useApiQuery';
import type { Instrument, Quote } from '../services/types';
export function useLiveQuotes(instruments: Instrument[]) {
  const focused = useIsFocused();
  const identifiers = instruments
    .slice(0, 50)
    .map((item) => item.id)
    .join(',');
  const symbols = instruments
    .slice(0, 50)
    .map((item) => item.symbol)
    .join(',');
  const snapshots = useApiQuery<Quote[]>(
    'quotes',
    '/market/snapshots?symbols=' + encodeURIComponent(symbols),
    { interval: 5000, enabled: Boolean(symbols) && focused },
  );
  const [updates, setUpdates] = useState<Record<string, Quote>>({});
  const [connection, setConnection] = useState<'connecting' | 'live' | 'polling'>('connecting');
  useEffect(() => {
    setUpdates({});
    if (!identifiers || !focused) return;
    let stopped = false;
    let socket: ReturnType<typeof io> | undefined;
    const pending = new Map<string, Quote>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const connect = async () => {
      try {
        const token = await session.token();
        if (stopped) return;
        socket = io(SOCKET_URL, {
          auth: { token },
          // REST snapshots provide fallback; polling needs API-tier affinity.
          transports: ['websocket'],
          reconnection: true,
        });
        socket.on('connect', () => {
          setConnection('live');
          identifiers
            .split(',')
            .forEach((symbolId) => socket?.emit('market:subscribe', { symbolId }));
        });
        socket.on('disconnect', () => setConnection('polling'));
        socket.on('connect_error', () => setConnection('polling'));
        socket.on('market:error', () => setConnection('polling'));
        socket.on('market:quote', (quote: Quote) => {
          if (
            !quote ||
            !identifiers.split(',').includes(quote.symbolId) ||
            !Number.isFinite(Number(quote.price)) ||
            Number(quote.price) <= 0
          )
            return;
          pending.set(quote.symbol, quote);
          if (!timer)
            timer = setTimeout(() => {
              setUpdates((previous) => ({ ...previous, ...Object.fromEntries(pending) }));
              pending.clear();
              timer = undefined;
            }, 100);
        });
      } catch {
        if (!stopped) setConnection('polling');
      }
    };
    void connect();
    const refresh = setInterval(() => {
      void session
        .token()
        .then((token) => {
          if (stopped) return;
          if (
            socket &&
            socket.auth &&
            ((socket.auth as { token?: string }).token !== token || !socket.connected)
          ) {
            socket.auth = { token };
            socket.disconnect().connect();
          }
        })
        .catch(() => {
          if (!stopped) socket?.disconnect();
        });
    }, 30000);
    return () => {
      stopped = true;
      clearInterval(refresh);
      if (timer) clearTimeout(timer);
      socket?.removeAllListeners();
      socket?.disconnect();
    };
  }, [identifiers, focused]);
  const quotes = useMemo(() => {
    const map = new Map((snapshots.data ?? []).map((quote) => [quote.symbol, quote]));
    for (const quote of Object.values(updates)) {
      const existing = map.get(quote.symbol);
      if (!existing || Date.parse(quote.timestamp) >= Date.parse(existing.timestamp))
        map.set(quote.symbol, quote);
    }
    return map;
  }, [snapshots.data, updates]);
  return {
    quotes,
    connection,
    loading: snapshots.isLoading,
    error: snapshots.error,
    refetch: snapshots.refetch,
  };
}
