export const CHART_RANGES = ['1D', '5D', '1M', '3M', '6M', '1Y', '5Y'] as const;
export type ChartRange = (typeof CHART_RANGES)[number];
export type ChartIndicator = 'SMA' | 'EMA' | 'RSI' | 'MACD';
export type FinancialBar = {
  /** UTC Unix timestamp in seconds (not milliseconds). */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Actual per-bar volume; omit when your feed does not provide it. */
  volume?: number;
};
export function validateBar(bar: FinancialBar) {
  if (
    !Number.isInteger(bar.time) ||
    bar.time < 0 ||
    bar.time > 253402300799 ||
    ![bar.open, bar.high, bar.low, bar.close].every(
      (value) => Number.isFinite(value) && value > 0,
    ) ||
    bar.high < Math.max(bar.open, bar.close, bar.low) ||
    bar.low > Math.min(bar.open, bar.close, bar.high) ||
    (bar.volume !== undefined && (!Number.isFinite(bar.volume) || bar.volume < 0))
  ) {
    throw new Error('Invalid OHLCV bar. Use UTC timestamps in seconds and consistent prices.');
  }
}
export function normalizeBars(data: readonly FinancialBar[]) {
  const byTime = new Map<number, FinancialBar>();
  for (const bar of data) {
    validateBar(bar);
    byTime.set(bar.time, { ...bar });
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}
export function sameBar(a: FinancialBar, b: FinancialBar) {
  return (
    a.time === b.time &&
    a.open === b.open &&
    a.high === b.high &&
    a.low === b.low &&
    a.close === b.close &&
    a.volume === b.volume
  );
}
export function rangeStart(range: ChartRange, end: number) {
  const date = new Date(end * 1000);
  if (range === '1D' || range === '5D') return end - (range === '1D' ? 1 : 5) * 86400;
  const months = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12, '5Y': 60 }[range];
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return Math.floor(date.getTime() / 1000);
}
type EmaState = { count: number; sum: number; value?: number | undefined };
const ema = (previous: EmaState, value: number, period: number): EmaState => {
  const count = previous.count + 1;
  const sum = previous.sum + value;
  return {
    count,
    sum,
    value:
      count < period
        ? undefined
        : previous.value === undefined
          ? sum / period
          : value * (2 / (period + 1)) + previous.value * (1 - 2 / (period + 1)),
  };
};
export type IndicatorPoint = {
  time: number;
  sma?: number;
  ema?: number;
  rsi?: number;
  macd?: number;
  signal?: number;
  histogram?: number;
};
type State = {
  sum: number;
  ema: EmaState;
  fast: EmaState;
  slow: EmaState;
  signal: EmaState;
  gain: number;
  loss: number;
};
const seed = (): State => ({
  sum: 0,
  ema: { count: 0, sum: 0 },
  fast: { count: 0, sum: 0 },
  slow: { count: 0, sum: 0 },
  signal: { count: 0, sum: 0 },
  gain: 0,
  loss: 0,
});
/** Incremental SMA/EMA(20), Wilder RSI(14), and MACD(12,26,9).
 * Replacing a forming candle always starts from the preceding candle's state. */
export class IndicatorEngine {
  readonly bars: FinancialBar[] = [];
  readonly points: IndicatorPoint[] = [];
  private readonly states: State[] = [];
  reset(data: readonly FinancialBar[]) {
    this.bars.length = 0;
    this.points.length = 0;
    this.states.length = 0;
    for (const bar of normalizeBars(data)) this.update(bar);
  }
  update(bar: FinancialBar) {
    validateBar(bar);
    const last = this.bars.at(-1);
    if (last && bar.time < last.time)
      throw new Error('Streaming bars must be ordered. Replace data for historical corrections.');
    const index = last?.time === bar.time ? this.bars.length - 1 : this.bars.length;
    const previous = this.states[index - 1] ?? seed();
    const sum = previous.sum + bar.close - (this.bars[index - 20]?.close ?? 0);
    const average = ema(previous.ema, bar.close, 20);
    const fast = ema(previous.fast, bar.close, 12);
    const slow = ema(previous.slow, bar.close, 26);
    const change = index ? bar.close - this.bars[index - 1]!.close : 0;
    const gain =
      index <= 14
        ? previous.gain + Math.max(change, 0) / 14
        : (previous.gain * 13 + Math.max(change, 0)) / 14;
    const loss =
      index <= 14
        ? previous.loss + Math.max(-change, 0) / 14
        : (previous.loss * 13 + Math.max(-change, 0)) / 14;
    const macd =
      fast.value !== undefined && slow.value !== undefined ? fast.value - slow.value : undefined;
    const signal = macd === undefined ? previous.signal : ema(previous.signal, macd, 9);
    const point: IndicatorPoint = {
      time: bar.time,
      ...(index >= 19 ? { sma: sum / 20 } : {}),
      ...(average.value !== undefined ? { ema: average.value } : {}),
      ...(index >= 14
        ? { rsi: loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss) }
        : {}),
      ...(macd !== undefined ? { macd } : {}),
      ...(signal.value !== undefined
        ? { signal: signal.value, histogram: macd! - signal.value }
        : {}),
    };
    this.bars[index] = { ...bar };
    this.states[index] = { sum, ema: average, fast, slow, signal, gain, loss };
    this.points[index] = point;
    return point;
  }
}

export const RANGE_REQUESTS: Record<ChartRange, { interval: string; limit: number }> = {
  '1D': { interval: '5m', limit: 330 },
  '5D': { interval: '15m', limit: 520 },
  '1M': { interval: '1h', limit: 800 },
  '3M': { interval: '1d', limit: 130 },
  '6M': { interval: '1d', limit: 220 },
  '1Y': { interval: '1d', limit: 400 },
  '5Y': { interval: '1d', limit: 2000 },
};
