import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Activity,
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Check,
  CircleHelp,
  ExternalLink,
  Filter,
  LockKeyhole,
  Mail,
  MoreHorizontal,
  Plus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  TrendingUp,
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
import { AssetAvatar, Change, PageTitle } from './MarketUI.js';
import { fmt, instruments } from './marketData.js';
export { TradingPage } from './trading/TradingPage.js';
import { setAccessToken } from './authToken.js';
import { runSessionChange } from './api.js';

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api/v1';
const stockHistory = [
  { time: '9:30', value: 249.2 },
  { time: '10:00', value: 250.8 },
  { time: '10:30', value: 249.9 },
  { time: '11:00', value: 252.4 },
  { time: '11:30', value: 251.6 },
  { time: '12:00', value: 253.8 },
  { time: '12:30', value: 252.9 },
  { time: '1:00', value: 254.1 },
  { time: '1:30', value: 253.6 },
  { time: '2:00', value: 255.4 },
  { time: '2:30', value: 254.8 },
  { time: '3:00', value: 256.38 },
];

const ownedPositions = [
  {
    symbol: 'AAPL',
    company: 'Apple Inc.',
    quantity: 42,
    average: 218.42,
    price: 256.38,
    value: 10_767.96,
    pnl: 1594.32,
    allocation: 25.6,
  },
  {
    symbol: 'NVDA',
    company: 'NVIDIA Corporation',
    quantity: 38,
    average: 142.16,
    price: 182.46,
    value: 6933.48,
    pnl: 1531.4,
    allocation: 16.5,
  },
  {
    symbol: 'MSFT',
    company: 'Microsoft Corporation',
    quantity: 12,
    average: 467.1,
    price: 521.74,
    value: 6260.88,
    pnl: 655.68,
    allocation: 14.9,
  },
  {
    symbol: 'SPY',
    company: 'SPDR S&P 500 ETF',
    quantity: 18,
    average: 642.25,
    price: 671.28,
    value: 12_083.04,
    pnl: 522.54,
    allocation: 28.8,
  },
  {
    symbol: 'AMZN',
    company: 'Amazon.com, Inc.',
    quantity: 20,
    average: 218.88,
    price: 224.91,
    value: 4498.2,
    pnl: 120.6,
    allocation: 10.7,
  },
  {
    symbol: 'TSLA',
    company: 'Tesla, Inc.',
    quantity: 10,
    average: 365.6,
    price: 391.02,
    value: 3910.2,
    pnl: 254.2,
    allocation: 9.3,
  },
];

const news = [
  {
    category: 'MARKETS',
    title: 'Investors weigh fresh inflation data as equities extend gains',
    source: 'Market Brief',
    time: '12 min ago',
    tone: 'violet',
  },
  {
    category: 'TECHNOLOGY',
    title: 'Chipmakers rally as data-center demand outlook improves',
    source: 'The Daily Ledger',
    time: '38 min ago',
    tone: 'blue',
  },
  {
    category: 'ECONOMY',
    title: 'Treasury yields hold steady ahead of central bank remarks',
    source: 'Global Finance',
    time: '1 hr ago',
    tone: 'green',
  },
];

function SectionHeader({
  title,
  note,
  action,
}: {
  title: string;
  note?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-header">
      <div>
        <h2>{title}</h2>
        {note && <p>{note}</p>}
      </div>
      {action}
    </div>
  );
}

