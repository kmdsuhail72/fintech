export type MarketQuote = {
  symbolId: string;
  symbol: string;
  currency: string;
  price: string;
  open: string;
  high: string;
  low: string;
  previousClose: string;
  change: string;
  changePercent: string;
  volume: number;
  timestamp: string;
  quoteStatus: 'SIMULATED' | 'DELAYED' | 'REALTIME' | 'STALE';
  source: string;
};

export type MarketInstrument = {
  id: string;
  symbol: string;
  quoteCurrency: string;
  latestQuote: MarketQuote;
};

export interface MarketDataProvider {
  readonly name: string;
  generateQuote(
    instrument: MarketInstrument,
    previous: MarketQuote | null,
    now: Date,
  ): Promise<MarketQuote>;
}
