import assert from 'node:assert/strict';
import test from 'node:test';
import { ExpoPushGateway, pushRetryDelay } from '../src/notifications/push.gateway.js';
test('push gateway batches generic messages and leaves sensitive financial content on the server', async () => {
  let payload: unknown;
  const gateway = new ExpoPushGateway(undefined, (async (_url, options) => {
    payload = JSON.parse(String(options?.body));
    return new Response(JSON.stringify({ data: [{ status: 'ok', id: 'ticket-one' }] }), {
      status: 200,
    });
  }) as typeof fetch);
  const tickets = await gateway.send([
    {
      token: 'ExponentPushToken[test_token]',
      notificationId: 'notification-one',
      screen: 'Alerts',
    },
  ]);
  assert.deepEqual(tickets, [{ status: 'ok', id: 'ticket-one' }]);
  const messages = payload as { body: string; data: { screen: string } }[];
  assert.equal(messages[0]!.data.screen, 'Alerts');
  assert.doesNotMatch(messages[0]!.body, /balance|shares|price|profit/i);
  assert.throws(() => gateway.send([]));
  assert.equal(pushRetryDelay(0), 30000);
  assert.equal(pushRetryDelay(100), 3600000);
});
