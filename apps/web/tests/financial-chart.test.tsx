import { calculateRsi } from '../src/trading/indicators.js';
import React from 'react';
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { FinancialChart } from '../src/components/financial-chart/FinancialChart.js';
import {
  CHART_RANGES,
  IndicatorEngine,
  normalizeBars,
  rangeStart,
} from '../src/components/financial-chart/model.js';
import type { FinancialBar } from '../src/components/financial-chart/model.js';
const bar = (index: number, close = 100 + index): FinancialBar => ({
  time: 1700000000 + index * 60,
  open: close,
  high: close + 1,
  low: close - 1,
  close,
  volume: 1000 + index,
});
const approximately = (actual: number | undefined, expected: number) => {
  assert.ok(
    actual !== undefined && Math.abs(actual - expected) < 1e-9,
    String(actual) + ' != ' + expected,
  );
};
test('SMA/EMA warm up with 20 observations, RSI with 14 changes, MACD signal with 34 bars', () => {
  const engine = new IndicatorEngine();
  engine.reset(Array.from({ length: 40 }, (_, index) => bar(index)));
  assert.equal(engine.points[18]!.sma, undefined);
  approximately(engine.points[19]!.sma, 109.5);
  approximately(engine.points[19]!.ema, 109.5);
  assert.equal(engine.points[13]!.rsi, undefined);
  approximately(engine.points[14]!.rsi, 100);
  assert.equal(engine.points[24]!.macd, undefined);
  approximately(engine.points[25]!.macd, 7);
  assert.equal(engine.points[32]!.signal, undefined);
  approximately(engine.points[33]!.signal, 7);
  approximately(engine.points[33]!.histogram, 0);
});
test('repeated forming-bar updates equal a fresh recomputation without compounding indicators', () => {
  const original = Array.from({ length: 80 }, (_, index) => bar(index, 100 + Math.sin(index) * 5));
  const incremental = new IndicatorEngine();
  incremental.reset(original);
  for (const close of [101, 120, 95, 110]) incremental.update(bar(79, close));
  incremental.update(bar(80, 111));
  const expected = new IndicatorEngine();
  expected.reset([...original.slice(0, -1), bar(79, 110), bar(80, 111)]);
  assert.deepEqual(incremental.points, expected.points);
  assert.equal(incremental.bars.length, 81);
  assert.throws(() => incremental.update(bar(1)), /Streaming bars must be ordered/);
});
test('flat prices produce neutral RSI, falling prices produce zero RSI', () => {
  const engine = new IndicatorEngine();
  engine.reset(Array.from({ length: 40 }, (_, index) => bar(index, 100)));
  approximately(engine.points.at(-1)!.rsi, 50);
  engine.reset(Array.from({ length: 40 }, (_, index) => bar(index, 100 - index)));
  approximately(engine.points.at(-1)!.rsi, 0);
});
test('normalization sorts, deduplicates, validates OHLC and rejects milliseconds', () => {
  assert.deepEqual(
    normalizeBars([bar(2), bar(1), bar(2, 123)]).map((value) => value.close),
    [101, 123],
  );
  assert.throws(() => normalizeBars([{ ...bar(0), high: 10 }]), /Invalid OHLCV/);
  assert.throws(() => normalizeBars([{ ...bar(0), volume: -1 }]), /Invalid OHLCV/);
  assert.throws(() => normalizeBars([{ ...bar(0), time: 1700000000000 }]), /Invalid OHLCV/);
});
test('calendar ranges clamp month-end dates and cover all seven presets', () => {
  const time = (value: string) => Math.floor(Date.parse(value) / 1000);
  assert.equal(rangeStart('1M', time('2024-03-31T12:00:00Z')), time('2024-02-29T12:00:00Z'));
  assert.equal(rangeStart('1Y', time('2024-02-29T12:00:00Z')), time('2023-02-28T12:00:00Z'));
  assert.equal(rangeStart('5Y', time('2026-10-09T12:00:00Z')), time('2021-10-09T12:00:00Z'));
  assert.equal(rangeStart('5D', time('2026-10-09T12:00:00Z')), time('2026-10-04T12:00:00Z'));
});
test('financial chart renders range/indicator controls, loading errors and TradingView credit without a browser', () => {
  const render = (element: React.ReactElement) => renderToStaticMarkup(element);
  const markup = render(<FinancialChart symbol="AAPL" data={[]} />);
  for (const range of CHART_RANGES) assert.ok(markup.includes('>' + range + '</button>'));
  for (const indicator of ['SMA 20', 'EMA 20', 'RSI', 'MACD'])
    assert.ok(markup.includes(indicator));
  assert.match(markup, /Charts by TradingView/);
  assert.match(markup, /No price data/);
  assert.match(render(<FinancialChart symbol="AAPL" data={[]} loading />), /Loading chart/);
  assert.match(
    render(<FinancialChart symbol="AAPL" data={[]} error="Feed unavailable" onRetry={() => {}} />),
    /Feed unavailable/,
  );
});

test('terminal RSI uses the same Wilder smoothing as the reusable chart', () => {
  const data = Array.from({ length: 80 }, (_, index) => bar(index, 100 + Math.sin(index) * 5));
  const engine = new IndicatorEngine();
  engine.reset(data);
  approximately(
    engine.points.at(-1)!.rsi,
    calculateRsi(data.map((value) => ({ ...value, time: String(value.time) }))),
  );
});
