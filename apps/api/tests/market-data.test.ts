import assert from 'node:assert/strict';
import test from 'node:test';
import { SimulatedMarketDataProvider } from '../src/market-data/simulator.provider.js';
import type { MarketInstrument, MarketQuote } from '../src/market-data/types.js';

const instrument: MarketInstrument = {
  id: '66666666-6666-4666-8666-666666666661',
  symbol: 'AAPL',
  quoteCurrency: 'USD',
  latestQuote: {
    symbolId: '66666666-6666-4666-8666-666666666661',
    symbol: 'AAPL',
    currency: 'USD',
    price: '227.50000000',
    open: '227.50000000',
    high: '227.50000000',
    low: '227.50000000',
    previousClose: '227.50000000',
    change: '0.00000000',
    changePercent: '0.00000000',
    volume: 0,
    timestamp: '2026-10-07T00:00:00.000Z',
    quoteStatus: 'SIMULATED',
    source: 'synthetic-simulator-seed',
  },
};

test('simulator generates a changing, internally consistent OHLCV quote', async () => {
  const provider = new SimulatedMarketDataProvider(() => 0.5);
  const now = new Date('2026-10-07T12:00:00.000Z');
  const quote = await provider.generateQuote(instrument, instrument.latestQuote, now);

  assert.notEqual(quote.price, instrument.latestQuote.price);
  assert.equal(quote.timestamp, now.toISOString());
  assert.equal(quote.symbol, 'AAPL');
  assert.equal(quote.currency, 'USD');
  assert.equal(quote.quoteStatus, 'SIMULATED');
  assert.ok(Number(quote.low) <= Number(quote.price));
  assert.ok(Number(quote.high) >= Number(quote.price));
  assert.equal(
    Number(quote.change),
    Number((Number(quote.price) - Number(quote.previousClose)).toFixed(8)),
  );
  assert.equal(
    Number(quote.changePercent),
    Number(((Number(quote.change) / Number(quote.previousClose)) * 100).toFixed(8)),
  );
  assert.ok(Number.isSafeInteger(quote.volume));
  assert.ok(quote.volume > instrument.latestQuote.volume);
});

test('simulator resets session OHLCV at a UTC date boundary', async () => {
  const provider = new SimulatedMarketDataProvider(() => 0.5);
  const prior: MarketQuote = {
    ...instrument.latestQuote,
    price: '230.00000000',
    open: '227.50000000',
    high: '231.00000000',
    low: '226.00000000',
    previousClose: '225.00000000',
    change: '5.00000000',
    changePercent: '2.22222222',
    volume: 50000,
    timestamp: '2026-10-06T23:59:59.000Z',
  };
  const quote = await provider.generateQuote(
    instrument,
    prior,
    new Date('2026-10-07T00:00:01.000Z'),
  );

  assert.equal(quote.open, prior.price);
  assert.equal(quote.previousClose, prior.price);
  assert.ok(quote.volume < prior.volume);
  assert.ok(Number(quote.high) >= Number(quote.price));
  assert.ok(Number(quote.low) <= Number(quote.price));
});
