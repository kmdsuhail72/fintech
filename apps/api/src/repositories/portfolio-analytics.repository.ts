import type { Pool } from 'pg';
import { ApiError } from '../utils/errors.js';
import { notFound } from '../utils/errors.js';

export type PortfolioAnalyticsPosition = {
  symbolId: string;
  symbol: string;
  companyName: string;
  quantity: string;
  averagePrice: string;
  currentPrice: string;
  previousClose: string;
  marketValue: string;
  costBasis: string;
  profitLoss: string;
  profitLossPercentage: string;
  dailyPnl: string;
  positionAllocationPercentage: string;
  portfolioAllocationPercentage: string;
  currency: string;
  quoteTimestamp: Date | string;
};

export type PortfolioAnalyticsRow = {
  portfolioId: string;
  portfolioName: string;
  currency: string;
  availableCash: string;
  investedAmount: string;
  marketValue: string;
  costBasis: string;
  realizedPnl: string;
  unrealizedPnl: string;
  dailyPnl: string;
  dailyPnlPercentage: string;
  totalPnl: string;
  totalPnlPercentage: string | null;
  totalPortfolioValue: string;
  cashAllocationPercentage: string;
  asOf: Date;
  unavailableSymbols: string[];
  positions: PortfolioAnalyticsPosition[];
};

export class PortfolioAnalyticsRepository {
  constructor(private readonly pool: Pool) {}

