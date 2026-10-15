export type PageQuery = { limit: number; offset: number };

export type SymbolRecord = {
  id: string;
  symbol: string;
  exchange_code: string;
  company_name: string;
  asset_type: string;
  quote_currency: string;
  country_code: string | null;
};

export type OrderSide = 'BUY' | 'SELL';

export type SubmitOrder = {
  portfolioId?: string;
  symbolId: string;
  side: OrderSide;
  quantity: string;
  idempotencyKey: string;
};
