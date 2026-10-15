import type { Candle } from './types';
import type { ChartRange } from '../config/chart';
export type ChartBar = Candle & { sma: number | null };
function startOfRange(range: ChartRange, time: number) {
  if (range === '1D' || range === '5D') return time - (range === '1D' ? 1 : 5) * 86400000;
  const months = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12, '5Y': 60 }[range];
  const date = new Date(time);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - months);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return date.getTime();
}
export function prepareChartBars(data: Candle[], range?: ChartRange, maxPoints = 240): ChartBar[] {
  if (!Number.isInteger(maxPoints) || maxPoints < 1)
    throw new Error('Chart point limit must be positive.');
  const ordered = [
    ...new Map(
      data
        .filter(
          (bar) =>
            Number.isFinite(Date.parse(bar.timestamp)) &&
            [bar.open, bar.high, bar.low, bar.close].every(
              (value) => Number.isFinite(Number(value)) && Number(value) > 0,
            ),
        )
        .map((bar) => [bar.timestamp, bar]),
    ).values(),
  ].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  let total = 0;
  const points = ordered.map((bar, index) => {
    total += Number(bar.close);
    if (index >= 20) total -= Number(ordered[index - 20]!.close);
    return { ...bar, sma: index >= 19 ? total / 20 : null };
  });
  const start =
    range && ordered.length
      ? startOfRange(range, Date.parse(ordered.at(-1)!.timestamp))
      : -Infinity;
  const visible = points.filter((bar) => Date.parse(bar.timestamp) >= start);
  const stride = Math.ceil(visible.length / maxPoints) || 1;
  const result: ChartBar[] = [];
  for (let index = 0; index < visible.length; index += stride) {
    const group = visible.slice(index, index + stride);
    const first = group[0]!;
    const last = group.at(-1)!;
    result.push({
      ...last,
      open: first.open,
      high: String(Math.max(...group.map((bar) => Number(bar.high)))),
      low: String(Math.min(...group.map((bar) => Number(bar.low)))),
      samples: group.reduce((sum, bar) => sum + bar.samples, 0),
      volume: group.some(
        (bar) =>
          bar.volume == null || !Number.isFinite(Number(bar.volume)) || Number(bar.volume) < 0,
      )
        ? null
        : String(group.reduce((sum, bar) => sum + Number(bar.volume), 0)),
    });
  }
  return result;
}
