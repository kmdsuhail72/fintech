# FinancialChart

Reusable React + TypeScript component using Lightweight Charts 5.2. The trading terminal uses it directly.

```tsx
import { useRef, useState } from 'react';
import { FinancialChart } from './components/financial-chart/index.js';
import type {
  ChartRange,
  FinancialBar,
  FinancialChartHandle,
} from './components/financial-chart/index.js';
import './components/financial-chart/financial-chart.css';

export function MarketChart({ bars }: { bars: FinancialBar[] }) {
  const chartRef = useRef<FinancialChartHandle>(null);
  const [range, setRange] = useState<ChartRange>('1M');
  return (
    <FinancialChart
      ref={chartRef}
      symbol="AAPL"
      currency="USD"
      data={bars}
      range={range}
      onRangeChange={setRange}
      defaultIndicators={['SMA', 'EMA']}
      height={340}
    />
  );
}
```

- Each bar has a UTC Unix timestamp **in seconds**, OHLC prices, and optional actual per-bar volume. Volume is never invented when absent. Snapshots are sorted and duplicate timestamps keep the last supplied bar.
- The range controls support 1D, 5D, 1M, 3M, 6M, 1Y, and 5Y. They use calendar windows ending at the last recorded bar. Supply history for the desired range and preload at least 34 earlier bars for indicator warm-up. `onRangeChange` lets a parent request a different resolution/history window. No exchange calendar or missing history is fabricated.
- SMA(20) and EMA(20) are price overlays; Wilder RSI(14) and MACD(12,26,9) use separate panes. Users toggle them dynamically. SMA/EMA need 20 bars, RSI needs 15 bars, and the MACD signal/histogram needs 34 bars. EMA is seeded with an SMA; RSI uses Wilder smoothing.
- Set `chartType` and `onChartTypeChange` for the candle/line switch. Set `loading`, `error`, and `onRetry` for service states. `onDataError` receives malformed/out-of-order stream errors.
- For frequent updates, call `chartRef.current?.update(nextBar)` from your feed callback. Alternatively, pass `latestBar`. Updates are coalesced once per animation frame, preserving every distinct bar timestamp while replacing repeated ticks for the same candle. Core and indicator series use `update()`; the chart is created once and removed on unmount. A current candle replacement recomputes from the previous candle's indicator state so ticks do not compound EMA/RSI/MACD.
- Use the `data` prop to replace history or correct older bars. Historical snapshots are authoritative and cancel pending stream ticks. Unchanged history and last-bar appends/replacements avoid `setData()`; historical corrections replace the series data. Keep snapshot arrays stable between unrelated renders.
- User zoom/pan is retained on live updates; selecting a range or changing a symbol resets the visible window. `ref.current.fitRange()` resets it explicitly. Lightweight Charts' `autoSize` uses ResizeObserver and reacts to the container's size. Base height plus volume/indicator panes determines the total height.
- TradingView attribution remains visible. See [the official API documentation](https://tradingview.github.io/lightweight-charts/docs).

The backend candle endpoint supports up to 2,000 UTC buckets and exposes sampled volume deltas from session counters. Unknown counter baselines or unexpected counter decreases produce null volume. OHLC reflects stored observations, not a complete tick feed. The selected five-year window only shows history that actually exists.
