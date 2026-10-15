import assert from 'node:assert/strict';
import test from 'node:test';
import { readBoundedResponse } from '../src/utils/bounded-response.js';
import { ApiError } from '../src/utils/errors.js';

test('upstream byte limit cancels oversized streams and maps interrupted streams safely', async () => {
  let cancelled = false;
  const oversized = new Response(
    new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(32));
      },
      cancel() {
        cancelled = true;
      },
    }),
  );
  await assert.rejects(
    readBoundedResponse(oversized, 16),
    (error: unknown) => error instanceof ApiError && error.status === 502,
  );
  assert.equal(cancelled, true);
  const interrupted = new Response(
    new ReadableStream({
      start(controller) {
        controller.error(new Error('private upstream failure'));
      },
    }),
  );
  await assert.rejects(
    readBoundedResponse(interrupted, 16),
    (error: unknown) => error instanceof ApiError && error.status === 503,
  );
  assert.equal(await readBoundedResponse(new Response('héllo'), 16), 'héllo');
});
