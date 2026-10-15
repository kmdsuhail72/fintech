export type User = { id: string; email: string; displayName: string | null };
export type AuthResult = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
  user: User;
};
export type Instrument = {
  id: string;
  symbol: string;
  company_name: string;
  exchange_code: string;
  quote_currency: string;
  price: string | null;
};
export type Quote = {
  symbolId: string;
  symbol: string;
  price: string;
  changePercent: string;
  currency: string;
  timestamp: string;
  quoteStatus: string;
  volume: number;
};
export type Candle = {
  timestamp: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string | null;
  samples: number;
};
export type CandleResponse = { interval: string; source: string; candles: Candle[] };
export type Position = {
  symbolId: string;
  symbol: string;
  companyName: string;
  quantity: string;
  averageCost: string;
  lastPrice: string | null;
  marketValue: string | null;
  unrealizedPnl: string | null;
};
export type Portfolio = {
  portfolio_id: string;
  name: string;
  base_currency: string;
  cash_balance: string;
  market_value: string;
  total_value: string;
  realized_pnl: string;
  unrealized_pnl: string;
  positions: Position[];
};
export type Order = {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  status: string;
  quantity: string;
  average_fill_price: string | null;
  submitted_at: string;
};
export type Trade = {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: string;
  price: string;
  currency: string;
  executed_at: string;
};
export type Watchlist = {
  id: string;
  name: string;
  items: { symbolId: string; symbol: string; companyName: string }[];
};
export type PriceAlert = {
  id: string;
  symbol: string;
  condition: 'ABOVE' | 'BELOW' | 'CHANGE_PERCENT';
  target_price: string | null;
  target_change_percent: string | null;
  channels: ('IN_APP' | 'EMAIL' | 'PUSH')[];
  currency: string;
  status: 'ACTIVE' | 'PAUSED' | 'CANCELLED' | 'TRIGGERED';
};
export type Research = {
  id: string;
  symbol: string | null;
  question: string;
  response: unknown;
  research_type: string;
  provider: string;
  generated_at: string;
  source_references: unknown;
};
export type Profile = {
  id: string;
  email: string;
  display_name: string | null;
  locale: string | null;
  time_zone: string | null;
};
export type MarketSummary = {
  covered_symbols: number;
  analyzed_articles: number;
  positive_articles: number;
  negative_articles: number;
  average_sentiment: string;
};
