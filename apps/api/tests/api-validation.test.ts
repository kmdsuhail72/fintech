import assert from 'node:assert/strict';
import test from 'node:test';
import {
  adminQuoteSchema,
  createWatchlistSchema,
  marketSearchSchema,
  submitOrderSchema,
} from '../src/validators/api.validators.js';

test('market search applies bounded pagination defaults', () => {
  assert.deepEqual(marketSearchSchema.parse({}), { limit: 25, offset: 0 });
  assert.equal(marketSearchSchema.safeParse({ limit: 101 }).success, false);
  assert.equal(marketSearchSchema.safeParse({ unexpected: true }).success, false);
});

test('paper order request requires an idempotency key and positive decimal quantity', () => {
  const result = submitOrderSchema.safeParse({
    symbolId: '66666666-6666-4666-8666-666666666661',
    side: 'BUY',
    quantity: '1.125',
    idempotencyKey: 'mobile-order-001',
  });
  assert.equal(result.success, true);
  assert.equal(
    submitOrderSchema.safeParse({
      symbolId: '66666666-6666-4666-8666-666666666661',
      side: 'BUY',
      quantity: '0',
      idempotencyKey: 'mobile-order-001',
    }).success,
    false,
  );
  assert.equal(
    submitOrderSchema.safeParse({
      symbolId: '66666666-6666-4666-8666-666666666661',
      side: 'BUY',
      quantity: '1',
      idempotencyKey: 'short',
      leverage: 10,
    }).success,
    false,
  );
  assert.equal(
    submitOrderSchema.safeParse({
      symbolId: '66666666-6666-4666-8666-666666666661',
      side: 'BUY',
      quantity: '1000000000000',
      idempotencyKey: 'mobile-order-001',
    }).success,
    false,
  );
});

test('admin quote values reject unsupported status and nonpositive prices', () => {
  const quote = {
    price: '12.50',
    open: '12.00',
    high: '13.00',
    low: '11.00',
    previousClose: '12.00',
    change: '0.50',
    changePercent: '4.16666667',
    volume: 1200,
    currency: 'USD',
    quoteStatus: 'SIMULATED',
    source: 'synthetic-simulator',
  };
  assert.equal(adminQuoteSchema.safeParse(quote).success, true);
  assert.equal(adminQuoteSchema.safeParse({ ...quote, price: '0' }).success, false);
  assert.equal(adminQuoteSchema.safeParse({ ...quote, quoteStatus: 'INFERRED' }).success, false);
});

test('watchlist names are bounded and unexpected properties are rejected', () => {
  assert.equal(createWatchlistSchema.safeParse({ name: 'Long-term ideas' }).success, true);
  assert.equal(createWatchlistSchema.safeParse({ name: '  ' }).success, false);
  assert.equal(
    createWatchlistSchema.safeParse({ name: 'Learning', isPublic: true }).success,
    false,
  );
});
