import { WebSocket } from 'k6/websockets';
import { setTimeout, clearTimeout } from 'k6/timers';

// Socket.IO is not a raw JSON WebSocket. This helper handles the default
// namespace's Engine.IO v4 open/ping and Socket.IO connect/event packets.
export function marketStream(baseURL, token, symbolIds, metrics) {
  const socket = new WebSocket(
    `${baseURL.replace(/^http/, 'ws')}/socket.io/?EIO=4&transport=websocket`,
    null,
    {
      headers: { Origin: baseURL },
      tags: { name: 'market_stream' },
    },
  );
  let authenticated = false;
  let expectedClose = false;
  let reportedFailure = false;
  let lastQuote = Date.now();
  const failed = () => {
    if (!reportedFailure && !expectedClose) {
      metrics.errors.add(1);
      reportedFailure = true;
    }
  };
  const authDeadline = setTimeout(() => {
    if (!authenticated) {
      failed();
      socket.close();
    }
  }, 15_000);
  let freshnessTimer;
  const freshness = () => {
    if (expectedClose) return;
    if (authenticated && Date.now() - lastQuote > 60_000) metrics.stale.add(1);
    freshnessTimer = setTimeout(freshness, 30_000);
  };
  freshnessTimer = setTimeout(freshness, 60_000);
  socket.onmessage = (event) => {
    const packet = String(event.data);
    if (packet.startsWith('0')) {
      socket.send('40' + JSON.stringify({ token }));
    } else if (packet === '2') {
      socket.send('3'); // Engine.IO application heartbeat, not a TCP/WebSocket ping.
    } else if (packet.startsWith('40') && !authenticated) {
      authenticated = true;
      clearTimeout(authDeadline);
      metrics.opened.add(1);
      for (const symbolId of symbolIds)
        socket.send('42' + JSON.stringify(['market:subscribe', { symbolId }]));
    } else if (packet.startsWith('44')) {
      failed();
      socket.close();
    } else if (packet === '1' || packet.startsWith('41')) {
      failed();
      socket.close();
    } else if (packet.startsWith('42')) {
      try {
        const [name, data] = JSON.parse(packet.slice(2));
        if (name === 'market:error') failed();
        if (name === 'market:quote') {
          lastQuote = Date.now();
          metrics.messages.add(1);
          const lag = Date.now() - Date.parse(data.timestamp);
          if (Number.isFinite(lag) && lag >= 0) metrics.lag.add(lag);
          else metrics.clockSkew.add(1);
        }
      } catch {
        failed();
      }
    }
  };
  socket.onerror = failed;
  socket.onclose = () => {
    clearTimeout(authDeadline);
    clearTimeout(freshnessTimer);
    if (authenticated) metrics.closed.add(1);
    if (!expectedClose) failed();
  };
  return {
    close() {
      expectedClose = true;
      clearTimeout(authDeadline);
      clearTimeout(freshnessTimer);
      socket.close();
    },
  };
}
