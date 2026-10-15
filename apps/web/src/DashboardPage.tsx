import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CircleHelp,
  Clock3,
  MoreHorizontal,
  Plus,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Link } from 'react-router-dom';
import { formatCurrency } from '@asteriq/utils';

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api/v1';

const performance = [
  { day: 'Sep 11', value: 96_420 },
  { day: 'Sep 13', value: 97_180 },
  { day: 'Sep 15', value: 96_830 },
  { day: 'Sep 17', value: 98_440 },
  { day: 'Sep 19', value: 99_020 },
  { day: 'Sep 21', value: 98_560 },
  { day: 'Sep 23', value: 100_210 },
  { day: 'Sep 25', value: 99_870 },
  { day: 'Sep 27', value: 101_080 },
  { day: 'Sep 29', value: 100_540 },
  { day: 'Oct 01', value: 102_340 },
  { day: 'Oct 03', value: 101_920 },
  { day: 'Oct 05', value: 103_610 },
  { day: 'Oct 07', value: 104_284 },
];

const movers = [
  {
    symbol: 'NVDA',
    name: 'NVIDIA Corporation',
    price: 182.46,
    change: 3.84,
    tone: 'up',
    color: '#7c6cf2',
  },
  { symbol: 'AAPL', name: 'Apple Inc.', price: 256.38, change: 1.26, tone: 'up', color: '#48a898' },
  {
    symbol: 'MSFT',
    name: 'Microsoft Corp.',
    price: 521.74,
    change: 0.82,
    tone: 'up',
    color: '#5a8fee',
  },
  {
    symbol: 'TSLA',
    name: 'Tesla, Inc.',
    price: 391.02,
    change: -1.38,
    tone: 'down',
    color: '#e69b61',
  },
];

const watchlist = [
  { symbol: 'AAPL', name: 'Apple Inc.', price: 256.38, change: 1.26, color: '#4f8e86' },
  { symbol: 'NVDA', name: 'NVIDIA Corporation', price: 182.46, change: 3.84, color: '#7c6cf2' },
  { symbol: 'TSLA', name: 'Tesla, Inc.', price: 391.02, change: -1.38, color: '#d78354' },
  { symbol: 'AMZN', name: 'Amazon.com, Inc.', price: 224.91, change: 0.56, color: '#6896d3' },
];

const allocation = [
  { name: 'US equities', value: 52, color: '#786bf0' },
  { name: 'ETFs', value: 26, color: '#50a999' },
  { name: 'Technology', value: 14, color: '#e8ad61' },
  { name: 'Cash', value: 8, color: '#dbe1e9' },
];

const recentTrades = [
  { symbol: 'AAPL', side: 'BUY', quantity: '10 shares', time: 'Today, 10:42 AM', price: 252.14 },
  { symbol: 'NVDA', side: 'BUY', quantity: '8 shares', time: 'Yesterday, 2:18 PM', price: 178.92 },
  { symbol: 'TSLA', side: 'SELL', quantity: '4 shares', time: 'Oct 05, 11:06 AM', price: 396.8 },
];

function formatCompact(value: number) {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
    style: 'currency',
    currency: 'USD',
  }).format(value);
}

function HealthIndicator() {
  const health = useQuery({
    queryKey: ['api-health'],
    queryFn: async () => {
      const response = await fetch(`${apiUrl}/health`);
      if (!response.ok) throw new Error('API unavailable');
      return response.json() as Promise<{ ok: boolean }>;
    },
    retry: 1,
    refetchInterval: 30_000,
  });

  return (
    <span className={`data-status ${health.isSuccess ? 'connected' : 'simulated'}`}>
      <span className="status-dot" />
      {health.isSuccess ? 'Market simulation active' : 'Simulated market data'}
    </span>
  );
}

function PerformanceTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
}) {
  if (!active || !payload?.[0]) return null;
  return (
    <div className="chart-tooltip">
      <span>{label}</span>
      <strong>{formatCurrency(payload[0].value, 'USD')}</strong>
    </div>
  );
}

