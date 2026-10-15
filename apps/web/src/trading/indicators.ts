import type { TradingCandle } from './TradingComponents.js';
export function calculateRsi(candles: TradingCandle[], period = 14) {
  const changes = candles.slice(1).map((candle, index) => candle.close - candles[index]!.close);
  const initial = changes.slice(0, period);
  let gain =
    initial.reduce((sum, change) => sum + Math.max(change, 0), 0) / Math.max(initial.length, 1);
  let loss =
    initial.reduce((sum, change) => sum + Math.max(-change, 0), 0) / Math.max(initial.length, 1);
  for (const change of changes.slice(period)) {
    gain = (gain * (period - 1) + Math.max(change, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-change, 0)) / period;
  }
  if (gain === 0 && loss === 0) return 50;
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

export const demoHistory = (price: number): TradingCandle[] =>
  Array.from({ length: 48 }, (_, index) => {
    const wave = Math.sin(index * 0.71) * price * 0.004 + Math.cos(index * 0.23) * price * 0.002;
    const close = price * (0.982 + index * 0.00036) + wave;
    const previous =
      index === 0
        ? close - price * 0.0016
        : price * (0.982 + (index - 1) * 0.00036) +
          Math.sin((index - 1) * 0.71) * price * 0.004 +
          Math.cos((index - 1) * 0.23) * price * 0.002;
    const spread = price * (0.0012 + (index % 4) * 0.0002);
    return {
      time: `${String(9 + Math.floor((index * 6.5) / 60)).padStart(2, '0')}:${String(
        Math.floor((index * 6.5) % 60),
      ).padStart(2, '0')}`,
      open: previous,
      high: Math.max(previous, close) + spread,
      low: Math.min(previous, close) - spread,
      close,
    };
  });

export function calculateAtr(candles: TradingCandle[], period = 14) {
  const ranges = candles
    .map((candle, index) => {
      const previousClose = candles[index - 1]?.close ?? candle.open;
      return Math.max(
        candle.high - candle.low,
        Math.abs(candle.high - previousClose),
        Math.abs(candle.low - previousClose),
      );
    })
    .slice(-period);
  return ranges.reduce((sum, value) => sum + value, 0) / Math.max(ranges.length, 1);
}
