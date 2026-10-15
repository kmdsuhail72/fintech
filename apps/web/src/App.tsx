import { useState } from 'react';
import {
  Activity,
  ArrowLeftRight,
  Bell,
  BriefcaseBusiness,
  ChevronDown,
  CircleHelp,
  Command,
  Compass,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Menu,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Star,
  X,
} from 'lucide-react';
import { BrowserRouter, Link, NavLink, Outlet, Route, Routes, useNavigate } from 'react-router-dom';
import DashboardPage from './DashboardPage.js';
import { logoutSession } from './api.js';
import { RecoveryPage } from './RecoveryPage.js';
import {
  AlertsPage,
  AuthPage,
  MarketsPage,
  NewsPage,
  PortfolioPage,
  ResearchPage,
  SettingsPage,
  StockPage,
  TradingPage,
  TransactionsPage,
  WatchlistPage,
} from './WorkspacePages.js';

const primaryNavigation = [
  { label: 'Overview', path: '/', icon: LayoutDashboard },
  { label: 'Markets', path: '/markets', icon: Compass },
  { label: 'Portfolio', path: '/portfolio', icon: BriefcaseBusiness },
  { label: 'Trading', path: '/trading', icon: ArrowLeftRight },
  { label: 'Watchlist', path: '/watchlist', icon: Star },
];

const researchNavigation = [
  { label: 'AI Research', path: '/research', icon: Sparkles },
  { label: 'Market news', path: '/news', icon: Activity },
  { label: 'Price alerts', path: '/alerts', icon: Bell },
  { label: 'Transactions', path: '/transactions', icon: CreditCard },
];

function Sidebar({ close }: { close?: () => void }) {
  const navigate = useNavigate();
  const [logoutError, setLogoutError] = useState('');
  return (
    <aside className="sidebar">
      <Link className="brand" to="/" onClick={close} aria-label="Asteriq AI home">
        <span className="brand-mark">
          <Activity size={19} strokeWidth={2.5} />
        </span>
        <span className="brand-word">
          asteriq<span>AI</span>
        </span>
      </Link>

      <button className="account-switcher" type="button">
        <span className="account-avatar">D</span>
        <span className="account-copy">
          <strong>Demo portfolio</strong>
          <small>Paper account</small>
        </span>
        <ChevronDown size={15} />
      </button>

      <div className="nav-group">
        <span className="nav-caption">WORKSPACE</span>
        {primaryNavigation.map(({ label, path, icon: Icon }) => (
          <NavLink
            key={label}
            to={path}
            end={path === '/'}
            onClick={close}
            className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
          >
            <Icon size={18} strokeWidth={1.8} />
            <span>{label}</span>
            {label === 'Watchlist' && <span className="nav-count">8</span>}
          </NavLink>
        ))}
      </div>

      <div className="nav-group">
        <span className="nav-caption">INTELLIGENCE</span>
        {researchNavigation.map(({ label, path, icon: Icon }) => (
          <NavLink
            key={label}
            to={path}
            onClick={close}
            className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
          >
            <Icon size={18} strokeWidth={1.8} />
            <span>{label}</span>
            {label === 'Price alerts' && <span className="nav-dot" />}
          </NavLink>
        ))}
      </div>

      <div className="sidebar-bottom">
        <div className="market-open-card">
          <div className="market-open-heading">
            <span className="status-dot" /> US MARKET
          </div>
          <strong>
            Open <span>•</span> Closes 4:00 PM ET
          </strong>
          <small>Quotes are simulated for learning</small>
        </div>
        <NavLink
          to="/settings"
          onClick={close}
          className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
        >
          <Settings size={18} strokeWidth={1.8} />
          <span>Settings</span>
        </NavLink>
        <button className="nav-link support-link" type="button">
          <CircleHelp size={18} strokeWidth={1.8} />
          <span>Help & support</span>
        </button>
        <div className="sidebar-profile">
          <span className="profile-avatar">JD</span>
          <span className="profile-copy">
            <strong>Jordan Davis</strong>
            <small>Free plan</small>
          </span>
          <button
            className="icon-button quiet"
            aria-label="Sign out"
            type="button"
            onClick={() => {
              setLogoutError('');
              void logoutSession()
                .then(() => {
                  close?.();
                  navigate('/login');
                })
                .catch((error: Error) => setLogoutError(error.message));
            }}
          >
            <LogOut size={16} />
          </button>
        </div>
        {logoutError && <p role="alert">{logoutError}</p>}
      </div>
    </aside>
  );
}

function Topbar({ onMenu }: { onMenu: () => void }) {
  const [search, setSearch] = useState('');
  const navigate = useNavigate();
  return (
    <header className="topbar">
      <button
        className="mobile-menu icon-button"
        type="button"
        aria-label="Open navigation"
        onClick={onMenu}
      >
        <Menu size={20} />
      </button>
      <div className="breadcrumb">
        <span>Workspace</span>
        <span className="breadcrumb-divider">/</span>
        <strong>Paper trading</strong>
      </div>
      <label className="global-search">
        <Search size={16} />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && search.trim()) {
              navigate(`/markets?q=${encodeURIComponent(search.trim())}`);
            }
          }}
          placeholder="Search markets, assets..."
          aria-label="Search markets and assets"
        />
        <span className="search-shortcut">
          <Command size={12} /> K
        </span>
      </label>
      <div className="topbar-actions">
        <div className="session-pill">
          <span className="status-dot" /> US market open
        </div>
        <button
          className="icon-button notification-button"
          type="button"
          aria-label="Notifications"
        >
          <Bell size={18} />
          <span />
        </button>
        <Link to="/settings" className="topbar-user" aria-label="Account settings">
          <span className="profile-avatar small">JD</span>
          <ChevronDown size={14} />
        </Link>
      </div>
    </header>
  );
}

function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <div className="app-shell">
      <Sidebar />
      {mobileOpen && (
        <div className="mobile-sidebar-backdrop" onClick={() => setMobileOpen(false)}>
          <div className="mobile-sidebar" onClick={(event) => event.stopPropagation()}>
            <button
              className="mobile-close icon-button"
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation"
            >
              <X size={19} />
            </button>
            <Sidebar close={() => setMobileOpen(false)} />
          </div>
        </div>
      )}
      <div className="workspace">
        <Topbar onMenu={() => setMobileOpen(true)} />
        <main className="page-content">
          <Outlet />
        </main>
        <footer className="app-footer">
          <span>
            <ShieldCheck size={13} /> Educational paper trading only. No real money or brokerage
            orders.
          </span>
          <span>
            Data is simulated <span className="footer-separator">·</span> v1.0
          </span>
        </footer>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/verify-email" element={<RecoveryPage />} />
        <Route path="/reset-password" element={<RecoveryPage reset />} />
        <Route path="/register" element={<AuthPage mode="register" />} />
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="/markets" element={<MarketsPage />} />
          <Route path="/markets/:symbol" element={<StockPage />} />
          <Route path="/portfolio" element={<PortfolioPage />} />
          <Route path="/trading" element={<TradingPage />} />
          <Route path="/watchlist" element={<WatchlistPage />} />
          <Route path="/research" element={<ResearchPage />} />
          <Route path="/news" element={<NewsPage />} />
          <Route path="/alerts" element={<AlertsPage />} />
          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<DashboardPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
