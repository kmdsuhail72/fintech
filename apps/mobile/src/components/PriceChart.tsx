import { useMemo, useState } from 'react';
import { PanResponder, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { colors, money } from '../theme/tokens';
import { Copy, EmptyState, Segmented } from './ui';
import type { Candle } from '../services/types';
import type { ChartRange } from '../config/chart';
import { prepareChartBars } from '../services/chartData';
export function PriceChart({
  data,
  symbol,
  currency = 'USD',
  range,
}: {
  data: Candle[];
  symbol: string;
  currency?: string;
  range?: ChartRange;
}) {
  const [width, setWidth] = useState(300);
  const [hover, setHover] = useState<number | null>(null);
  const [type, setType] = useState<'Line' | 'Candles'>('Line');
  const [average, setAverage] = useState<'SMA 20' | 'Off'>('SMA 20');
  const bars = useMemo(() => prepareChartBars(data, range), [data, range]);
  const chartWidth = Math.max(100, width - 65);
  const chartHeight = 170;
  const averageValues =
    average === 'SMA 20' ? bars.flatMap((bar) => (bar.sma === null ? [] : [bar.sma])) : [];
  const minimum = Math.min(...bars.map((bar) => Number(bar.low)), ...averageValues);
  const maximum = Math.max(...bars.map((bar) => Number(bar.high)), ...averageValues);
  const spread = maximum - minimum || 1;
  const x = (index: number) => 10 + (index / Math.max(1, bars.length - 1)) * chartWidth;
  const y = (value: number) => 14 + ((maximum - value) / spread) * chartHeight;
  const selected = bars[hover === null ? bars.length - 1 : Math.min(hover, bars.length - 1)];
  const averages = useMemo(
    () => bars.flatMap((bar, index) => (bar.sma === null ? [] : [{ index, value: bar.sma }])),
    [bars],
  );
  const responder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > Math.abs(gesture.dy),
    onPanResponderGrant: (event) =>
      setHover(
        Math.max(
          0,
          Math.min(
            bars.length - 1,
            Math.round(((event.nativeEvent.locationX - 10) / chartWidth) * (bars.length - 1)),
          ),
        ),
      ),
    onPanResponderMove: (event) =>
      setHover(
        Math.max(
          0,
          Math.min(
            bars.length - 1,
            Math.round(((event.nativeEvent.locationX - 10) / chartWidth) * (bars.length - 1)),
          ),
        ),
      ),
    onPanResponderRelease: () => setHover(null),
    onPanResponderTerminate: () => setHover(null),
  });
  const maximumVolume = Math.max(1, ...bars.map((bar) => Number(bar.volume ?? 0)));
  return (
    <View style={{ gap: 12 }} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      <Segmented options={['Line', 'Candles'] as const} value={type} onChange={setType} />
      <Segmented options={['SMA 20', 'Off'] as const} value={average} onChange={setAverage} />
      {!bars.length ? (
        <EmptyState text="No recorded prices in this time range." />
      ) : (
        <>
          <Copy>
            {selected ? new Date(selected.timestamp).toLocaleString() : ''} ·{' '}
            {money(selected?.close, currency)}
          </Copy>
          <View
            {...responder.panHandlers}
            accessible
            accessibilityLabel={
              symbol + ' interactive price chart. Drag horizontally to inspect recorded prices.'
            }
          >
            <Svg width={width} height={260}>
              {[0, 1, 2, 3, 4].map((tick) => (
                <Line
                  key={tick}
                  x1={0}
                  x2={chartWidth + 10}
                  y1={14 + (tick * chartHeight) / 4}
                  y2={14 + (tick * chartHeight) / 4}
                  stroke={colors.border}
                />
              ))}
              {[0, 2, 4].map((tick) => (
                <SvgText
                  key={tick}
                  x={chartWidth + 16}
                  y={18 + (tick * chartHeight) / 4}
                  fill={colors.muted}
                  fontSize={9}
                >
                  {Number(maximum - (spread * tick) / 4).toFixed(2)}
                </SvgText>
              ))}
              {type === 'Line' ? (
                <Path
                  d={bars
                    .map(
                      (bar, index) => (index ? 'L' : 'M') + x(index) + ' ' + y(Number(bar.close)),
                    )
                    .join(' ')}
                  fill="none"
                  stroke={colors.accent}
                  strokeWidth={2}
                />
              ) : (
                bars.map((bar, index) => (
                  <ViewCandle
                    key={bar.timestamp}
                    x={x(index)}
                    high={y(Number(bar.high))}
                    low={y(Number(bar.low))}
                    open={y(Number(bar.open))}
                    close={y(Number(bar.close))}
                    width={Math.max(1, Math.min(8, (chartWidth / bars.length) * 0.6))}
                  />
                ))
              )}
              {average === 'SMA 20' && averages.length > 0 && (
                <Path
                  d={averages
                    .map(
                      (point, index) => (index ? 'L' : 'M') + x(point.index) + ' ' + y(point.value),
                    )
                    .join(' ')}
                  fill="none"
                  stroke={colors.warning}
                  strokeWidth={1.5}
                />
              )}
              {hover !== null && selected && (
                <>
                  <Line
                    x1={x(Math.min(hover, bars.length - 1))}
                    x2={x(Math.min(hover, bars.length - 1))}
                    y1={0}
                    y2={205}
                    stroke={colors.muted}
                    strokeDasharray="4 4"
                  />
                  <Circle
                    cx={x(Math.min(hover, bars.length - 1))}
                    cy={y(Number(selected.close))}
                    r={4}
                    fill={colors.accent}
                  />
                </>
              )}
              {bars.map((bar, index) =>
                bar.volume === null ? null : (
                  <Rect
                    key={bar.timestamp}
                    x={x(index)}
                    y={244 - (Number(bar.volume) / maximumVolume) * 32}
                    width={Math.max(1, (chartWidth / bars.length) * 0.7)}
                    height={(Number(bar.volume) / maximumVolume) * 32}
                    fill={Number(bar.close) >= Number(bar.open) ? colors.positive : colors.negative}
                    opacity={0.55}
                  />
                ),
              )}
              <SvgText x={10} y={258} fill={colors.muted} fontSize={9}>
                Volume · stored samples
              </SvgText>
            </Svg>
          </View>
          <Copy>
            O {money(selected?.open, currency)} · H {money(selected?.high, currency)} · L{' '}
            {money(selected?.low, currency)} · C {money(selected?.close, currency)}
          </Copy>
          <Copy>
            {average === 'SMA 20' && averages.length < 1
              ? 'SMA needs at least 20 recorded bars. '
              : ''}
            Drag to inspect · grouped samples preserve the selected history
          </Copy>
        </>
      )}
    </View>
  );
}
function ViewCandle({
  x,
  high,
  low,
  open,
  close,
  width,
}: {
  x: number;
  high: number;
  low: number;
  open: number;
  close: number;
  width: number;
}) {
  const color = close <= open ? colors.positive : colors.negative;
  return (
    <>
      <Line x1={x} x2={x} y1={high} y2={low} stroke={color} />
      <Rect
        x={x - width / 2}
        y={Math.min(open, close)}
        width={width}
        height={Math.max(1.5, Math.abs(close - open))}
        fill={color}
      />
    </>
  );
}
