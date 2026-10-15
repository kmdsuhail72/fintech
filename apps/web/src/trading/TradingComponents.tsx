import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  CircleAlert,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  WalletCards,
  X,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AssetAvatar } from '../MarketUI.js';
import { fmt, instruments } from '../marketData.js';
import { calculateRsi } from './indicators.js';
import { getAccessToken } from '../authToken.js';
export type TradingInstrument = {
  id?: string;
  symbol: string;
  company_name?: string;
  exchange_code?: string;
  quote_currency?: string;
};

export type TradingQuote = {
  symbol: string;
  currency?: string;
  price: string | number;
  changePercent?: string | number;
  change?: string | number;
  timestamp?: string;
  quoteStatus?: string;
};

export type TradingCandleResponse = {
  interval: string;
  source: string;
  candles: Array<{
    timestamp: string;
    open: string;
    high: string;
    low: string;
    close: string;
    samples: number;
    volume?: string | null;
  }>;
};
export type TradingWatchlistData = {
  id: string;
  name: string;
  items: Array<{ symbolId: string; symbol: string; companyName: string }>;
};
export type TradingPortfolio = {
  portfolio_id: string;
  base_currency: string;
  cash_balance: string;
  positions: Array<{
    symbol: string;
    quantity: string;
  }>;
};

export type TradingOrder = {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  status: string;
  quantity: string;
  filled_quantity: string;
  average_fill_price: string | null;
  submitted_at: string;
};

export type TradingFill = {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: string;
  price: string;
  currency: string;
  executed_at: string;
};

export type TradingCandle = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

export function LoadingState({ label = 'Loading market data…' }: { label?: string }) {
  return (
    <div className="trading-state">
      <LoaderCircle size={16} className="spin" />
      <span>{label}</span>
    </div>
  );
}

export function TradingError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="trading-error" role="alert">
      <CircleAlert size={15} />
      <span>{message}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} aria-label="Retry loading data">
          <RefreshCw size={13} /> Retry
        </button>
      )}
    </div>
  );
}

