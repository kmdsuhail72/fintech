import React from 'react';
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import {
  OrderPanel,
  TradingChart,
  TradingWatchlist,
  ConfirmTradeModal,
} from '../src/trading/TradingComponents.js';

const noop = () => {};
const render = (element: React.ReactElement) => renderToStaticMarkup(element);
const panel = (overrides: Partial<Parameters<typeof OrderPanel>[0]> = {}) =>
  render(
    <MemoryRouter>
      <OrderPanel
        instrument={{ id: 'test-symbol', symbol: 'AAPL', exchange_code: 'NASDAQ' }}
        price={200}
        change={1}
        side="BUY"
        quantity="2"
        availableCash={1000}
        availableShares={5}
        balanceLoading={false}
        isAuthenticated
        submitting={false}
        onSideChange={noop}
        onQuantityChange={noop}
        onReview={noop}
        {...overrides}
      />
    </MemoryRouter>,
  );

test('order ticket shows estimate and prevents review when funds or shares are insufficient', () => {
  const valid = panel();
  assert.match(valid, /Estimated trade value/);
  assert.match(valid, /\$400\.00/);
  assert.doesNotMatch(valid, /class="button order-submit " disabled/);
  for (const error of [
    'Insufficient available balance for this order.',
    'Quantity exceeds your available shares.',
  ]) {
    const invalid = panel({ validationError: error });
    assert.match(invalid, /aria-invalid="true"/);
    assert.ok(invalid.includes(error));
    assert.match(invalid, /class="button order-submit " disabled=""/);
  }
});

test('order ticket distinguishes signed-out, loading and submitting states', () => {
  assert.match(panel({ isAuthenticated: false }), /Sign in to place a paper trade/);
  assert.match(panel({ balanceLoading: true }), /class="button order-submit " disabled=""/);
  const submitting = panel({ submitting: true });
  assert.match(submitting, /Submitting/);
  assert.match(submitting, /disabled=""/);
});

test('saved watchlist keeps empty accounts empty and exposes service errors', () => {
  const props: Parameters<typeof TradingWatchlist>[0] = {
    instruments: [],
    quotes: [],
    selected: 'AAPL',
    onSelect: noop,
    loading: false,
    watchlists: [],
    watchlistId: '',
    onWatchlistChange: noop,
    onRetry: noop,
    authenticated: true,
    onToggleSymbol: noop,
    saving: false,
    canSave: true,
  };
  const empty = render(<TradingWatchlist {...props} />);
  assert.match(empty, /Your watchlist is empty/);
  assert.match(empty, /Add AAPL/);
  assert.doesNotMatch(empty, /trading-watch-row/);
  const unavailable = render(
    <TradingWatchlist {...props} error="Could not load your saved watchlists." />,
  );
  assert.match(unavailable, /role="alert"/);
  assert.match(unavailable, /Retry/);
});

test('chart renders actual OHLC and supported intervals, with explicit loading/error/empty states', () => {
  const props: Parameters<typeof TradingChart>[0] = {
    candles: [],
    symbol: 'AAPL',
    loading: false,
    interval: '5m',
    onIntervalChange: noop,
    chartType: 'CANDLE',
    onChartTypeChange: noop,
    onRetry: noop,
  };
  assert.match(render(<TradingChart {...props} />), /No recorded prices/);
  assert.match(render(<TradingChart {...props} loading />), /Loading price candles/);
  assert.match(
    render(<TradingChart {...props} error="Market data unavailable" />),
    /Market data unavailable/,
  );
  const chart = render(
    <TradingChart
      {...props}
      candles={[{ time: '10:00', open: 200, high: 210, low: 195, close: 205 }]}
    />,
  );
  assert.match(chart, /O \$200\.00 H \$210\.00 L \$195\.00 C \$205\.00/);
  for (const interval of ['1m', '5m', '15m', '1h', '1d'])
    assert.ok(chart.includes('>' + interval + '</button>'));
  assert.doesNotMatch(chart, /NaN|Infinity/);
});

test('confirmation keeps submission errors visible and blocks duplicate clicks while sending', () => {
  const modal = render(
    <ConfirmTradeModal
      symbol="AAPL"
      side="BUY"
      quantity={2}
      price={200}
      busy
      onClose={noop}
      onConfirm={noop}
      error="No order was submitted"
    />,
  );
  assert.match(modal, /aria-modal="true"/);
  assert.match(modal, /No order was submitted/);
  assert.match(modal, /Sending/);
  assert.match(modal, /disabled=""/);
});