function DataTable({
  headers,
  children,
  className = '',
}: {
  headers: string[];
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`table-scroll ${className}`}>
      <table className="data-table">
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function MarketsPage() {
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState(() => searchParams.get('q') ?? '');
  const filtered = instruments.filter((item) =>
    `${item.symbol} ${item.name} ${item.sector}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="workspace-page">
      <PageTitle
        eyebrow="DISCOVER"
        title="Explore markets"
        subtitle="Follow global equities and ETFs with simulated market data."
        action={
          <button className="button button-secondary">
            <SlidersHorizontal size={15} /> Filters
          </button>
        }
      />
      <div className="market-summary-strip">
        {(
          [
            ['S&P 500', '6,712.80', '+0.43%'],
            ['NASDAQ', '22,486.24', '+0.78%'],
            ['DOW JONES', '46,122.61', '+0.21%'],
            ['VIX', '17.42', '-2.16%'],
          ] as const
        ).map(([label, value, change]) => (
          <div className="index-tile" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small className={change.startsWith('+') ? 'up' : 'down'}>{change}</small>
          </div>
        ))}
      </div>
      <section className="panel content-panel">
        <SectionHeader
          title="Popular assets"
          note="Market snapshot · Simulated quotes"
          action={
            <label className="table-search">
              <Search size={15} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search symbols"
              />
            </label>
          }
        />
        <DataTable headers={['ASSET', 'PRICE', 'TODAY', 'MARKET CAP', 'SECTOR', '']}>
          {filtered.map((asset) => (
            <tr key={asset.symbol}>
              <td>
                <Link className="table-asset" to={`/markets/${asset.symbol}`}>
                  <AssetAvatar symbol={asset.symbol} />
                  <span>
                    <strong>{asset.symbol}</strong>
                    <small>{asset.name}</small>
                  </span>
                </Link>
              </td>
              <td className="table-number">{fmt(asset.price)}</td>
              <td>
                <Change value={asset.change} />
              </td>
              <td>{asset.cap}</td>
              <td>
                <span className="subtle-text">{asset.sector}</span>
              </td>
              <td>
                <Link
                  className="table-icon-link"
                  to={`/markets/${asset.symbol}`}
                  aria-label={`View ${asset.symbol}`}
                >
                  <ArrowRight size={16} />
                </Link>
              </td>
            </tr>
          ))}
        </DataTable>
        <div className="table-bottom-note">
          <span>Showing {filtered.length} assets</span>
          <span>
            <Activity size={13} /> Simulated market data
          </span>
        </div>
      </section>
      <div className="inline-note">
        <CircleHelp size={15} /> Prices are simulated and are not investment advice or live market
        quotes.
      </div>
    </div>
  );
}

export function StockPage() {
  const { symbol = 'AAPL' } = useParams();
  const asset =
    instruments.find((item) => item.symbol.toUpperCase() === symbol.toUpperCase()) ??
    instruments[0]!;
  const [range, setRange] = useState('1D');
  return (
    <div className="workspace-page">
      <div className="stock-breadcrumb">
        <Link to="/markets">
          <ArrowLeft size={14} /> Markets
        </Link>
        <span>/</span>
        {asset.symbol}
      </div>
      <div className="stock-heading">
        <div className="stock-identity">
          <AssetAvatar symbol={asset.symbol} />
          <div>
            <div className="stock-title-line">
              <h1>{asset.symbol}</h1>
              <span className="simulated-pill">SIMULATED</span>
            </div>
            <p>
              {asset.name} <span>·</span> {asset.exchange}
            </p>
          </div>
        </div>
        <div className="stock-actions">
          <button className="button button-secondary">
            <Star size={15} /> Add to watchlist
          </button>
          <Link to={`/trading?symbol=${asset.symbol}`} className="button button-primary">
            Trade {asset.symbol}
          </Link>
        </div>
      </div>
      <section className="stock-price-row">
        <strong>{fmt(asset.price)}</strong>
        <Change value={asset.change} />
        <span className="stock-price-note">Today</span>
        <span className="market-open-indicator">
          <i /> Market open
        </span>
      </section>
      <div className="stock-layout">
        <section className="panel stock-chart-panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Price performance</div>
              <div className="panel-subtitle">Simulated intraday price · USD</div>
            </div>
            <button className="icon-button quiet" aria-label="More chart options">
              <MoreHorizontal size={18} />
            </button>
          </div>
          <div className="stock-chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stockHistory} margin={{ top: 15, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="stockFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4a9b87" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="#4a9b87" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="#edf0f5" strokeDasharray="3 5" />
                <XAxis
                  dataKey="time"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#97a0b0', fontSize: 11 }}
                />
                <YAxis
                  domain={['dataMin - 2', 'dataMax + 2']}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#97a0b0', fontSize: 11 }}
                  tickFormatter={(value) => `$${value}`}
                  width={54}
                />
                <Tooltip formatter={(value) => fmt(Number(value))} />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#4a9b87"
                  strokeWidth={2.5}
                  fill="url(#stockFill)"
                  activeDot={{ r: 5, fill: '#4a9b87', stroke: '#fff', strokeWidth: 3 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="range-tabs stock-range">
            {['1D', '1W', '1M', '3M', '1Y', 'ALL'].map((period) => (
              <button
                className={range === period ? 'selected' : ''}
                onClick={() => setRange(period)}
                key={period}
              >
                {period}
              </button>
            ))}
          </div>
        </section>
        <aside className="panel stock-facts">
          <div className="panel-title">Market statistics</div>
          {[
            ['Previous close', fmt(asset.price * (1 - asset.change / 100))],
            ['Day range', `${fmt(asset.price * 0.985)} – ${fmt(asset.price * 1.012)}`],
            ['52-week range', '$164.08 – $267.31'],
            ['Market cap', asset.cap],
            ['Volume', '48.26M'],
            ['Avg. volume', '52.14M'],
            ['P/E ratio', '31.42'],
            ['Sector', asset.sector],
          ].map(([label, value]) => (
            <div className="fact-row" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
          <div className="fact-disclaimer">
            <ShieldCheck size={14} /> Practice data, not a live quote.
          </div>
        </aside>
      </div>
      <section className="panel stock-about">
        <SectionHeader title="About this asset" />
        <p>
          {asset.name} is listed on {asset.exchange}. Market data in Asteriq AI is simulated for
          paper-trading practice; it may not reflect real market prices.
        </p>
        <Link to="/research" className="text-link">
          Research {asset.symbol} <ArrowRight size={14} />
        </Link>
      </section>
    </div>
  );
}

export function PortfolioPage() {
  return (
    <div className="workspace-page">
      <PageTitle
        eyebrow="YOUR INVESTMENTS"
        title="Portfolio"
        subtitle="Track positions, performance, and virtual buying power."
        action={
          <Link to="/trading" className="button button-primary">
            <Plus size={16} /> Trade
          </Link>
        }
      />
      <div className="portfolio-summary-cards">
        {(
          [
            ['Portfolio value', '$104,284.62', '+4.28% all time'],
            ['Invested', '$78,450.00', '75.2% allocated'],
            ['Available cash', '$25,834.62', 'Virtual funds'],
            ['Total return', '+$4,284.62', '+4.28%'],
          ] as const
        ).map(([label, value, note], index) => (
          <article className="metric-card" key={label}>
            <div className="metric-label">{label.toUpperCase()}</div>
            <div className="metric-value">{value}</div>
            <div className={`metric-foot ${index === 3 ? 'up' : ''}`}>{note}</div>
          </article>
        ))}
      </div>
      <section className="panel content-panel">
        <SectionHeader
          title="Your positions"
          note="Position values based on simulated market prices."
          action={
            <button className="button button-secondary">
              <DownloadGlyph /> Export
            </button>
          }
        />
        <DataTable
          headers={[
            'ASSET',
            'SHARES',
            'AVG. PRICE',
            'LAST PRICE',
            'MARKET VALUE',
            'TOTAL RETURN',
            'ALLOCATION',
          ]}
        >
          {ownedPositions.map((position) => (
            <tr key={position.symbol}>
              <td>
                <Link className="table-asset" to={`/markets/${position.symbol}`}>
                  <AssetAvatar symbol={position.symbol} />
                  <span>
                    <strong>{position.symbol}</strong>
                    <small>{position.company}</small>
                  </span>
                </Link>
              </td>
              <td>{position.quantity}</td>
              <td>{fmt(position.average)}</td>
              <td>{fmt(position.price)}</td>
              <td className="table-number">{fmt(position.value)}</td>
              <td>
                <span className="up">
                  {fmt(position.pnl)}{' '}
                  <small>
                    (+{((position.pnl / (position.value - position.pnl)) * 100).toFixed(2)}%)
                  </small>
                </span>
              </td>
              <td>
                <div className="allocation-cell">
                  <span className="allocation-bar">
                    <i style={{ width: `${position.allocation}%` }} />
                  </span>
                  <small>{position.allocation}%</small>
                </div>
              </td>
            </tr>
          ))}
        </DataTable>
      </section>
    </div>
  );
}

export function WatchlistPage() {
  const [items, setItems] = useState(instruments.slice(0, 6));
  const [query, setQuery] = useState('');
  const filtered = items.filter(
    (item) =>
      item.symbol.includes(query.toUpperCase()) ||
      item.name.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="workspace-page">
      <PageTitle
        eyebrow="SAVED ASSETS"
        title="Watchlist"
        subtitle="A focused view of the markets you’re following."
        action={
          <button
            className="button button-primary"
            onClick={() => setItems(instruments.slice(0, 8))}
          >
            <Plus size={16} /> Add symbols
          </button>
        }
      />
      <section className="panel content-panel">
        <SectionHeader
          title="My watchlist"
          note={`${items.length} assets · Private to you`}
          action={
            <label className="table-search">
              <Search size={15} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Find an asset"
              />
            </label>
          }
        />
        <DataTable headers={['ASSET', 'PRICE', 'TODAY', 'SECTOR', '']}>
          {filtered.map((asset) => (
            <tr key={asset.symbol}>
              <td>
                <Link className="table-asset" to={`/markets/${asset.symbol}`}>
                  <AssetAvatar symbol={asset.symbol} />
                  <span>
                    <strong>{asset.symbol}</strong>
                    <small>{asset.name}</small>
                  </span>
                </Link>
              </td>
              <td className="table-number">{fmt(asset.price)}</td>
              <td>
                <Change value={asset.change} />
              </td>
              <td>{asset.sector}</td>
              <td>
                <button
                  className="table-icon-link"
                  aria-label={`Remove ${asset.symbol}`}
                  onClick={() =>
                    setItems((current) => current.filter((item) => item.symbol !== asset.symbol))
                  }
                >
                  <Star size={16} fill="currentColor" />
                </button>
              </td>
            </tr>
          ))}
        </DataTable>
      </section>
      <div className="inline-note">
        <Star size={15} /> Your saved symbols are for market discovery and do not indicate a
        recommendation.
      </div>
    </div>
  );
}

export { ResearchPage } from './ResearchPage.js';

export function NewsPage() {
  const [category, setCategory] = useState('All');
  return (
    <div className="workspace-page">
      <PageTitle
        eyebrow="MARKET INTELLIGENCE"
        title="News & sentiment"
        subtitle="A considered read on the stories shaping today’s simulated market."
        action={
          <button className="button button-secondary">
            <Bell size={15} /> Manage alerts
          </button>
        }
      />
      <div className="sentiment-banner">
        <div>
          <span className="eyebrow">ASTERIQ SENTIMENT PULSE</span>
          <h2>
            Market tone is <strong>cautiously positive</strong>
          </h2>
          <p>Based on a sample of market headlines and simulated asset moves.</p>
        </div>
        <div className="sentiment-meter">
          <span>Positive</span>
          <div>
            <i />
          </div>
          <strong>64</strong>
        </div>
      </div>
      <section className="panel content-panel">
        <div className="news-filter-row">
          <div className="filter-tabs">
            {['All', 'Markets', 'Technology', 'Economy', 'Companies'].map((item) => (
              <button
                className={category === item ? 'selected' : ''}
                onClick={() => setCategory(item)}
                key={item}
              >
                {item}
              </button>
            ))}
          </div>
          <button className="icon-button quiet">
            <Filter size={16} />
          </button>
        </div>
        <div className="news-list">
          {news
            .filter((item) => category === 'All' || category.toUpperCase() === item.category)
            .map((item) => (
              <article className="news-item" key={item.title}>
                <span className={`news-art ${item.tone}`}>
                  <Activity size={18} />
                </span>
                <div className="news-copy">
                  <span className="news-kicker">
                    {item.category} <i /> {item.source} · {item.time}
                  </span>
                  <h3>{item.title}</h3>
                  <p>
                    Market participants are assessing new signals and positioning for the next
                    trading session.
                  </p>
                  <div className="news-sentiment">
                    <span className="sentiment-tag">
                      <Sparkles size={12} /> Neutral-positive
                    </span>
                    <span>AI sentiment · indicative</span>
                  </div>
                </div>
                <button className="table-icon-link" aria-label="Open article">
                  <ExternalLink size={16} />
                </button>
              </article>
            ))}
        </div>
      </section>
    </div>
  );
}

export { AlertsPage } from './AlertsPage.js';

export function TransactionsPage() {
  return (
    <div className="workspace-page">
      <PageTitle
        eyebrow="ACCOUNT ACTIVITY"
        title="Transactions"
        subtitle="A transparent record of your paper-trading activity."
        action={
          <button className="button button-secondary">
            <DownloadGlyph /> Export
          </button>
        }
      />
      <div className="transaction-total">
        <div>
          <span>NET VIRTUAL CASH FLOW</span>
          <strong>−$3,482.60</strong>
        </div>
        <div>
          <span>THIS MONTH</span>
          <small>12 activities</small>
        </div>
      </div>
      <section className="panel content-panel">
        <SectionHeader
          title="Recent activity"
          note="All amounts are virtual and denominated in USD."
          action={
            <button className="button button-secondary">
              <Filter size={14} /> Filter
            </button>
          }
        />
        <DataTable headers={['ACTIVITY', 'REFERENCE', 'DATE', 'AMOUNT', 'STATUS']}>
          {[
            {
              action: 'Buy · AAPL',
              type: 'Paper trade',
              id: 'TRD-04821',
              date: 'Oct 07, 2026 · 10:42 AM',
              amount: -2521.4,
            },
            {
              action: 'Sell · TSLA',
              type: 'Paper trade',
              id: 'TRD-04792',
              date: 'Oct 05, 2026 · 11:06 AM',
              amount: 1587.2,
            },
            {
              action: 'Buy · NVDA',
              type: 'Paper trade',
              id: 'TRD-04770',
              date: 'Oct 03, 2026 · 2:18 PM',
              amount: -1431.36,
            },
            {
              action: 'Virtual funding',
              type: 'Initial capital',
              id: 'FND-00001',
              date: 'Sep 28, 2026 · 9:15 AM',
              amount: 100000,
            },
          ].map((item) => (
            <tr key={item.id}>
              <td>
                <span className="transaction-name">
                  <span className={`transaction-icon ${item.amount > 0 ? 'credit' : ''}`}>
                    {item.amount > 0 ? <ArrowDownRight size={15} /> : <ArrowUpRight size={15} />}
                  </span>
                  <span>
                    <strong>{item.action}</strong>
                    <small>{item.type}</small>
                  </span>
                </span>
              </td>
              <td className="subtle-text">{item.id}</td>
              <td>{item.date}</td>
              <td className={item.amount > 0 ? 'up table-number' : 'table-number'}>
                {item.amount > 0 ? '+' : '−'}
                {fmt(Math.abs(item.amount))}
              </td>
              <td>
                <span className="filled-badge">
                  <i /> Recorded
                </span>
              </td>
            </tr>
          ))}
        </DataTable>
      </section>
    </div>
  );
}

export function SettingsPage() {
  const [saved, setSaved] = useState(false);
  return (
    <div className="workspace-page">
      <PageTitle
        eyebrow="PREFERENCES"
        title="Settings"
        subtitle="Manage your profile and learning environment."
      />
      <div className="settings-layout">
        <nav className="settings-nav">
          <a className="selected" href="#profile">
            Profile
          </a>
          <a href="#preferences">Preferences</a>
          <a href="#security">Security</a>
          <a href="#notifications">Notifications</a>
        </nav>
        <div className="settings-sections">
          <section id="profile" className="panel settings-card">
            <SectionHeader
              title="Personal profile"
              note="Your information is used to personalize your workspace."
            />
            <div className="profile-settings-row">
              <span className="profile-avatar large">JD</span>
              <button className="button button-secondary">Change photo</button>
            </div>
            <div className="settings-form-grid">
              <label className="form-field">
                First name
                <input defaultValue="Jordan" />
              </label>
              <label className="form-field">
                Last name
                <input defaultValue="Davis" />
              </label>
              <label className="form-field full-width">
                Email address
                <input defaultValue="jordan@example.com" type="email" />
              </label>
            </div>
          </section>
          <section id="preferences" className="panel settings-card">
            <SectionHeader
              title="Trading preferences"
              note="Personalize how information is displayed."
            />
            <div className="setting-line">
              <div>
                <strong>Base currency</strong>
                <small>Display portfolio values in your preferred currency.</small>
              </div>
              <select defaultValue="USD">
                <option>USD</option>
                <option>EUR</option>
                <option>GBP</option>
              </select>
            </div>
            <div className="setting-line">
              <div>
                <strong>Market data labels</strong>
                <small>Keep the simulated-data badge visible across the app.</small>
              </div>
              <button className="toggle on" aria-label="Simulated market data labels enabled">
                <i />
              </button>
            </div>
          </section>
          <section id="security" className="panel settings-card">
            <SectionHeader
              title="Security & sessions"
              note="Authentication settings for your Asteriq account."
            />
            <div className="security-card-row">
              <LockKeyhole size={18} />
              <span>
                <strong>Password</strong>
                <small>Last updated recently</small>
              </span>
              <button className="button button-secondary">Update password</button>
            </div>
            <div className="security-card-row">
              <ShieldCheck size={18} />
              <span>
                <strong>Active sessions</strong>
                <small>This device · Current session</small>
              </span>
              <span className="filled-badge">
                <i /> Active
              </span>
            </div>
          </section>
          <button className="button button-primary save-settings" onClick={() => setSaved(true)}>
            {saved ? (
              <>
                <Check size={15} /> Saved
              </>
            ) : (
              'Save changes'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const isRegister = mode === 'register';
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setNotice('');
    try {
      const endpoint = isRegister ? 'register' : 'login';
      const response = await runSessionChange(() =>
        fetch(`${apiUrl}/auth/${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-client-type': 'web' },
          credentials: 'include',
          body: JSON.stringify(
            isRegister ? { email, password, displayName: name } : { email, password },
          ),
        }),
      );
      const result = (await response.json()) as {
        ok?: boolean;
        data?: { accessToken?: string; message?: string };
        error?: { message?: string };
      };
      if (!response.ok || !result.ok)
        throw new Error(result.error?.message ?? 'Unable to complete your request.');
      if (isRegister) {
        setNotice(
          result.data?.message ?? 'Account created. Check your email to verify it, then sign in.',
        );
      } else {
        if (result.data?.accessToken) setAccessToken(result.data.accessToken);
        navigate('/');
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to connect to the Asteriq API.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="auth-page">
      <div className="auth-brand">
        <Link className="brand" to="/">
          <span className="brand-mark">
            <Activity size={19} strokeWidth={2.5} />
          </span>
          <span className="brand-word">
            asteriq<span>AI</span>
          </span>
        </Link>
        <span className="auth-secure">
          <ShieldCheck size={14} /> Secure paper trading
        </span>
      </div>
      <div className="auth-layout">
        <section className="auth-promo">
          <div className="auth-promo-tag">
            <Sparkles size={14} /> INVEST WITH INSIGHT
          </div>
          <h1>Build your market confidence.</h1>
          <p>
            Explore markets, practice your strategy, and learn with a risk-free virtual portfolio.
          </p>
          <div className="auth-promo-chart">
            <div className="promo-chart-label">
              <span>DEMO PORTFOLIO</span>
              <strong>$104,284.62</strong>
              <small>
                <TrendingUp size={13} /> +4.28% this month
              </small>
            </div>
            <svg viewBox="0 0 520 140" preserveAspectRatio="none">
              <defs>
                <linearGradient id="promoFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#8e83ff" stopOpacity=".3" />
                  <stop offset="1" stopColor="#8e83ff" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path
                className="promo-area"
                d="M0 110 C35 105 42 77 78 88 S121 100 150 65 S194 72 228 54 S275 76 304 47 S350 54 374 38 S410 63 438 28 S480 40 520 12 V140 H0Z"
              />
              <path
                className="promo-line"
                d="M0 110 C35 105 42 77 78 88 S121 100 150 65 S194 72 228 54 S275 76 304 47 S350 54 374 38 S410 63 438 28 S480 40 520 12"
              />
            </svg>
          </div>
          <div className="auth-promo-bottom">
            <span>
              <ShieldCheck size={16} /> Virtual funds only
            </span>
            <span>
              <Activity size={16} /> Simulated market data
            </span>
          </div>
        </section>
        <section className="auth-form-panel">
          <div className="auth-form-head">
            <span className="eyebrow">{isRegister ? 'GET STARTED' : 'WELCOME BACK'}</span>
            <h2>{isRegister ? 'Create your account' : 'Sign in to Asteriq'}</h2>
            <p>
              {isRegister
                ? 'Start learning with your virtual portfolio.'
                : 'Your portfolio is ready when you are.'}
            </p>
          </div>
          <form onSubmit={submit}>
            {isRegister && (
              <label className="form-field">
                Full name
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                  required
                  placeholder="Jordan Davis"
                />
              </label>
            )}
            <label className="form-field">
              Email address
              <div className="auth-input-icon">
                <Mail size={16} />
                <input
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="you@example.com"
                />
              </div>
            </label>
            <label className="form-field">
              Password
              <div className="auth-input-icon">
                <LockKeyhole size={16} />
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  autoComplete={isRegister ? 'new-password' : 'current-password'}
                  minLength={12}
                  required
                  placeholder={isRegister ? 'At least 12 characters' : 'Enter your password'}
                />
              </div>
            </label>
            {!isRegister && (
              <button
                type="button"
                className="forgot-password"
                onClick={() =>
                  setNotice('Password recovery is available from the API when it is running.')
                }
              >
                Forgot password?
              </button>
            )}
            {notice && (
              <div className="auth-notice" role="status">
                {notice}
              </div>
            )}
            <button className="button button-primary auth-submit" disabled={loading}>
              {loading ? 'Please wait…' : isRegister ? 'Create account' : 'Sign in'}{' '}
              <ArrowRight size={16} />
            </button>
          </form>
          <div className="auth-form-switch">
            {isRegister ? 'Already have an account?' : 'New to Asteriq?'}{' '}
            <Link to={isRegister ? '/login' : '/register'}>
              {isRegister ? 'Sign in' : 'Create an account'}
            </Link>
          </div>
          <div className="auth-legal">
            By continuing, you agree this platform is for educational paper trading only. No
            real-money orders or brokerage services are provided.
          </div>
        </section>
      </div>
      <footer className="auth-footer">
        © 2026 Asteriq AI <span>·</span> Market data is simulated
      </footer>
    </main>
  );
}

function DownloadGlyph() {
  return <span className="download-glyph">↓</span>;
}
