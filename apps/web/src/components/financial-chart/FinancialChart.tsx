import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  createChart,
} from 'lightweight-charts';
import type { IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts';
import {
  CHART_RANGES,
  IndicatorEngine,
  normalizeBars,
  rangeStart,
  sameBar,
  validateBar,
} from './model.js';
import type { ChartIndicator, ChartRange, FinancialBar, IndicatorPoint } from './model.js';

export type FinancialChartHandle = {
  /** Last-bar replacement or append. Call setData via the data prop for older corrections. */
  update: (bar: FinancialBar) => void;
  fitRange: () => void;
};
export type FinancialChartProps = {
  symbol: string;
  data: readonly FinancialBar[];
  currency?: string;
  range?: ChartRange;
  defaultRange?: ChartRange;
  onRangeChange?: (range: ChartRange) => void;
  defaultIndicators?: readonly ChartIndicator[];
  chartType?: 'candlestick' | 'line';
  onChartTypeChange?: (type: 'candlestick' | 'line') => void;
  /** Optional stream prop. An imperative update() also avoids React renders per tick. */
  latestBar?: FinancialBar;
  height?: number;
  loading?: boolean;
  error?: string | undefined;
  onRetry?: () => void;
  onDataError?: (error: Error) => void;
};
type AuxiliarySeries = ISeriesApi<'Line'> | ISeriesApi<'Histogram'>;
type Runtime = {
  chart: IChartApi;
  candles: ISeriesApi<'Candlestick'>;
  line: ISeriesApi<'Line'>;
  volume: ISeriesApi<'Histogram'>;
  extras: Map<string, AuxiliarySeries>;
  engine: IndicatorEngine;
  pending: Map<number, FinancialBar>;
  frame: number;
};
const timestamp = (time: number) => time as UTCTimestamp;
const pointData = (point: IndicatorPoint, key: keyof Omit<IndicatorPoint, 'time'>) =>
  point[key] === undefined
    ? { time: timestamp(point.time) }
    : {
        time: timestamp(point.time),
        value: point[key]!,
        ...(key === 'histogram' ? { color: point[key]! >= 0 ? '#329e7d' : '#d06b75' } : {}),
      };
function populate(runtime: Runtime) {
  runtime.candles.setData(
    runtime.engine.bars.map((bar) => ({ ...bar, time: timestamp(bar.time) })),
  );
  runtime.line.setData(
    runtime.engine.bars.map((bar) => ({ time: timestamp(bar.time), value: bar.close })),
  );
  runtime.volume.setData(
    runtime.engine.bars.map((bar) =>
      bar.volume === undefined
        ? { time: timestamp(bar.time) }
        : {
            time: timestamp(bar.time),
            value: bar.volume,
            color: bar.close >= bar.open ? '#329e7d88' : '#d06b7588',
          },
    ),
  );
  for (const [key, series] of runtime.extras)
    series.setData(
      runtime.engine.points.map((point) =>
        pointData(point, key as keyof Omit<IndicatorPoint, 'time'>),
      ),
    );
}
function applyBar(runtime: Runtime, bar: FinancialBar) {
  const point = runtime.engine.update(bar);
  runtime.candles.update({ ...bar, time: timestamp(bar.time) });
  runtime.line.update({ time: timestamp(bar.time), value: bar.close });
  runtime.volume.update(
    bar.volume === undefined
      ? { time: timestamp(bar.time) }
      : {
          time: timestamp(bar.time),
          value: bar.volume,
          color: bar.close >= bar.open ? '#329e7d88' : '#d06b7588',
        },
  );
  for (const [key, series] of runtime.extras)
    series.update(pointData(point, key as keyof Omit<IndicatorPoint, 'time'>));
}
const FinancialChartBase = forwardRef<FinancialChartHandle, FinancialChartProps>(
  function FinancialChart(
    {
      symbol,
      data,
      currency = 'USD',
      range: controlledRange,
      defaultRange = '1M',
      onRangeChange,
      defaultIndicators = ['SMA'],
      chartType = 'candlestick',
      onChartTypeChange,
      latestBar,
      height = 340,
      loading = false,
      error,
      onRetry,
      onDataError,
    },
    ref,
  ) {
    const container = useRef<HTMLDivElement>(null);
    const runtimeRef = useRef<Runtime | null>(null);
    const [localRange, setLocalRange] = useState(defaultRange);
    const [indicators, setIndicators] = useState<ChartIndicator[]>([...defaultIndicators]);
    const [legend, setLegend] = useState<FinancialBar | undefined>();
    const [dataError, setDataError] = useState('');
    const [hasBars, setHasBars] = useState(false);
    const formatter = useMemo(
      () => new Intl.NumberFormat('en-US', { style: 'currency', currency }),
      [currency],
    );
    const selectedRange = controlledRange ?? localRange;
    const config = useRef({ selectedRange, onDataError });
    config.current = { selectedRange, onDataError };
    const report = useCallback((value: unknown) => {
      const failure = value instanceof Error ? value : new Error('Could not update chart data.');
      setDataError(failure.message);
      config.current.onDataError?.(failure);
    }, []);
    const fitRange = useCallback(() => {
      const runtime = runtimeRef.current;
      const end = runtime?.engine.bars.at(-1)?.time;
      if (!runtime || end === undefined) return;
      runtime.chart.timeScale().setVisibleRange({
        from: timestamp(rangeStart(config.current.selectedRange, end)),
        to: timestamp(end),
      });
    }, []);
    const enqueue = useCallback(
      (bar: FinancialBar) => {
        const runtime = runtimeRef.current;
        if (!runtime) return;
        try {
          validateBar(bar);
          const last = runtime.engine.bars.at(-1);
          if (last && bar.time < last.time)
            throw new Error(
              'Older streaming candle received. Replace the data prop for historical corrections.',
            );
          runtime.pending.set(bar.time, { ...bar });
          if (runtime.frame) return;
          runtime.frame = requestAnimationFrame(() => {
            runtime.frame = 0;
            const updates = [...runtime.pending.values()].sort((a, b) => a.time - b.time);
            runtime.pending.clear();
            try {
              const initiallyEmpty = !runtime.engine.bars.length;
              for (const update of updates) applyBar(runtime, update);
              setLegend(runtime.engine.bars.at(-1));
              setHasBars(Boolean(runtime.engine.bars.length));
              setDataError('');
              if (initiallyEmpty) fitRange();
            } catch (failure) {
              report(failure);
            }
          });
        } catch (failure) {
          report(failure);
        }
      },
      [fitRange, report],
    );
    useImperativeHandle(ref, () => ({ update: enqueue, fitRange }), [enqueue, fitRange]);
    useEffect(() => {
      if (!container.current) return;
      const chart = createChart(container.current, {
        autoSize: true,
        layout: {
          background: { type: ColorType.Solid, color: '#ffffff' },
          textColor: '#7c8799',
          attributionLogo: true,
        },
        grid: { vertLines: { color: '#f2f4f8' }, horzLines: { color: '#edf0f5' } },
        rightPriceScale: { borderColor: '#edf0f5' },
        timeScale: {
          timeVisible: true,
          secondsVisible: false,
          borderColor: '#edf0f5',
          rightOffset: 3,
        },
      });
      const candles = chart.addSeries(CandlestickSeries, {
        upColor: '#329e7d',
        downColor: '#d06b75',
        wickUpColor: '#329e7d',
        wickDownColor: '#d06b75',
        borderVisible: false,
      });
      const line = chart.addSeries(LineSeries, { color: '#7365d8', lineWidth: 2, visible: false });
      const volume = chart.addSeries(
        HistogramSeries,
        { priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false },
        1,
      );
      chart.panes()[0]?.setStretchFactor(4);
      chart.panes()[1]?.setStretchFactor(1);
      const runtime: Runtime = {
        chart,
        candles,
        line,
        volume,
        extras: new Map(),
        engine: new IndicatorEngine(),
        pending: new Map(),
        frame: 0,
      };
      runtimeRef.current = runtime;
      let legendFrame = 0;
      const crosshair = (
        event: Parameters<Parameters<IChartApi['subscribeCrosshairMove']>[0]>[0],
      ) => {
        const time = typeof event.time === 'number' ? event.time : undefined;
        let bar = runtime.engine.bars.at(-1);
        if (time !== undefined) {
          let low = 0,
            high = runtime.engine.bars.length - 1;
          while (low <= high) {
            const middle = Math.floor((low + high) / 2);
            const candidate = runtime.engine.bars[middle]!;
            if (candidate.time === time) {
              bar = candidate;
              break;
            }
            if (candidate.time < time) low = middle + 1;
            else high = middle - 1;
          }
        }
        cancelAnimationFrame(legendFrame);
        legendFrame = requestAnimationFrame(() => setLegend(bar));
      };
      chart.subscribeCrosshairMove(crosshair);
      return () => {
        cancelAnimationFrame(runtime.frame);
        cancelAnimationFrame(legendFrame);
        chart.unsubscribeCrosshairMove(crosshair);
        chart.remove();
        runtimeRef.current = null;
      };
    }, []);
    useEffect(() => {
      const runtime = runtimeRef.current;
      if (!runtime) return;
      const priceFormat = {
        type: 'custom' as const,
        formatter: (value: number) => formatter.format(value),
        minMove: 0.01,
      };
      runtime.candles.applyOptions({ priceFormat });
      runtime.line.applyOptions({ priceFormat });
    }, [formatter]);
    useEffect(() => {
      const runtime = runtimeRef.current;
      if (!runtime) return;
      runtime.candles.applyOptions({ visible: chartType === 'candlestick' });
      runtime.line.applyOptions({ visible: chartType === 'line' });
    }, [chartType]);
    useEffect(() => {
      const runtime = runtimeRef.current;
      if (!runtime) return;
      cancelAnimationFrame(runtime.frame);
      runtime.frame = 0;
      runtime.pending.clear();
      try {
        const next = normalizeBars(data);
        const previous = runtime.engine.bars;
        const wasEmpty = !previous.length;
        const incremental =
          previous.length > 0 &&
          next.length >= previous.length &&
          next[previous.length - 1]?.time === previous.at(-1)?.time &&
          previous.slice(0, -1).every((bar, index) => sameBar(bar, next[index]!));
        if (incremental) {
          const start = previous.length - 1;
          for (let index = start; index < next.length; index++)
            if (!previous[index] || !sameBar(previous[index]!, next[index]!))
              applyBar(runtime, next[index]!);
        } else {
          runtime.engine.reset(next);
          populate(runtime);
        }
        setLegend(runtime.engine.bars.at(-1));
        setHasBars(Boolean(next.length));
        setDataError('');
        if (wasEmpty && next.length) fitRange();
      } catch (failure) {
        report(failure);
      }
      // Snapshot replacements and corrections are separate from the imperative tick path.
    }, [data, symbol, fitRange, report]);
    useEffect(() => {
      const runtime = runtimeRef.current;
      if (!runtime) return;
      for (const series of [...runtime.extras.values()].reverse())
        runtime.chart.removeSeries(series);
      runtime.extras.clear();
      const add = (key: string, color: string, pane = 0) => {
        const series = runtime.chart.addSeries(
          LineSeries,
          {
            color,
            lineWidth: 1,
            priceLineVisible: false,
            lastValueVisible: false,
            priceFormat:
              key === 'rsi'
                ? { type: 'custom', formatter: (value: number) => value.toFixed(1), minMove: 0.1 }
                : {
                    type: 'custom',
                    formatter: (value: number) => formatter.format(value),
                    minMove: 0.01,
                  },
          },
          pane,
        );
        runtime.extras.set(key, series);
      };
      if (indicators.includes('SMA')) add('sma', '#d6a44b');
      if (indicators.includes('EMA')) add('ema', '#7867d8');
      let pane = 2;
      if (indicators.includes('RSI')) {
        add('rsi', '#4d95b0', pane++);
        runtime.extras.get('rsi')!.createPriceLine({
          price: 70,
          color: '#d06b7580',
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: 'Overbought',
        });
        runtime.extras.get('rsi')!.createPriceLine({
          price: 30,
          color: '#329e7d80',
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: 'Oversold',
        });
      }
      if (indicators.includes('MACD')) {
        add('macd', '#7365d8', pane);
        add('signal', '#d6a44b', pane);
        runtime.extras.set(
          'histogram',
          runtime.chart.addSeries(
            HistogramSeries,
            { priceLineVisible: false, lastValueVisible: false },
            pane,
          ),
        );
      }
      for (const [key, series] of runtime.extras)
        series.setData(
          runtime.engine.points.map((point) =>
            pointData(point, key as keyof Omit<IndicatorPoint, 'time'>),
          ),
        );
      runtime.chart.panes().forEach((item, index) => item.setStretchFactor(index === 0 ? 4 : 1));
    }, [indicators, formatter]);
    useEffect(() => {
      fitRange(); /* Range changes intentionally reset the viewport; ticks do not. */
    }, [selectedRange, symbol, fitRange]);
    useEffect(() => {
      if (latestBar) enqueue(latestBar);
    }, [latestBar, enqueue]);
    const price = (value: number | undefined) =>
      value === undefined ? '—' : formatter.format(value);
    const paneCount = 1 + Number(indicators.includes('RSI')) + Number(indicators.includes('MACD'));
    return (
      <section className="financial-chart" aria-label={symbol + ' financial chart'}>
        <div className="financial-chart-header">
          <strong>{symbol}</strong>
          <span>{price(legend?.close)}</span>
          {onChartTypeChange && (
            <div className="financial-chart-toggle" aria-label="Price chart style">
              {(['candlestick', 'line'] as const).map((type) => (
                <button
                  type="button"
                  key={type}
                  aria-pressed={chartType === type}
                  onClick={() => onChartTypeChange(type)}
                >
                  {type === 'line' ? 'Line' : 'Candles'}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="financial-chart-toolbar">
          <div role="group" aria-label="Chart time range">
            {CHART_RANGES.map((value) => (
              <button
                type="button"
                key={value}
                aria-pressed={selectedRange === value}
                onClick={() => {
                  setLocalRange(value);
                  onRangeChange?.(value);
                }}
              >
                {value}
              </button>
            ))}
          </div>
          <div role="group" aria-label="Technical indicators">
            {(['SMA', 'EMA', 'RSI', 'MACD'] as const).map((value) => (
              <button
                type="button"
                key={value}
                aria-pressed={indicators.includes(value)}
                onClick={() =>
                  setIndicators((current) =>
                    current.includes(value)
                      ? current.filter((item) => item !== value)
                      : [...current, value],
                  )
                }
              >
                {value}
                {value === 'SMA' || value === 'EMA' ? ' 20' : ''}
              </button>
            ))}
          </div>
        </div>
        <div className="financial-chart-legend">
          <span>O {price(legend?.open)}</span>
          <span>H {price(legend?.high)}</span>
          <span>L {price(legend?.low)}</span>
          <span>C {price(legend?.close)}</span>
          <span>Volume {legend?.volume?.toLocaleString() ?? 'Unavailable'}</span>
        </div>
        <div
          className="financial-chart-stage"
          style={{ height: Math.max(220, height) + paneCount * 90 }}
        >
          <div ref={container} className="financial-chart-canvas" />
          {(loading || error || dataError || !hasBars) && (
            <div className="financial-chart-state" role={error || dataError ? 'alert' : 'status'}>
              {loading ? 'Loading chart…' : error || dataError || 'No price data for this range.'}
              {!loading && (error || dataError) && onRetry && (
                <button type="button" onClick={onRetry}>
                  Retry
                </button>
              )}
            </div>
          )}
        </div>
        <div className="financial-chart-footer">
          <span>
            {indicators
              .map((value) =>
                value === 'MACD'
                  ? 'MACD (12,26,9)'
                  : value === 'RSI'
                    ? 'RSI (14)'
                    : value + ' (20)',
              )
              .join(' · ') || 'Price and volume'}{' '}
            · Drag to pan, scroll to zoom
          </span>
          <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
            Charts by TradingView
          </a>
        </div>
      </section>
    );
  },
);
export const FinancialChart = memo(FinancialChartBase);
export type { FinancialBar, ChartRange, ChartIndicator } from './model.js';