export function TradingWatchlist({
  instruments: items,
  quotes,
  selected,
  onSelect,
  loading,
  error,
  watchlists,
  watchlistId,
  onWatchlistChange,
  onRetry,
  authenticated,
  onToggleSymbol,
  saving,
  canSave,
}: {
  watchlists: TradingWatchlistData[];
  watchlistId: string;
  onWatchlistChange: (id: string) => void;
  onRetry: () => void;
  authenticated: boolean;
  onToggleSymbol: () => void;
  saving: boolean;
  canSave: boolean;
  instruments: TradingInstrument[];
  quotes: TradingQuote[];
  selected: string;
  onSelect: (symbol: string) => void;
  loading: boolean;
  error?: string | undefined;
}) {
  const [filter, setFilter] = useState('');
  const bySymbol = new Map(quotes.map((quote) => [quote.symbol, quote]));
  const filteredItems = items.filter((item) =>
    `${item.symbol} ${item.company_name ?? ''}`.toLowerCase().includes(filter.toLowerCase()),
  );
  return (
    <section className="panel trading-watchlist">
      <div className="trading-panel-heading">
        <div>
          <span className="eyebrow">YOUR MARKETS</span>
          <h2>Watchlist</h2>
        </div>
        <span className="watchlist-count">{items.length} assets</span>
      </div>
      {watchlists.length > 0 && (
        <label className="trading-watchlist-picker">
          <span>Saved watchlist</span>
          <select
            aria-label="Saved watchlist"
            value={watchlistId}
            onChange={(event) => onWatchlistChange(event.target.value)}
          >
            {watchlists.map((list) => (
              <option key={list.id} value={list.id}>
                {list.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {authenticated && (
        <button
          className="button button-secondary watchlist-save-symbol"
          type="button"
          disabled={!canSave || saving}
          onClick={onToggleSymbol}
        >
          {saving
            ? 'Saving…'
            : items.some((item) => item.symbol === selected)
              ? `Remove ${selected}`
              : `Add ${selected}`}
        </button>
      )}
      <label className="trading-watchlist-search">
        <Search size={14} />
        <input
          aria-label="Filter watchlist"
          placeholder="Filter symbols"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      </label>
      {loading && <LoadingState label="Refreshing quotes…" />}
      {error && <TradingError message={error} onRetry={onRetry} />}
      <div className="trading-watchlist-items">
        {filteredItems.map((item) => {
          const fallback = authenticated
            ? undefined
            : instruments.find((entry) => entry.symbol === item.symbol);
          const quote = bySymbol.get(item.symbol);
          const price = Number(quote?.price ?? fallback?.price ?? 0);
          const change = Number(quote?.changePercent ?? fallback?.change ?? 0);
          return (
            <button
              className={`trading-watch-row${selected === item.symbol ? ' selected' : ''}`}
              key={item.symbol}
              type="button"
              aria-pressed={selected === item.symbol}
              onClick={() => onSelect(item.symbol)}
            >
              <AssetAvatar symbol={item.symbol} small />
              <span className="trading-watch-name">
                <strong>{item.symbol}</strong>
                <small>{item.company_name ?? fallback?.name ?? item.symbol}</small>
              </span>
              <span className="trading-watch-price">
                <strong>{price ? fmt(price) : '—'}</strong>
                <small className={change >= 0 ? 'positive' : 'negative'}>
                  {change >= 0 ? '+' : ''}
                  {change.toFixed(2)}%
                </small>
              </span>
            </button>
          );
        })}
      </div>
      {!filteredItems.length && !loading && (
        <p className="trading-empty">
          {filter
            ? 'No symbols match your search.'
            : authenticated
              ? 'Your watchlist is empty. Save the selected symbol using the button above.'
              : 'No market symbols are available.'}
        </p>
      )}
      <div className="trading-watchlist-foot">
        <span className="status-dot" />{' '}
        {authenticated
          ? 'Your saved symbols · simulated quotes'
          : 'Market preview · sign in for your watchlist'}
      </div>
    </section>
  );
}

export function TradingChart({
  candles,
  symbol,
  loading,
  interval,
  onIntervalChange,
  chartType,
  onChartTypeChange,
  error,
  onRetry,
}: {
  error?: string | undefined;
  onRetry: () => void;
  candles: TradingCandle[];
  symbol: string;
  loading: boolean;
  interval: string;
  onIntervalChange: (interval: string) => void;
  chartType: 'CANDLE' | 'LINE';
  onChartTypeChange: (type: 'CANDLE' | 'LINE') => void;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [showSma, setShowSma] = useState(true);
  const visibleCandles = candles;
  const close = visibleCandles.at(-1)?.close ?? 0;
  const firstClose = visibleCandles[0]?.open ?? close;
  const changePercent = firstClose ? ((close - firstClose) / firstClose) * 100 : 0;
  const activeCandle = hovered === null ? visibleCandles.at(-1) : visibleCandles[hovered];
  const min = Math.min(...visibleCandles.map((candle) => candle.low));
  const max = Math.max(...visibleCandles.map((candle) => candle.high));
  const spread = max - min || 1;
  const sma =
    visibleCandles.slice(-20).reduce((sum, candle) => sum + candle.close, 0) /
    Math.max(visibleCandles.slice(-20).length, 1);
  const rsi = calculateRsi(visibleCandles);
  const points = visibleCandles.map((candle, index) => ({
    ...candle,
    index,
    sma:
      candles
        .slice(Math.max(0, candles.indexOf(candle) - 19), candles.indexOf(candle) + 1)
        .reduce((sum, item) => sum + item.close, 0) / Math.min(20, candles.indexOf(candle) + 1),
    x: 12 + (index / Math.max(visibleCandles.length - 1, 1)) * 976,
    highY: 14 + ((max - candle.high) / spread) * 184,
    lowY: 14 + ((max - candle.low) / spread) * 184,
    openY: 14 + ((max - candle.open) / spread) * 184,
    closeY: 14 + ((max - candle.close) / spread) * 184,
  }));

  return (
    <section className="panel trading-chart-panel">
      <div className="trading-chart-title">
        <div>
          <div className="trading-symbol-heading">
            <AssetAvatar symbol={symbol} />
            <div>
              <h2>
                {symbol} <span>· USD</span>
              </h2>
              <small>Simulated prices · OHLC from stored samples</small>
            </div>
          </div>
          {activeCandle && (
            <div className="chart-ohlc">
              <span>{activeCandle.time}</span>
              <span>
                O <b>{fmt(activeCandle.open)}</b>
              </span>
              <span>
                H <b>{fmt(activeCandle.high)}</b>
              </span>
              <span>
                L <b>{fmt(activeCandle.low)}</b>
              </span>
              <span>
                C <b>{fmt(activeCandle.close)}</b>
              </span>
            </div>
          )}
        </div>
        <div className="trading-chart-controls">
          <div className="chart-type-tabs" role="group" aria-label="Chart style">
            <button
              aria-pressed={chartType === 'CANDLE'}
              className={chartType === 'CANDLE' ? 'active' : ''}
              type="button"
              onClick={() => onChartTypeChange('CANDLE')}
              aria-label="Candlestick chart"
            >
              <BarChart3 size={15} />
            </button>
            <button
              aria-pressed={chartType === 'LINE'}
              className={chartType === 'LINE' ? 'active' : ''}
              type="button"
              onClick={() => onChartTypeChange('LINE')}
              aria-label="Line chart"
            >
              <Activity size={15} />
            </button>
          </div>
          <button
            className="chart-tool-button"
            type="button"
            aria-label="Toggle 20-period moving average"
            aria-pressed={showSma}
            onClick={() => setShowSma(!showSma)}
          >
            <SlidersHorizontal size={15} />
          </button>
        </div>
      </div>
      <div className="chart-market-price">
        <strong>{candles.length ? fmt(close) : '—'}</strong>
        <span className={changePercent >= 0 ? 'positive' : 'negative'}>
          {changePercent >= 0 ? '+' : ''}
          {changePercent.toFixed(2)}% <small>selected range</small>
        </span>
      </div>
      <div className="trading-chart-range">
        {['1m', '5m', '15m', '1h', '1d'].map((value) => (
          <button
            className={interval === value ? 'selected' : ''}
            key={value}
            type="button"
            aria-pressed={interval === value}
            onClick={() => {
              setHovered(null);
              onIntervalChange(value);
            }}
          >
            {value}
          </button>
        ))}
      </div>
      <div className="trading-chart-canvas">
        {loading && <LoadingState label="Loading price candles…" />}
        {error && <TradingError message={error} onRetry={onRetry} />}
        {!loading && !error && !candles.length && (
          <p className="trading-empty">
            No recorded prices in this interval yet. Try a longer interval.
          </p>
        )}
        {!loading &&
          !error &&
          candles.length > 0 &&
          (chartType === 'LINE' ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={points} margin={{ top: 12, right: 12, bottom: 4, left: 2 }}>
                <defs>
                  <linearGradient id="tradeLineFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6d63d9" stopOpacity={0.18} />
                    <stop offset="95%" stopColor="#6d63d9" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#f0f1f5" vertical={false} />
                <XAxis dataKey="time" tickLine={false} axisLine={false} minTickGap={25} />
                <YAxis
                  orientation="right"
                  domain={['dataMin - 1', 'dataMax + 1']}
                  tickLine={false}
                  axisLine={false}
                  width={55}
                  tickFormatter={(value: number) => `$${value.toFixed(0)}`}
                />
                <Tooltip formatter={(value) => fmt(Number(value))} />
                <Area
                  type="monotone"
                  dataKey="close"
                  stroke="#6c61d5"
                  strokeWidth={2}
                  fill="url(#tradeLineFill)"
                  dot={false}
                  activeDot={{ r: 4 }}
                />
                {showSma && (
                  <Area
                    type="monotone"
                    dataKey="sma"
                    name="SMA (20)"
                    stroke="#d4a665"
                    fill="none"
                    dot={false}
                    strokeWidth={1.5}
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <svg
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                  event.preventDefault();
                  setHovered(
                    Math.max(
                      0,
                      Math.min(
                        points.length - 1,
                        (hovered ?? points.length - 1) + (event.key === 'ArrowRight' ? 1 : -1),
                      ),
                    ),
                  );
                }
              }}
              className="candlestick-svg"
              viewBox="0 0 1080 250"
              preserveAspectRatio="none"
              role="img"
              aria-label={`${symbol} simulated candlestick price chart`}
              onMouseLeave={() => setHovered(null)}
            >
              {[30, 75, 120, 165, 205].map((y) => (
                <line key={y} x1="0" x2="1000" y1={y} y2={y} className="chart-grid-line" />
              ))}
              {[0, 1, 2, 3, 4].map((tick) => (
                <text key={tick} x="1008" y={18 + tick * 46} className="chart-axis-label">
                  {fmt(max - (spread * tick) / 4)}
                </text>
              ))}
              {points
                .filter((_, index) => index % Math.max(1, Math.floor(points.length / 5)) === 0)
                .map((point) => (
                  <text key={point.index} x={point.x} y="240" className="chart-axis-label">
                    {point.time}
                  </text>
                ))}
              {showSma && (
                <polyline
                  points={points
                    .map((point) => point.x + ',' + (14 + ((max - point.sma) / spread) * 184))
                    .join(' ')}
                  fill="none"
                  stroke="#d4a665"
                  strokeWidth="2"
                />
              )}
              {hovered !== null && points[hovered] && (
                <line
                  x1={points[hovered]!.x}
                  x2={points[hovered]!.x}
                  y1="0"
                  y2="210"
                  stroke="#a0a7b3"
                  strokeDasharray="4 4"
                />
              )}
              {points.map((point) => {
                const rising = point.close >= point.open;
                const bodyTop = Math.min(point.openY, point.closeY);
                const bodyHeight = Math.max(2, Math.abs(point.closeY - point.openY));
                return (
                  <g
                    key={`${point.time}-${point.index}`}
                    className="candlestick"
                    onMouseEnter={() => setHovered(point.index)}
                    onClick={() => setHovered(point.index)}
                  >
                    <line
                      x1={point.x}
                      x2={point.x}
                      y1={point.highY}
                      y2={point.lowY}
                      className={rising ? 'candle-wick up' : 'candle-wick down'}
                    />
                    <rect
                      x={point.x - 4}
                      y={bodyTop}
                      width="8"
                      height={bodyHeight}
                      rx="1"
                      className={rising ? 'candle-body up' : 'candle-body down'}
                    >
                      <title>{`${point.time}: O ${fmt(point.open)} H ${fmt(point.high)} L ${fmt(point.low)} C ${fmt(point.close)}`}</title>
                    </rect>
                  </g>
                );
              })}
            </svg>
          ))}
      </div>
      <div className="trading-indicators">
        <div>
          <span className="indicator-key sma" /> SMA (20){' '}
          <strong>{candles.length ? fmt(sma) : '—'}</strong>
        </div>
        <div>
          <span className="indicator-key rsi" /> RSI (14){' '}
          <strong>{candles.length > 1 ? rsi.toFixed(1) : '—'}</strong>
        </div>
        <div>
          <span className="indicator-key volume" /> Source <strong>Stored prices</strong>
        </div>
      </div>
    </section>
  );
}

export function OrderPanel({
  instrument,
  price,
  change,
  side,
  quantity,
  availableCash,
  availableShares,
  balanceLoading,
  isAuthenticated,
  submitting,
  onSideChange,
  onQuantityChange,
  onReview,
  validationError,
}: {
  instrument: TradingInstrument;
  price: number;
  change: number;
  side: 'BUY' | 'SELL';
  quantity: string;
  availableCash?: number | undefined;
  availableShares: number;
  balanceLoading: boolean;
  isAuthenticated: boolean;
  submitting: boolean;
  onSideChange: (side: 'BUY' | 'SELL') => void;
  onQuantityChange: (quantity: string) => void;
  onReview: () => void;
  validationError?: string | undefined;
}) {
  const amount = Number(quantity || 0) * price;
  const canTrade =
    isAuthenticated &&
    !!instrument.id &&
    Number.isFinite(price) &&
    price > 0 &&
    Number.isFinite(Number(quantity)) &&
    Number(quantity) > 0 &&
    !validationError &&
    !balanceLoading &&
    !submitting;
  return (
    <section className="panel trading-order-panel">
      <div className="trading-panel-heading">
        <div>
          <span className="eyebrow">PAPER EXECUTION</span>
          <h2>Order ticket</h2>
        </div>
        <span className="simulated-pill">MARKET</span>
      </div>
      <div className="order-side-toggle">
        <button
          className={side === 'BUY' ? 'buy-selected' : ''}
          type="button"
          onClick={() => onSideChange('BUY')}
        >
          Buy
        </button>
        <button
          className={side === 'SELL' ? 'sell-selected' : ''}
          type="button"
          onClick={() => onSideChange('SELL')}
        >
          Sell
        </button>
      </div>
      <div className="order-selected-symbol">
        <span>SYMBOL</span>
        <strong>{instrument.symbol}</strong>
        <small>{instrument.exchange_code ?? 'US market'}</small>
      </div>
      <label className="field-label" htmlFor="trading-quantity">
        Quantity
      </label>
      <div className="input-suffix trading-quantity">
        <input
          id="trading-quantity"
          type="number"
          min="0.00000001"
          step="any"
          inputMode="decimal"
          value={quantity}
          aria-invalid={Boolean(validationError)}
          aria-describedby={validationError ? 'quantity-error' : undefined}
          onChange={(event) => onQuantityChange(event.target.value)}
        />
        <span>shares</span>
      </div>
      {validationError && (
        <p id="quantity-error" className="trading-validation-error" role="alert">
          {validationError}
        </p>
      )}
      <div className="ticket-market-price">
        <span>Market price</span>
        <strong>{fmt(price)}</strong>
        <small className={change >= 0 ? 'positive' : 'negative'}>
          {change >= 0 ? '+' : ''}
          {change.toFixed(2)}%
        </small>
      </div>
      <div className="ticket-estimate">
        <span>Estimated trade value</span>
        <strong>{fmt(amount)}</strong>
      </div>
      <div className="ticket-funds">
        <WalletCards size={16} />
        <span>{side === 'BUY' ? 'Available balance' : `Available ${instrument.symbol}`}</span>
        {balanceLoading ? (
          <LoaderCircle size={14} className="spin" />
        ) : !isAuthenticated ? (
          <Link to="/login">Sign in</Link>
        ) : side === 'BUY' ? (
          <strong>{availableCash === undefined ? 'Unavailable' : fmt(availableCash)}</strong>
        ) : (
          <strong>
            {availableShares.toLocaleString('en-US', { maximumFractionDigits: 8 })} shares
          </strong>
        )}
      </div>
      <button
        className={`button order-submit ${side === 'SELL' ? 'sell-submit' : ''}`}
        disabled={!canTrade}
        type="button"
        onClick={onReview}
      >
        {submitting ? (
          <>
            <LoaderCircle size={15} className="spin" /> Submitting…
          </>
        ) : (
          `Review ${side.toLowerCase()} order`
        )}
        {!submitting && <ArrowRight size={15} />}
      </button>
      {!isAuthenticated && (
        <p className="order-auth-note">
          <LockKeyhole size={13} /> Sign in to place a paper trade.
        </p>
      )}
      {isAuthenticated && !instrument.id && (
        <p className="order-auth-note">
          <CircleAlert size={13} /> Symbol details are unavailable; refresh market data.
        </p>
      )}
      <div className="ticket-footnote">
        <ShieldCheck size={14} /> Paper trading only. No real money or brokerage orders.
      </div>
    </section>
  );
}

export function TradingActivity({
  tab,
  onTabChange,
  orders,
  trades,
  loading,
  error,
  onCancel,
  onRefresh,
  cancellingId,
}: {
  tab: 'OPEN' | 'ORDERS' | 'TRADES';
  onTabChange: (tab: 'OPEN' | 'ORDERS' | 'TRADES') => void;
  orders: TradingOrder[];
  trades: TradingFill[];
  loading: boolean;
  error?: string | undefined;
  onCancel: (orderId: string) => void;
  onRefresh: () => void;
  cancellingId?: string | undefined;
}) {
  const openOrders = orders.filter((order) =>
    ['PENDING', 'PARTIALLY_FILLED'].includes(order.status),
  );
  const shownOrders = tab === 'OPEN' ? openOrders : orders;
  return (
    <section className="panel trading-activity-panel">
      <div className="trading-activity-header">
        <div className="trading-activity-tabs" role="tablist" aria-label="Trading history">
          {(
            [
              ['OPEN', `Open orders${openOrders.length ? ` (${openOrders.length})` : ''}`],
              ['ORDERS', 'Order history'],
              ['TRADES', 'Trade history'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              className={tab === value ? 'selected' : ''}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => onTabChange(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <button className="activity-filter" type="button" onClick={onRefresh}>
          <RefreshCw size={13} /> Refresh
        </button>
      </div>
      {loading && <LoadingState label="Loading trading activity…" />}
      {error && <TradingError message={error} />}
      {!loading && !error && tab !== 'TRADES' && (
        <div className="trading-table-wrap">
          <table className="trading-activity-table">
            <thead>
              <tr>
                <th>SYMBOL</th>
                <th>SIDE</th>
                <th>QUANTITY</th>
                <th>FILL PRICE</th>
                <th>STATUS</th>
                <th>TIME</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shownOrders.map((order) => (
                <tr key={order.id}>
                  <td>
                    <strong>{order.symbol}</strong>
                  </td>
                  <td>
                    <span className={`activity-side ${order.side.toLowerCase()}`}>
                      {order.side}
                    </span>
                  </td>
                  <td>{Number(order.quantity).toLocaleString()}</td>
                  <td>{order.average_fill_price ? fmt(Number(order.average_fill_price)) : '—'}</td>
                  <td>
                    <span className={`order-status ${order.status.toLowerCase()}`}>
                      {order.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td>{new Date(order.submitted_at).toLocaleString()}</td>
                  <td>
                    {['PENDING', 'PARTIALLY_FILLED'].includes(order.status) && (
                      <button
                        type="button"
                        className="table-cancel-button"
                        disabled={Boolean(cancellingId)}
                        onClick={() => onCancel(order.id)}
                      >
                        {cancellingId === order.id ? 'Cancelling…' : 'Cancel'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!shownOrders.length && (
            <p className="trading-empty">No {tab === 'OPEN' ? 'open orders' : 'orders'} yet.</p>
          )}
        </div>
      )}
      {!loading && !error && tab === 'TRADES' && (
        <div className="trading-table-wrap">
          <table className="trading-activity-table">
            <thead>
              <tr>
                <th>SYMBOL</th>
                <th>SIDE</th>
                <th>QUANTITY</th>
                <th>PRICE</th>
                <th>VALUE</th>
                <th>EXECUTED</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((trade) => (
                <tr key={trade.id}>
                  <td>
                    <strong>{trade.symbol}</strong>
                  </td>
                  <td>
                    <span className={`activity-side ${trade.side.toLowerCase()}`}>
                      {trade.side}
                    </span>
                  </td>
                  <td>{Number(trade.quantity).toLocaleString()}</td>
                  <td>{fmt(Number(trade.price))}</td>
                  <td>{fmt(Number(trade.quantity) * Number(trade.price))}</td>
                  <td>{new Date(trade.executed_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!trades.length && <p className="trading-empty">No paper trades yet.</p>}
        </div>
      )}
      {!getAccessToken() && (
        <div className="trading-signin-strip">
          <LockKeyhole size={14} /> <span>Sign in to sync open orders and trade history.</span>
          <Link to="/login">
            Sign in <ArrowRight size={13} />
          </Link>
        </div>
      )}
    </section>
  );
}

export function ConfirmTradeModal({
  symbol,
  side,
  quantity,
  price,
  busy,
  onClose,
  onConfirm,
  error,
}: {
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
  error?: string | undefined;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      previousFocus?.focus();
    };
  }, []);
  return (
    <div
      className="trade-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <dialog
        ref={dialogRef}
        onCancel={(event) => {
          event.preventDefault();
          if (!busy) onClose();
        }}
        className="trade-confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-trade-title"
      >
        <button
          type="button"
          className="trade-modal-close"
          onClick={onClose}
          aria-label="Close confirmation"
          disabled={busy}
        >
          <X size={17} />
        </button>
        <div className={`trade-modal-icon ${side.toLowerCase()}`}>
          {side === 'BUY' ? <ArrowUpRight size={22} /> : <ArrowDownRight size={22} />}
        </div>
        <span className="eyebrow">PAPER ORDER REVIEW</span>
        <h2 id="confirm-trade-title">Confirm {side.toLowerCase()} order</h2>
        <p>
          This order uses virtual funds in your paper-trading account. It will not reach a broker.
        </p>
        <div className="trade-confirm-summary">
          <span>
            {symbol} · {quantity.toLocaleString()} shares
          </span>
          <strong>{fmt(quantity * price)}</strong>
          <small>
            Estimated market value · final fill uses the server's latest simulated quote
          </small>
        </div>
        {error && <TradingError message={error} />}
        <div className="trade-modal-actions">
          <button
            type="button"
            className="button button-secondary"
            onClick={onClose}
            disabled={busy}
          >
            Back
          </button>
          <button
            type="button"
            className={`button order-submit ${side === 'SELL' ? 'sell-submit' : ''}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? (
              <>
                <LoaderCircle size={15} className="spin" /> Sending…
              </>
            ) : (
              `Confirm ${side.toLowerCase()}`
            )}
          </button>
        </div>
      </dialog>
    </div>
  );
}
