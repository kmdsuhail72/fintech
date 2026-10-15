import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { PageTitle } from './MarketUI.js';
import { requestApi, refreshSession } from './api.js';
import { getAccessToken, useAuthSessionVersion } from './authToken.js';

type Instrument = { id: string; symbol: string; quote_currency: string };
type Alert = {
  id: string;
  symbol: string;
  condition: string;
  target_price: string | null;
  target_change_percent: string | null;
  channels: string[];
  currency: string;
  status: string;
};
type Notice = {
  id: string;
  channel: string;
  title: string;
  body: string;
  status?: string;
  created_at?: string;
};
function mergeNotices(current: Notice[], incoming: Notice[]) {
  const byId = new Map(current.map((notice) => [notice.id, notice]));
  for (const notice of incoming) byId.set(notice.id, { ...byId.get(notice.id), ...notice });
  return [...byId.values()].slice(0, 100);
}

export function AlertsPage() {
  const accountScope = useAuthSessionVersion();
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [symbolId, setSymbolId] = useState('');
  const [condition, setCondition] = useState('ABOVE');
  const [target, setTarget] = useState('250');
  const [email, setEmail] = useState(false);
  const [push, setPush] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function refresh(signal?: AbortSignal) {
    const options = signal ? { signal } : {};
    const [saved, history] = await Promise.all([
      requestApi<Alert[]>('/alerts', options),
      requestApi<Notice[]>('/notifications?limit=100', options),
    ]);
    setAlerts(saved);
    setNotices(history);
  }
  useEffect(() => {
    const controller = new AbortController();
    setAlerts([]);
    setNotices([]);
    void requestApi<Instrument[]>('/market/symbols?limit=100', { signal: controller.signal })
      .then((items) => {
        setInstruments(items);
        setSymbolId(items[0]?.id ?? '');
      })
      .catch(() => {});
    void refresh(controller.signal).catch((cause) => {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'Sign in to manage alerts.');
    });
    const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api/v1';
    const socket = io(new URL(apiUrl, window.location.origin).origin, {
      auth: (callback) => callback({ token: getAccessToken() }),
      transports: ['websocket'],
      autoConnect: Boolean(getAccessToken()),
    });
    socket.on('notification:new', (notice: Notice) => {
      if (notice && typeof notice.id === 'string' && notice.channel === 'IN_APP') {
        setNotices((current) => mergeNotices([notice], current));
        void requestApi<Alert[]>('/alerts')
          .then(setAlerts)
          .catch(() => {});
      }
    });
    socket.on('connect', () => {
      void refresh(controller.signal).catch(() => {});
    });
    socket.on('disconnect', (reason) => {
      if (reason === 'io server disconnect' && !controller.signal.aborted) {
        void refreshSession().then((active) => {
          if (active && !controller.signal.aborted) socket.connect();
        });
      }
    });
    const polling = setInterval(() => void refresh(controller.signal).catch(() => {}), 30_000);
    return () => {
      controller.abort();
      clearInterval(polling);
      socket.disconnect();
    };
  }, [accountScope]);
  async function act(operation: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await operation();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Alert request failed.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="workspace-page">
      <PageTitle
        eyebrow="STAY INFORMED"
        title="Price alerts"
        subtitle="One notification per alert. Market data in this environment is simulated."
      />
      <section className="panel content-panel">
        <h2>Create an alert</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void act(async () => {
              const instrument = instruments.find((entry) => entry.id === symbolId);
              if (!instrument) throw new Error('Choose an instrument.');
              await requestApi('/alerts', {
                method: 'POST',
                body: {
                  symbolId,
                  condition,
                  currency: instrument.quote_currency,
                  ...(condition === 'CHANGE_PERCENT'
                    ? { targetChangePercent: target }
                    : { targetPrice: target }),
                  channels: ['IN_APP', ...(email ? ['EMAIL'] : []), ...(push ? ['PUSH'] : [])],
                },
              });
            });
          }}
        >
          <div className="research-controls">
            <label>
              Symbol
              <select
                value={symbolId}
                disabled={busy}
                onChange={(event) => setSymbolId(event.target.value)}
              >
                <option value="">Choose symbol</option>
                {instruments.map((instrument) => (
                  <option key={instrument.id} value={instrument.id}>
                    {instrument.symbol}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Condition
              <select
                value={condition}
                disabled={busy}
                onChange={(event) => setCondition(event.target.value)}
              >
                <option value="ABOVE">Price above</option>
                <option value="BELOW">Price below</option>
                <option value="CHANGE_PERCENT">Absolute change above (%)</option>
              </select>
            </label>
            <label>
              Threshold
              <input
                required
                inputMode="decimal"
                value={target}
                disabled={busy}
                onChange={(event) => setTarget(event.target.value)}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={email}
                disabled={busy}
                onChange={(event) => setEmail(event.target.checked)}
              />{' '}
              Email
            </label>
            <label>
              <input
                type="checkbox"
                checked={push}
                disabled={busy}
                onChange={(event) => setPush(event.target.checked)}
              />{' '}
              Mobile push
            </label>
          </div>
          <p>
            In-app history is always included. Percentage change measures either direction from the
            previous close. Email requires a verified address; push requires an enrolled mobile
            device.
          </p>
          <button className="button button-primary" disabled={busy || !symbolId}>
            {busy ? 'Saving…' : 'Save alert'}
          </button>
        </form>
        <p role="alert">{error}</p>
      </section>
      <section className="panel content-panel">
        <h2>Your alerts</h2>
        {alerts.length === 0 && <p>No alerts yet.</p>}
        <ul>
          {alerts.map((alert) => (
            <li key={alert.id}>
              {alert.symbol} ·{' '}
              {alert.condition === 'CHANGE_PERCENT'
                ? `absolute change > ${alert.target_change_percent}%`
                : `${alert.condition.toLowerCase()} ${alert.target_price} ${alert.currency}`}{' '}
              · {alert.status} · {alert.channels.join(', ')}{' '}
              {['ACTIVE', 'PAUSED'].includes(alert.status) && (
                <>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        await requestApi(`/alerts/${alert.id}`, {
                          method: 'PATCH',
                          body: { status: alert.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' },
                        });
                      })
                    }
                  >
                    {alert.status === 'ACTIVE' ? 'Pause' : 'Resume'}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        await requestApi(`/alerts/${alert.id}`, {
                          method: 'PATCH',
                          body: { status: 'CANCELLED' },
                        });
                      })
                    }
                  >
                    Cancel
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      </section>
      <section className="panel content-panel" aria-live="polite">
        <h2>Notification history</h2>
        <button disabled={busy} onClick={() => void act(async () => {})}>
          Refresh
        </button>
        {notices.length === 0 && <p>No notifications yet.</p>}
        <ul>
          {notices.map((notice) => (
            <li key={notice.id}>
              <strong>{notice.title}</strong>
              <p>{notice.body}</p>
              <small>
                {notice.channel} · {notice.status ?? 'New'}{' '}
                {notice.created_at ? `· ${new Date(notice.created_at).toLocaleString()}` : ''}
              </small>
              {notice.channel === 'IN_APP' && notice.status !== 'READ' && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await requestApi(`/notifications/${notice.id}/read`, { method: 'PATCH' });
                    })
                  }
                >
                  Mark read
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
