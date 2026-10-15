export const ranges = ['1D', '5D', '1M', '3M', '6M', '1Y', '5Y'] as const;
export type ChartRange = (typeof ranges)[number];
export const rangeRequests: Record<ChartRange, { interval: string; limit: number }> = {
  '1D': { interval: '5m', limit: 320 },
  '5D': { interval: '15m', limit: 520 },
  '1M': { interval: '1h', limit: 800 },
  '3M': { interval: '1d', limit: 130 },
  '6M': { interval: '1d', limit: 220 },
  '1Y': { interval: '1d', limit: 400 },
  '5Y': { interval: '1d', limit: 2000 },
};