export default function DashboardPage() {
  const [range, setRange] = useState('1M');
  const chartData = useMemo(
    () =>
      range === '1W'
        ? performance.slice(-5)
        : range === '1Y'
          ? [...performance, ...performance.slice(1, 4)]
          : performance,
    [range],
  );

  return (
    <div className="dashboard-page">
      <div className="page-heading dashboard-heading">
        <div>
          <div className="eyebrow">
            WEDNESDAY, OCTOBER 7, 2026 <span className="eyebrow-separator">/</span> PAPER ACCOUNT
          </div>
          <h1>
            Good morning, Jordan <span className="heading-wave">✳</span>
          </h1>
          <p>Here’s what’s happening with your portfolio today.</p>
        </div>
        <div className="heading-actions">
          <HealthIndicator />
          <Link to="/trading" className="button button-primary">
            <Plus size={17} /> New trade
          </Link>
        </div>
      </div>

      <section className="metric-grid" aria-label="Portfolio summary">
        <article className="metric-card balance-card">
          <div className="metric-label">
            TOTAL PORTFOLIO VALUE <CircleHelp size={14} />
          </div>
          <div className="metric-value">
            $104,284<span className="metric-cents">.62</span>
          </div>
          <div className="metric-foot">
            <span className="positive-change">
              <ArrowUpRight size={15} /> $1,284.62 <small>(1.25%)</small>
            </span>
            <span className="metric-period">all time</span>
          </div>
          <div className="balance-sparkline" aria-hidden="true">
            <svg viewBox="0 0 200 44" preserveAspectRatio="none">
              <path d="M0 34 C15 31 17 38 29 30 S47 28 58 31 S73 17 87 23 S104 11 117 21 S132 15 143 18 S160 8 171 12 S187 2 200 5" />
            </svg>
          </div>
        </article>
        <article className="metric-card">
          <div className="metric-label">
            TODAY’S RETURN{' '}
            <span className="metric-icon positive">
              <TrendingUp size={16} />
            </span>
          </div>
          <div className="metric-value">
            $842<span className="metric-cents">.18</span>
          </div>
          <div className="metric-foot">
            <span className="positive-change">
              <ArrowUpRight size={15} /> 0.82%
            </span>
            <span className="metric-period">vs. previous close</span>
          </div>
        </article>
        <article className="metric-card">
          <div className="metric-label">
            INVESTED CAPITAL{' '}
            <span className="metric-icon">
              <Activity size={16} />
            </span>
          </div>
          <div className="metric-value">
            $78,450<span className="metric-cents">.00</span>
          </div>
          <div className="metric-foot">
            <span className="metric-subtle">75.2% of portfolio</span>
            <span className="metric-period">12 positions</span>
          </div>
        </article>
        <article className="metric-card">
          <div className="metric-label">
            AVAILABLE CASH{' '}
            <span className="metric-icon">
              <span className="wallet-icon-glyph">$</span>
            </span>
          </div>
          <div className="metric-value">
            $25,834<span className="metric-cents">.62</span>
          </div>
          <div className="metric-foot">
            <span className="metric-subtle">Ready to invest</span>
            <Link to="/trading" className="text-link">
              Trade now <ArrowRight size={13} />
            </Link>
          </div>
        </article>
      </section>

      <section className="dashboard-main-grid">
        <article className="panel performance-panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">
                Portfolio performance{' '}
                <button
                  className="help-icon"
                  aria-label="About portfolio performance"
                  type="button"
                >
                  <CircleHelp size={14} />
                </button>
              </div>
              <div className="panel-subtitle">Your portfolio value over time</div>
            </div>
            <div className="range-tabs" role="tablist" aria-label="Chart range">
              {['1W', '1M', '3M', '1Y', 'ALL'].map((item) => (
                <button
                  key={item}
                  type="button"
                  role="tab"
                  aria-selected={range === item}
                  className={range === item ? 'selected' : ''}
                  onClick={() => setRange(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
          <div className="performance-callout">
            <strong>$104,284.62</strong>
            <span className="positive-change">
              <ArrowUpRight size={15} /> +$4,284.62 (4.28%)
            </span>
          </div>
          <div className="portfolio-chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 6, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="portfolioFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6e63e8" stopOpacity={0.17} />
                    <stop offset="95%" stopColor="#6e63e8" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="#edf0f5" strokeDasharray="3 5" />
                <XAxis
                  dataKey="day"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#97a0b0', fontSize: 11 }}
                  tickMargin={13}
                  minTickGap={28}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#97a0b0', fontSize: 11 }}
                  tickFormatter={formatCompact}
                  width={52}
                  domain={['dataMin - 2500', 'dataMax + 1500']}
                />
                <Tooltip
                  content={<PerformanceTooltip />}
                  cursor={{ stroke: '#a5a0ef', strokeDasharray: '4 4' }}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#7469e8"
                  strokeWidth={2.4}
                  fill="url(#portfolioFill)"
                  activeDot={{ r: 5, strokeWidth: 3, stroke: '#fff', fill: '#7469e8' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="chart-footer">
            <span>
              <span className="chart-legend-dot" /> Portfolio value
            </span>
            <span>
              <Clock3 size={13} /> Updated just now
            </span>
          </div>
        </article>

        <article className="panel allocation-panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Asset allocation</div>
              <div className="panel-subtitle">By market value</div>
            </div>
            <Link to="/portfolio" className="panel-more" aria-label="View portfolio">
              <MoreHorizontal size={19} />
            </Link>
          </div>
          <div className="allocation-visual">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={allocation}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={65}
                  outerRadius={89}
                  paddingAngle={4}
                  stroke="none"
                  startAngle={90}
                  endAngle={-270}
                >
                  {allocation.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => `${value}%`} />
              </PieChart>
            </ResponsiveContainer>
            <div className="donut-center">
              <strong>$78.4k</strong>
              <span>invested</span>
            </div>
          </div>
          <div className="allocation-legend">
            {allocation.map((item) => (
              <div className="allocation-row" key={item.name}>
                <span className="legend-name">
                  <i style={{ backgroundColor: item.color }} />
                  {item.name}
                </span>
                <strong>{item.value}%</strong>
              </div>
            ))}
          </div>
          <Link to="/portfolio" className="panel-bottom-link">
            View breakdown <ArrowRight size={14} />
          </Link>
        </article>
      </section>

      <section className="dashboard-lower-grid">
        <article className="panel markets-panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">
                Market overview{' '}
                <span className="live-label">
                  <i /> LIVE
                </span>
              </div>
              <div className="panel-subtitle">Today’s top names in your market</div>
            </div>
            <Link to="/markets" className="panel-bottom-link compact">
              Explore markets <ArrowRight size={14} />
            </Link>
          </div>
          <div className="market-list">
            {movers.map((asset) => (
              <Link className="market-row" to={`/markets/${asset.symbol}`} key={asset.symbol}>
                <span
                  className="asset-logo"
                  style={{ '--asset-color': asset.color } as CSSProperties}
                >
                  {asset.symbol.slice(0, 1)}
                </span>
                <span className="asset-main">
                  <strong>{asset.symbol}</strong>
                  <small>{asset.name}</small>
                </span>
                <span className="market-price">
                  {formatCurrency(asset.price, 'USD')}
                  <small className={asset.tone}>
                    {asset.change > 0 ? '+' : ''}
                    {asset.change.toFixed(2)}%
                  </small>
                </span>
                <MiniTrend positive={asset.change > 0} />
              </Link>
            ))}
          </div>
        </article>

        <article className="panel watchlist-panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">
                Your watchlist <span className="count-chip">8</span>
              </div>
              <div className="panel-subtitle">Keep an eye on your favorites</div>
            </div>
            <Link to="/watchlist" className="panel-more" aria-label="View watchlist">
              <MoreHorizontal size={19} />
            </Link>
          </div>
          <div className="watchlist-items">
            {watchlist.map((asset) => (
              <Link className="watch-item" to={`/markets/${asset.symbol}`} key={asset.symbol}>
                <span
                  className="asset-logo small-logo"
                  style={{ '--asset-color': asset.color } as CSSProperties}
                >
                  {asset.symbol.slice(0, 1)}
                </span>
                <span className="asset-main">
                  <strong>{asset.symbol}</strong>
                  <small>{asset.name}</small>
                </span>
                <MiniTrend positive={asset.change > 0} />
                <span className="watch-price">
                  {formatCurrency(asset.price, 'USD')}
                  <small className={asset.change > 0 ? 'up' : 'down'}>
                    {asset.change > 0 ? '+' : ''}
                    {asset.change.toFixed(2)}%
                  </small>
                </span>
              </Link>
            ))}
          </div>
          <Link to="/watchlist" className="panel-bottom-link">
            Open watchlist <ArrowRight size={14} />
          </Link>
        </article>

        <article className="panel trades-panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Recent trades</div>
              <div className="panel-subtitle">Your latest paper executions</div>
            </div>
            <Link to="/transactions" className="panel-bottom-link compact">
              View all <ArrowRight size={14} />
            </Link>
          </div>
          <div className="trade-list">
            {recentTrades.map((trade) => (
              <div className="trade-row" key={`${trade.symbol}-${trade.time}`}>
                <span className={`trade-side ${trade.side.toLowerCase()}`}>
                  {trade.side === 'BUY' ? <ArrowDownRight size={16} /> : <ArrowUpRight size={16} />}
                </span>
                <span className="trade-info">
                  <strong>
                    {trade.side} {trade.symbol}
                  </strong>
                  <small>
                    {trade.quantity} <span>·</span> {trade.time}
                  </small>
                </span>
                <strong className="trade-amount">{formatCurrency(trade.price, 'USD')}</strong>
              </div>
            ))}
          </div>
        </article>

        <article className="ai-insight-card">
          <div className="ai-card-top">
            <span className="ai-icon">
              <Sparkles size={17} />
            </span>
            <span className="ai-label">ASTERIQ INTELLIGENCE</span>
            <span className="ai-badge">AI INSIGHT</span>
          </div>
          <h2>Tech leads the session as megacaps find momentum.</h2>
          <p>
            Technology is contributing 38% of your portfolio’s daily gains. NVIDIA and Apple are
            outperforming the broader market today, while Tesla is showing short-term weakness.
          </p>
          <div className="insight-tags">
            <span>Market pulse</span>
            <span>Portfolio aware</span>
          </div>
          <Link to="/research" className="ai-read-more">
            Explore AI research <ArrowRight size={14} />
          </Link>
        </article>
      </section>
      <div className="dashboard-disclaimer">
        <Activity size={13} /> Prices and portfolio data shown are simulated for educational use.
      </div>
    </div>
  );
}

function MiniTrend({ positive }: { positive: boolean }) {
  const path = positive
    ? 'M1 17 C9 15 10 12 17 14 S25 8 31 10 S38 3 46 4'
    : 'M1 4 C8 2 10 7 17 6 S26 12 31 10 S40 15 46 17';
  return (
    <svg
      className={`mini-trend-svg ${positive ? 'up' : 'down'}`}
      viewBox="0 0 48 22"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}
