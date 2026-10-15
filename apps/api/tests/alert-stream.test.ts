import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { createClient } from 'redis';
import {
  AlertStreamWorker,
  quotePartition,
  streamKey,
  publishAlertQuote,
} from '../src/alerts/quote-stream.js';
import type { AlertEngine } from '../src/alerts/alert-engine.js';
import type { MarketQuote } from '../src/market-data/types.js';

const quote = {
  symbolId: randomUUID(),
  symbol: 'AAPL',
  currency: 'USD',
  price: '251',
  previousClose: '250',
  timestamp: new Date().toISOString(),
  quoteStatus: 'SIMULATED',
  source: 'test',
} as MarketQuote;
test('quote partition is stable and publication never uses destructive stream trimming', async () => {
  const calls: unknown[][] = [];
  const redis = {
    xAdd: async (...args: unknown[]) => {
      calls.push(args);
      return '1-0';
    },
  };
  await publishAlertQuote(redis as unknown as ReturnType<typeof createClient>, quote);
  assert.equal(calls[0]?.[0], streamKey(quotePartition(quote.symbolId)));
  assert.equal(calls[0]?.length, 3);
  assert.ok(quotePartition(quote.symbolId) >= 0 && quotePartition(quote.symbolId) < 16);
});

test('stream retries failed processing and acknowledges only after every match batch commits', async () => {
  const journal: string[] = [];
  const entry = { id: '1-0', message: { quote: JSON.stringify(quote) } };
  let read = false,
    done = false,
    evaluations = 0;
  const redis = {
    xGroupCreate: async () => {},
    xAutoClaim: async () => ({ nextId: '0-0', messages: read && !done ? [entry] : [] }),
    xReadGroup: async () => {
      if (read) return null;
      read = true;
      return [{ messages: [entry] }];
    },
    xClaim: async () => {
      journal.push('heartbeat');
      return [entry];
    },
    eval: async () => {
      journal.push('ack-and-delete');
      done = true;
    },
  };
  const engine = {
    evaluate: async () => {
      evaluations++;
      journal.push('evaluate-' + evaluations);
      if (evaluations === 1) throw new Error('Database unavailable');
      return evaluations === 2 ? 500 : evaluations === 3 ? 1 : 0;
    },
  };
  const worker = new AlertStreamWorker(
    redis as unknown as ReturnType<typeof createClient>,
    engine as unknown as AlertEngine,
    [0],
  );
  await worker.start();
  const deadline = Date.now() + 3000;
  while (!done && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
  await worker.stop();
  assert.ok(done);
  assert.deepEqual(journal, [
    'evaluate-1',
    'evaluate-2',
    'heartbeat',
    'evaluate-3',
    'heartbeat',
    'evaluate-4',
    'ack-and-delete',
  ]);
});

test('invalid JSON is quarantined and cannot block the stream indefinitely', async () => {
  let quarantined = false,
    acknowledged = false,
    read = false;
  const redis = {
    xGroupCreate: async () => {},
    xAutoClaim: async () => ({ nextId: '0-0', messages: [] }),
    xReadGroup: async () => {
      if (read) return null;
      read = true;
      return [{ messages: [{ id: '1-0', message: { quote: 'invalid-json' } }] }];
    },
    xAdd: async () => {
      quarantined = true;
    },
    eval: async () => {
      acknowledged = true;
    },
  };
  const engine = {
    evaluate: async () => {
      throw new Error('Must not evaluate malformed data');
    },
  };
  const worker = new AlertStreamWorker(
    redis as unknown as ReturnType<typeof createClient>,
    engine as unknown as AlertEngine,
    [0],
  );
  await worker.start();
  await new Promise((resolve) => setTimeout(resolve, 50));
  await worker.stop();
  assert.ok(quarantined && acknowledged);
});