  async getUserPortfolios(userId: string): Promise<PortfolioAnalyticsRow[]> {
    const result = await this.pool.query<PortfolioAnalyticsRow>(
      `WITH user_portfolios AS (
         SELECT p.id AS portfolio_id, p.name AS portfolio_name, p.base_currency,
                w.balance AS available_cash
         FROM accounts a
         JOIN portfolios p ON p.account_id = a.id
         JOIN wallets w ON w.account_id = a.id AND w.currency = a.base_currency
         WHERE a.user_id = $1 AND a.account_type = 'PAPER'
       ),
       holdings AS (
         SELECT p.portfolio_id, p.portfolio_name, p.base_currency,
                p.available_cash, pos.symbol_id, s.symbol, s.company_name,
                pos.quantity, pos.average_cost,
                q.price AS current_price, q.previous_close, q.currency AS quote_currency,
                q.observed_at AS quote_timestamp,
                pos.quantity * q.price AS market_value,
                pos.quantity * pos.average_cost AS cost_basis,
                pos.quantity * (q.price - pos.average_cost) AS profit_loss,
                pos.quantity * (q.price - q.previous_close) AS daily_pnl
         FROM user_portfolios p
         JOIN positions pos ON pos.portfolio_id = p.portfolio_id AND pos.quantity > 0
         JOIN symbols s ON s.id = pos.symbol_id
         LEFT JOIN LATERAL (
           SELECT price, previous_close, currency, observed_at
           FROM market_quotes
           WHERE symbol_id = pos.symbol_id AND quote_status <> 'STALE'
           ORDER BY observed_at DESC
           LIMIT 1
         ) q ON true
       ),
       portfolio_totals AS (
         SELECT portfolio_id,
                COALESCE(sum(market_value), 0) AS market_value,
                COALESCE(sum(cost_basis), 0) AS cost_basis,
                COALESCE(sum(profit_loss), 0) AS unrealized_pnl,
                COALESCE(sum(daily_pnl), 0) AS daily_pnl,
                COALESCE(sum(quantity * previous_close), 0) AS previous_close_value,
                max(quote_timestamp) AS as_of
         FROM holdings
         WHERE current_price IS NOT NULL AND previous_close IS NOT NULL
           AND quote_currency = base_currency
         GROUP BY portfolio_id
       )
       SELECT p.portfolio_id AS "portfolioId", p.portfolio_name AS "portfolioName",
              p.base_currency AS currency, p.available_cash::text AS "availableCash",
              COALESCE(t.cost_basis, 0)::text AS "investedAmount",
              COALESCE(t.market_value, 0)::text AS "marketValue",
              COALESCE(t.cost_basis, 0)::text AS "costBasis",
              COALESCE(realized.realized_pnl, 0)::text AS "realizedPnl",
              COALESCE(t.unrealized_pnl, 0)::text AS "unrealizedPnl",
              COALESCE(t.daily_pnl, 0)::text AS "dailyPnl",
              CASE WHEN COALESCE(t.previous_close_value, 0) = 0 THEN '0'
                   ELSE (t.daily_pnl / t.previous_close_value * 100)::text
              END AS "dailyPnlPercentage",
              (COALESCE(t.unrealized_pnl, 0) + COALESCE(realized.realized_pnl, 0))::text
                AS "totalPnl",
              CASE WHEN COALESCE(t.cost_basis, 0) = 0
                   THEN CASE WHEN COALESCE(t.unrealized_pnl, 0)
                                    + COALESCE(realized.realized_pnl, 0) = 0
                             THEN '0' ELSE NULL END
                   ELSE ((COALESCE(t.unrealized_pnl, 0)
                     + COALESCE(realized.realized_pnl, 0)) / t.cost_basis * 100)::text
              END AS "totalPnlPercentage",
              (p.available_cash + COALESCE(t.market_value, 0))::text
                AS "totalPortfolioValue",
              CASE WHEN p.available_cash + COALESCE(t.market_value, 0) = 0 THEN '0'
                   ELSE (p.available_cash
                     / (p.available_cash + COALESCE(t.market_value, 0)) * 100)::text
              END AS "cashAllocationPercentage",
              COALESCE(t.as_of, now()) AS "asOf",
              COALESCE((
                SELECT array_agg(DISTINCT h.symbol ORDER BY h.symbol)
                FROM holdings h
                WHERE h.portfolio_id = p.portfolio_id
                  AND (h.current_price IS NULL OR h.previous_close IS NULL
                    OR h.quote_currency <> h.base_currency)
              ), ARRAY[]::text[]) AS "unavailableSymbols",
              COALESCE((
                SELECT jsonb_agg(
                  jsonb_build_object(
                    'symbolId', h.symbol_id,
                    'symbol', h.symbol,
                    'companyName', h.company_name,
                    'quantity', h.quantity::text,
                    'averagePrice', h.average_cost::text,
                    'currentPrice', h.current_price::text,
                    'previousClose', h.previous_close::text,
                    'marketValue', h.market_value::text,
                    'costBasis', h.cost_basis::text,
                    'profitLoss', h.profit_loss::text,
                    'profitLossPercentage',
                      CASE WHEN h.cost_basis = 0 THEN '0'
                           ELSE (h.profit_loss / h.cost_basis * 100)::text END,
                    'dailyPnl', h.daily_pnl::text,
                    'positionAllocationPercentage',
                      CASE WHEN COALESCE(t.market_value, 0) = 0 THEN '0'
                           ELSE (h.market_value / t.market_value * 100)::text END,
                    'portfolioAllocationPercentage',
                      CASE WHEN p.available_cash + COALESCE(t.market_value, 0) = 0 THEN '0'
                           ELSE (h.market_value
                             / (p.available_cash + t.market_value) * 100)::text END,
                    'currency', h.quote_currency,
                    'quoteTimestamp', h.quote_timestamp
                  ) ORDER BY h.market_value DESC, h.symbol
                )
                FROM holdings h
                WHERE h.portfolio_id = p.portfolio_id
                  AND h.current_price IS NOT NULL AND h.previous_close IS NOT NULL
                  AND h.quote_currency = h.base_currency
              ), '[]'::jsonb) AS positions
       FROM user_portfolios p
       LEFT JOIN portfolio_totals t ON t.portfolio_id = p.portfolio_id
       LEFT JOIN LATERAL (
         SELECT COALESCE(sum(pos.realized_pnl), 0) AS realized_pnl
         FROM positions pos WHERE pos.portfolio_id = p.portfolio_id
       ) realized ON true
       ORDER BY p.portfolio_id`,
      [userId],
    );

    if (!result.rowCount) throw notFound('Paper portfolio');
    const unavailableSymbols = [
      ...new Set(result.rows.flatMap((row) => row.unavailableSymbols ?? [])),
    ];
    if (unavailableSymbols.length) {
      throw new ApiError(
        503,
        'PORTFOLIO_VALUATION_UNAVAILABLE',
        `Portfolio valuation is unavailable for missing quotes or unsupported currency conversion: ${unavailableSymbols.join(', ')}`,
      );
    }
    return result.rows;
  }
}
