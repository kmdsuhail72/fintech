import assert from 'node:assert/strict';
import test from 'node:test';
import { refreshSession, requestApi, logoutSession } from '../src/api.js';
import { getAccessToken, setAccessToken } from '../src/authToken.js';

test('refresh is serialized, retries one unauthorized request, and logout wins pending refresh', async () => {
  const original = globalThis.fetch;
  let refreshCalls = 0;
  let businessCalls = 0;
  let release: (() => void) | undefined;
  try {
    setAccessToken('expired');
    globalThis.fetch = async (input) => {
      if (String(input).endsWith('/auth/refresh')) {
        refreshCalls++;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return Response.json({ ok: true, data: { accessToken: 'fresh' } });
      }
      businessCalls++;
      return businessCalls === 1
        ? Response.json({}, { status: 401 })
        : Response.json({ ok: true, data: { balance: '100.00' } });
    };
    const first = refreshSession();
    const second = refreshSession();
    assert.equal(first, second);
    release!();
    assert.equal(await first, true);
    assert.equal(refreshCalls, 1);
    const request = requestApi<{ balance: string }>('/portfolio');
    await new Promise((resolve) => setTimeout(resolve, 0));
    release!();
    assert.equal((await request).balance, '100.00');
    assert.equal(businessCalls, 2);
    const stale = refreshSession();
    const logout = logoutSession();
    assert.equal(await refreshSession(), false);
    release!();
    assert.equal(await stale, false);
    await logout;
    assert.equal(getAccessToken(), null);
  } finally {
    globalThis.fetch = original;
    setAccessToken(null);
  }
});
