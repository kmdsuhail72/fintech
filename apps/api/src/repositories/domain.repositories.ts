import type { Pool, PoolClient } from 'pg';
import { notFound } from '../utils/errors.js';
import { ApiError } from '../utils/errors.js';
import type { PageQuery, SubmitOrder } from '../models/api.js';
import { emitMetrics } from '../utils/observability.js';

async function inTransaction<T>(pool: Pool, callback: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export class UserRepository {
  constructor(private readonly pool: Pool) {}

  async getProfile(userId: string) {
    const result = await this.pool.query(
      `SELECT u.id, u.email, u.status, u.email_verified_at, u.created_at,
              p.display_name, p.locale, p.time_zone
       FROM users u
       LEFT JOIN user_profiles p ON p.user_id = u.id
       WHERE u.id = $1 AND u.status <> 'DELETED'`,
      [userId],
    );
    if (!result.rowCount) throw notFound('User');
    return result.rows[0];
  }

  async updateProfile(
    userId: string,
    input: { displayName?: string | null; locale?: string; timeZone?: string },
  ) {
    const result = await this.pool.query(
      `UPDATE user_profiles
       SET display_name = CASE WHEN $2::boolean THEN $3::text ELSE display_name END,
           locale = CASE WHEN $4::boolean THEN $5::text ELSE locale END,
           time_zone = CASE WHEN $6::boolean THEN $7::text ELSE time_zone END,
           updated_at = now()
       WHERE user_id = $1
       RETURNING user_id, display_name, locale, time_zone, updated_at`,
      [
        userId,
        Object.hasOwn(input, 'displayName'),
        input.displayName ?? null,
        Object.hasOwn(input, 'locale'),
        input.locale ?? null,
        Object.hasOwn(input, 'timeZone'),
        input.timeZone ?? null,
      ],
    );
    if (!result.rowCount) throw notFound('User profile');
    return result.rows[0];
  }
}

export class MarketRepository {
  constructor(private readonly pool: Pool) {}

  async searchSymbols(query: string | undefined, page: PageQuery) {
    const result = await this.pool.query(
      `SELECT s.id, s.symbol, s.exchange_code, s.company_name, s.asset_type,
              s.quote_currency, s.country_code,
              q.price::text AS price, q.quote_status, q.observed_at
       FROM symbols s
       LEFT JOIN LATERAL (
         SELECT price, quote_status, observed_at
         FROM market_quotes
         WHERE symbol_id = s.id
         ORDER BY observed_at DESC
         LIMIT 1
       ) q ON true
       WHERE s.is_active
         AND ($1::text IS NULL OR s.symbol ILIKE $1 OR s.company_name ILIKE $1)
       ORDER BY s.company_name, s.symbol
       LIMIT $2 OFFSET $3`,
      [query ? `%${query}%` : null, page.limit, page.offset],
    );
    return result.rows;
  }

  async latestQuote(symbol: string) {
    const result = await this.pool.query(
      `SELECT s.id AS symbol_id, s.symbol, s.exchange_code, s.company_name,
              s.quote_currency, q.price::text AS price, q.quote_status,
              q.source, q.observed_at
       FROM symbols s
       JOIN LATERAL (
         SELECT price, quote_status, source, observed_at
         FROM market_quotes
         WHERE symbol_id = s.id
         ORDER BY observed_at DESC
         LIMIT 1
       ) q ON true
       WHERE s.is_active AND upper(s.symbol) = upper($1)`,
      [symbol],
    );
    if (!result.rowCount) throw notFound('Market quote');
    return result.rows[0];
  }

  async quoteHistory(symbol: string, page: PageQuery) {
    const result = await this.pool.query(
      `SELECT q.price::text AS price, q.currency, q.quote_status, q.source, q.observed_at
       FROM market_quotes q
       JOIN symbols s ON s.id = q.symbol_id
       WHERE s.is_active AND upper(s.symbol) = upper($1)
       ORDER BY q.observed_at DESC
       LIMIT $2 OFFSET $3`,
      [symbol, page.limit, page.offset],
    );
    return result.rows;
  }

  async news(query: string | undefined, page: PageQuery) {
    const result = await this.pool.query(
      `SELECT a.id, a.source, a.canonical_url, a.headline, a.summary,
              a.published_at, s.symbol,
              ns.label AS sentiment, ns.score::text AS sentiment_score,
              ns.confidence::text AS sentiment_confidence
       FROM news_articles a
       LEFT JOIN LATERAL (
         SELECT symbol_id, label, score, confidence
         FROM news_sentiment
         WHERE article_id = a.id
         ORDER BY analyzed_at DESC
         LIMIT 1
       ) ns ON true
       LEFT JOIN symbols s ON s.id = ns.symbol_id
       WHERE ($1::text IS NULL OR a.headline ILIKE $1 OR a.summary ILIKE $1)
       ORDER BY a.published_at DESC NULLS LAST, a.ingested_at DESC
       LIMIT $2 OFFSET $3`,
      [query ? `%${query}%` : null, page.limit, page.offset],
    );
    return result.rows;
  }

  async createSymbol(input: {
    symbol: string;
    exchangeCode: string;
    companyName: string;
    assetType: string;
    quoteCurrency: string;
    countryCode?: string | null;
    dataProvider: string;
    providerSymbol: string;
  }) {
    const result = await this.pool.query(
      `INSERT INTO symbols (
         symbol, exchange_code, company_name, asset_type, quote_currency,
         country_code, is_active, data_provider, provider_symbol
       )
       VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8)
       RETURNING id, symbol, exchange_code, company_name, asset_type,
                 quote_currency, country_code, is_active, created_at`,
      [
        input.symbol,
        input.exchangeCode,
        input.companyName,
        input.assetType,
        input.quoteCurrency,
        input.countryCode ?? null,
        input.dataProvider,
        input.providerSymbol,
      ],
    );
    return result.rows[0];
  }

  async recordQuote(
    symbolId: string,
    input: {
      price: string;
      open: string;
      high: string;
      low: string;
      previousClose: string;
      change: string;
      changePercent: string;
      volume: number;
      currency: string;
      quoteStatus: 'REALTIME' | 'DELAYED' | 'SIMULATED';
      source: string;
      observedAt?: string;
    },
  ) {
    const result = await this.pool.query(
      `INSERT INTO market_quotes (
         symbol_id, price, currency, quote_status, source, observed_at,
         open_price, high_price, low_price, previous_close,
         change_amount, change_percent, volume
       )
       SELECT id, $2, $9, $10, $11, COALESCE($12::timestamptz, now()),
              $3, $4, $5, $6, $7, $8, $13
       FROM symbols
       WHERE id = $1 AND is_active AND quote_currency = $9
       RETURNING id, symbol_id, price::text, currency, quote_status, source, observed_at,
                 open_price::text, high_price::text, low_price::text,
                 previous_close::text, change_amount::text, change_percent::text, volume`,
      [
        symbolId,
        input.price,
        input.open,
        input.high,
        input.low,
        input.previousClose,
        input.change,
        input.changePercent,
        input.currency,
        input.quoteStatus,
        input.source,
        input.observedAt ?? null,
        input.volume,
      ],
    );
    if (!result.rowCount) throw notFound('Active symbol with matching quote currency');
    return result.rows[0];
  }
}

export class WatchlistRepository {
  constructor(private readonly pool: Pool) {}

  async list(userId: string) {
    const result = await this.pool.query(
      `SELECT w.id, w.name, w.created_at, w.updated_at,
              COALESCE(
                jsonb_agg(jsonb_build_object(
                  'id', wi.id, 'symbolId', s.id, 'symbol', s.symbol,
                  'companyName', s.company_name, 'sortOrder', wi.sort_order
                ) ORDER BY wi.sort_order) FILTER (WHERE wi.id IS NOT NULL),
                '[]'::jsonb
              ) AS items
       FROM watchlists w
       LEFT JOIN watchlist_items wi ON wi.watchlist_id = w.id
       LEFT JOIN symbols s ON s.id = wi.symbol_id
       WHERE w.user_id = $1
       GROUP BY w.id
       ORDER BY w.created_at`,
      [userId],
    );
    return result.rows;
  }

  async create(userId: string, name: string) {
    const result = await this.pool.query(
      `INSERT INTO watchlists (user_id, name)
       VALUES ($1, $2)
       RETURNING id, name, created_at, updated_at`,
      [userId, name],
    );
    return result.rows[0];
  }

  async rename(userId: string, watchlistId: string, name: string) {
    const result = await this.pool.query(
      `UPDATE watchlists SET name = $3
       WHERE id = $1 AND user_id = $2
       RETURNING id, name, created_at, updated_at`,
      [watchlistId, userId, name],
    );
    if (!result.rowCount) throw notFound('Watchlist');
    return result.rows[0];
  }

  async delete(userId: string, watchlistId: string) {
    const result = await this.pool.query(`DELETE FROM watchlists WHERE id = $1 AND user_id = $2`, [
      watchlistId,
      userId,
    ]);
    if (!result.rowCount) throw notFound('Watchlist');
  }

  async addSymbol(userId: string, watchlistId: string, symbolId: string) {
    const result = await this.pool.query(
      `INSERT INTO watchlist_items (watchlist_id, symbol_id, sort_order)
       SELECT w.id, s.id,
              COALESCE((SELECT max(sort_order) + 1 FROM watchlist_items WHERE watchlist_id = w.id), 0)
       FROM watchlists w
       JOIN symbols s ON s.id = $3 AND s.is_active
       WHERE w.id = $1 AND w.user_id = $2
       RETURNING id, watchlist_id, symbol_id, sort_order, created_at`,
      [watchlistId, userId, symbolId],
    );
    if (!result.rowCount) throw notFound('Watchlist or active symbol');
    return result.rows[0];
  }

  async removeSymbol(userId: string, watchlistId: string, symbolId: string) {
    const result = await this.pool.query(
      `DELETE FROM watchlist_items wi
       USING watchlists w
       WHERE wi.watchlist_id = w.id AND wi.watchlist_id = $1
         AND w.user_id = $2 AND wi.symbol_id = $3`,
      [watchlistId, userId, symbolId],
    );
    if (!result.rowCount) throw notFound('Watchlist item');
  }
}

export class TradingRepository {
  constructor(private readonly pool: Pool) {}

  async listOrders(userId: string, page: PageQuery) {
    const result = await this.pool.query(
      `SELECT o.id, o.portfolio_id, s.symbol, o.side, o.status,
              o.quantity::text, o.filled_quantity::text, o.average_fill_price::text,
              o.submitted_at, o.completed_at
       FROM orders o
       JOIN accounts a ON a.id = o.account_id
       JOIN symbols s ON s.id = o.symbol_id
       WHERE a.user_id = $1
       ORDER BY o.submitted_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, page.limit, page.offset],
    );
    return result.rows;
  }

  async createMarketOrder(userId: string, input: SubmitOrder) {
    let created = false;
    const order = await inTransaction(this.pool, async (client) => {
      const accountResult = await client.query<{
        id: string;
        base_currency: string;
        portfolio_id: string;
        wallet_id: string;
        balance: string;
      }>(
        `SELECT a.id, a.base_currency, p.id AS portfolio_id,
                w.id AS wallet_id, w.balance::text AS balance
         FROM accounts a
         JOIN portfolios p ON p.account_id = a.id
         JOIN wallets w ON w.account_id = a.id AND w.currency = a.base_currency
         WHERE a.user_id = $1 AND a.account_type = 'PAPER'
           AND ($2::uuid IS NULL OR p.id = $2)
         ORDER BY a.created_at, p.created_at
         LIMIT 1
         FOR UPDATE OF a, w`,
        [userId, input.portfolioId ?? null],
      );
      const account = accountResult.rows[0];
      if (!account) throw notFound('Paper account or portfolio');

      const existing = await client.query(
        `SELECT o.id, s.symbol, o.side, o.status, o.quantity::text,
                o.portfolio_id, o.filled_quantity::text, o.average_fill_price::text,
                o.submitted_at, o.completed_at,
                (o.symbol_id = $3 AND o.side = $4 AND o.quantity = $5::numeric
                  AND ($6::uuid IS NULL OR o.portfolio_id = $6)) AS same_request
         FROM orders o
         JOIN symbols s ON s.id = o.symbol_id
         WHERE o.account_id = $1 AND o.idempotency_key = $2`,
        [
          account.id,
          input.idempotencyKey,
          input.symbolId,
          input.side,
          input.quantity,
          input.portfolioId ?? null,
        ],
      );
      if (existing.rowCount) {
        if (!existing.rows[0]!.same_request) {
          throw new ApiError(
            409,
            'IDEMPOTENCY_KEY_REUSED',
            'This idempotency key was already used for a different order',
          );
        }
        return existing.rows[0];
      }

      const symbolResult = await client.query<{ id: string; quote_currency: string }>(
        `SELECT id, quote_currency FROM symbols WHERE id = $1 AND is_active`,
        [input.symbolId],
      );
      const symbol = symbolResult.rows[0];
      if (!symbol) throw notFound('Active symbol');
      if (symbol.quote_currency !== account.base_currency) {
        throw new ApiError(
          422,
          'CURRENCY_MISMATCH',
          'Currency conversion is not enabled for this paper account',
        );
      }

      const quoteResult = await client.query<{ price: string; observed_at: Date }>(
        `SELECT price::text, observed_at
         FROM market_quotes
         WHERE symbol_id = $1 AND quote_status <> 'STALE'
           AND observed_at >= now() - interval '5 minutes'
         ORDER BY observed_at DESC
         LIMIT 1`,
        [symbol.id],
      );
      const quote = quoteResult.rows[0];
      if (!quote) {
        throw new ApiError(
          503,
          'QUOTE_UNAVAILABLE',
          'A fresh market quote is unavailable; no order was submitted',
        );
      }
      const totalResult = await client.query<{ total: string }>(
        `SELECT round($1::numeric * $2::numeric, 4)::text AS total`,
        [quote.price, input.quantity],
      );
      const total = totalResult.rows[0]!.total;
      const positive = await client.query<{ positive: boolean }>(
        `SELECT $1::numeric > 0 AS positive`,
        [total],
      );
      if (!positive.rows[0]!.positive) {
        throw new ApiError(
          422,
          'ORDER_VALUE_TOO_SMALL',
          'Order value rounds below the minimum ledger precision',
        );
      }

      if (input.side === 'BUY') {
        const updatedWallet = await client.query(
          `UPDATE wallets SET balance = balance - $2::numeric, updated_at = now()
           WHERE id = $1 AND balance >= $2::numeric`,
          [account.wallet_id, total],
        );
        if (!updatedWallet.rowCount) {
          throw new ApiError(
            409,
            'INSUFFICIENT_VIRTUAL_CASH',
            'Insufficient virtual cash for this paper order',
          );
        }
      } else {
        const position = await client.query<{ enough: boolean }>(
          `SELECT quantity >= $3::numeric AS enough
           FROM positions
           WHERE portfolio_id = $1 AND symbol_id = $2
           FOR UPDATE`,
          [account.portfolio_id, symbol.id, input.quantity],
        );
        if (!position.rowCount || !position.rows[0]!.enough) {
          throw new ApiError(
            409,
            'INSUFFICIENT_POSITION',
            'Insufficient paper position quantity to sell',
          );
        }
        await client.query(
          `UPDATE wallets SET balance = balance + $2::numeric, updated_at = now()
           WHERE id = $1`,
          [account.wallet_id, total],
        );
      }

      const orderResult = await client.query<{ id: string }>(
        `INSERT INTO orders (
           account_id, portfolio_id, symbol_id, side, status, quantity,
           filled_quantity, idempotency_key
         )
         VALUES ($1, $2, $3, $4, 'PENDING', $5, 0, $6)
         RETURNING id`,
        [
          account.id,
          account.portfolio_id,
          symbol.id,
          input.side,
          input.quantity,
          input.idempotencyKey,
        ],
      );
      const orderId = orderResult.rows[0]!.id;
      const tradeResult = await client.query<{ id: string }>(
        `INSERT INTO trades (order_id, symbol_id, side, quantity, price, currency, execution_reference)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          orderId,
          symbol.id,
          input.side,
          input.quantity,
          quote.price,
          account.base_currency,
          orderId,
        ],
      );
      const tradeId = tradeResult.rows[0]!.id;

      if (input.side === 'BUY') {
        await client.query(
          `INSERT INTO positions (portfolio_id, symbol_id, quantity, average_cost)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (portfolio_id, symbol_id) DO UPDATE
           SET average_cost = (
                 positions.quantity * positions.average_cost
                 + EXCLUDED.quantity * EXCLUDED.average_cost
               ) / (positions.quantity + EXCLUDED.quantity),
               quantity = positions.quantity + EXCLUDED.quantity,
               updated_at = now()`,
          [account.portfolio_id, symbol.id, input.quantity, quote.price],
        );
      } else {
        const updatedPosition = await client.query(
          `UPDATE positions
           SET realized_pnl = realized_pnl
                 + (($3::numeric - average_cost) * $4::numeric)::numeric(20, 4),
               quantity = quantity - $4::numeric,
               average_cost = CASE WHEN quantity = $4::numeric THEN 0 ELSE average_cost END,
               updated_at = now()
           WHERE portfolio_id = $1 AND symbol_id = $2 AND quantity >= $4::numeric`,
          [account.portfolio_id, symbol.id, quote.price, input.quantity],
        );
        if (!updatedPosition.rowCount) {
          throw new ApiError(
            409,
            'INSUFFICIENT_POSITION',
            'Insufficient paper position quantity to sell',
          );
        }
      }

      const signedAmount = input.side === 'BUY' ? `-${total}` : total;
      await client.query(
        `INSERT INTO transactions (
           account_id, wallet_id, order_id, trade_id, transaction_type,
           amount, currency, idempotency_key, description
         )
         VALUES ($1, $2, $3, $4, $5, $6::numeric, $7, $8, $9)`,
        [
          account.id,
          account.wallet_id,
          orderId,
          tradeId,
          input.side,
          signedAmount,
          account.base_currency,
          `order:${input.idempotencyKey}`,
          `Simulated paper ${input.side.toLowerCase()} execution`,
        ],
      );
      const result = await client.query(
        `UPDATE orders
         SET status = 'FILLED', filled_quantity = quantity,
             average_fill_price = $2, completed_at = now()
         WHERE id = $1
         RETURNING id, portfolio_id, side, status, quantity::text,
                   filled_quantity::text, average_fill_price::text,
                   submitted_at, completed_at`,
        [orderId, quote.price],
      );
      created = true;
      return {
        ...result.rows[0],
        symbol: (
          await client.query<{ symbol: string }>(`SELECT symbol FROM symbols WHERE id = $1`, [
            symbol.id,
          ])
        ).rows[0]!.symbol,
      };
    });
    emitMetrics({ TradesExecuted: { value: Number(created), unit: 'Count' } }, 'trading');
    return order;
  }

  async cancelOrder(userId: string, orderId: string) {
    const result = await this.pool.query(
      `UPDATE orders o
       SET status = 'CANCELLED', completed_at = now()
       FROM accounts a
       WHERE o.account_id = a.id AND a.user_id = $1 AND o.id = $2
         AND o.status IN ('PENDING', 'PARTIALLY_FILLED')
       RETURNING o.id, o.status, o.completed_at`,
      [userId, orderId],
    );
    if (!result.rowCount) throw notFound('Cancelable order');
    return result.rows[0];
  }

  async listTrades(userId: string, page: PageQuery) {
    const result = await this.pool.query(
      `SELECT t.id, t.order_id, s.symbol, t.side, t.quantity::text,
              t.price::text, t.currency, t.executed_at
       FROM trades t
       JOIN orders o ON o.id = t.order_id
       JOIN accounts a ON a.id = o.account_id
       JOIN symbols s ON s.id = t.symbol_id
       WHERE a.user_id = $1
       ORDER BY t.executed_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, page.limit, page.offset],
    );
    return result.rows;
  }

  async portfolio(userId: string) {
    const result = await this.pool.query(
      `SELECT p.id AS portfolio_id, p.name, p.base_currency,
              w.balance::text AS cash_balance,
              COALESCE(sum(pos.quantity * q.price), 0)::text AS market_value,
              COALESCE(sum(pos.quantity * pos.average_cost), 0)::text AS cost_basis,
              COALESCE(max(realized.realized_pnl), 0)::text AS realized_pnl,
              (w.balance + COALESCE(sum(pos.quantity * q.price), 0))::text AS total_value,
              COALESCE(
                sum(pos.quantity * (q.price - pos.average_cost)),
                0
              )::text AS unrealized_pnl,
              COALESCE(array_agg(DISTINCT s.symbol) FILTER (
                WHERE pos.id IS NOT NULL AND (q.price IS NULL OR q.currency <> p.base_currency)
              ), ARRAY[]::text[]) AS unavailable_symbols,
              COALESCE(jsonb_agg(jsonb_build_object(
                'symbolId', s.id, 'symbol', s.symbol, 'companyName', s.company_name,
                'quantity', pos.quantity::text, 'averageCost', pos.average_cost::text,
                'lastPrice', q.price::text,
                'marketValue', (pos.quantity * q.price)::text,
                'unrealizedPnl', (pos.quantity * (q.price - pos.average_cost))::text
              ) ORDER BY s.symbol) FILTER (WHERE pos.id IS NOT NULL), '[]'::jsonb) AS positions
       FROM accounts a
       JOIN portfolios p ON p.account_id = a.id
       JOIN wallets w ON w.account_id = a.id AND w.currency = a.base_currency
       LEFT JOIN positions pos ON pos.portfolio_id = p.id AND pos.quantity > 0
       LEFT JOIN symbols s ON s.id = pos.symbol_id
       LEFT JOIN LATERAL (
         SELECT sum(all_positions.realized_pnl) AS realized_pnl
         FROM positions all_positions WHERE all_positions.portfolio_id = p.id
       ) realized ON true
       LEFT JOIN LATERAL (
         SELECT price, currency FROM market_quotes
         WHERE symbol_id = pos.symbol_id AND quote_status <> 'STALE'
         ORDER BY observed_at DESC LIMIT 1
       ) q ON true
       WHERE a.user_id = $1
       GROUP BY p.id, w.balance
       ORDER BY p.created_at`,
      [userId],
    );
    if (result.rows.some((row) => row.unavailable_symbols?.length)) {
      throw new ApiError(
        503,
        'PORTFOLIO_VALUATION_UNAVAILABLE',
        'Portfolio valuation is unavailable for missing quotes or unsupported currency conversion',
      );
    }
    return result.rows.map(({ unavailable_symbols: _unavailable, ...portfolio }) => portfolio);
  }

  async transactions(userId: string, page: PageQuery) {
    const result = await this.pool.query(
      `SELECT t.id, t.transaction_type, t.amount::text, t.currency,
              t.description, t.order_id, t.trade_id, t.created_at
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       WHERE a.user_id = $1
       ORDER BY t.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, page.limit, page.offset],
    );
    return result.rows;
  }
}

export class AlertRepository {
  constructor(private readonly pool: Pool) {}

  async list(userId: string) {
    const result = await this.pool.query(
      `SELECT a.id, s.symbol, a.condition, a.target_price::text, a.target_change_percent::text, a.channels, a.currency,
              a.status, a.triggered_price::text, a.triggered_at, a.created_at
       FROM price_alerts a
       JOIN symbols s ON s.id = a.symbol_id
       WHERE a.user_id = $1
       ORDER BY a.created_at DESC`,
      [userId],
    );
    return result.rows;
  }

  async create(userId: string, input: import('../alerts/alert-engine.js').AlertInput) {
    const result = await this.pool.query(
      `INSERT INTO price_alerts (user_id, symbol_id, condition, target_price, currency,target_change_percent,channels)
       SELECT $1::uuid, id, $3::text, $4::numeric, $5::varchar(3),$6::numeric,$7::notification_channel[]
       FROM symbols WHERE id = $2 AND is_active AND quote_currency=$5::varchar(3)
       RETURNING id, symbol_id, condition, target_price::text,target_change_percent::text,channels, currency, status, created_at`,
      [
        userId,
        input.symbolId,
        input.condition,
        input.targetPrice ?? null,
        input.currency,
        input.targetChangePercent ?? null,
        input.channels,
      ],
    );
    if (!result.rowCount) throw notFound('Active symbol');
    return result.rows[0];
  }

  async updateStatus(userId: string, alertId: string, status: 'ACTIVE' | 'PAUSED' | 'CANCELLED') {
    const result = await this.pool.query(
      `UPDATE price_alerts SET status = $3
       WHERE id = $1 AND user_id = $2 AND status IN ('ACTIVE','PAUSED')
       RETURNING id, status, updated_at`,
      [alertId, userId, status],
    );
    if (!result.rowCount) throw notFound('Editable price alert');
    return result.rows[0];
  }
}

export class NotificationRepository {
  constructor(private readonly pool: Pool) {}

  async list(userId: string, page: PageQuery) {
    const result = await this.pool.query(
      `SELECT id, channel, status, notification_type, title, body, payload,
              read_at, created_at
       FROM notifications WHERE user_id = $1
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [userId, page.limit, page.offset],
    );
    return result.rows;
  }

  async markRead(userId: string, notificationId: string) {
    const result = await this.pool.query(
      `UPDATE notifications SET status = 'READ', read_at = now()
       WHERE id = $1 AND user_id = $2
       RETURNING id, status, read_at`,
      [notificationId, userId],
    );
    if (!result.rowCount) throw notFound('Notification');
    return result.rows[0];
  }
}

export class ResearchRepository {
  constructor(private readonly pool: Pool) {}

  async list(userId: string, page: PageQuery) {
    const result = await this.pool.query(
      `SELECT r.id, r.research_type, r.question, r.response, r.provider,
              r.model_name, r.source_references, r.generated_at, s.symbol
       FROM ai_research r
       LEFT JOIN symbols s ON s.id = r.symbol_id
       WHERE r.user_id = $1 AND (r.retention_until IS NULL OR r.retention_until > now())
       ORDER BY r.generated_at DESC LIMIT $2 OFFSET $3`,
      [userId, page.limit, page.offset],
    );
    return result.rows;
  }

  async newsSentiment(symbol: string | undefined, page: PageQuery) {
    const result = await this.pool.query(
      `SELECT a.id AS article_id, a.headline, a.canonical_url, a.published_at,
              s.symbol, ns.label, ns.score::text, ns.confidence::text, ns.analyzed_at
       FROM news_sentiment ns
       JOIN news_articles a ON a.id = ns.article_id
       LEFT JOIN symbols s ON s.id = ns.symbol_id
       WHERE ($1::text IS NULL OR upper(s.symbol) = upper($1))
       ORDER BY ns.analyzed_at DESC LIMIT $2 OFFSET $3`,
      [symbol ?? null, page.limit, page.offset],
    );
    return result.rows;
  }

  async marketSummary() {
    const result = await this.pool.query(
      `SELECT count(DISTINCT ns.symbol_id)::int AS covered_symbols,
              count(*)::int AS analyzed_articles,
              count(*) FILTER (WHERE ns.label = 'POSITIVE')::int AS positive_articles,
              count(*) FILTER (WHERE ns.label = 'NEUTRAL')::int AS neutral_articles,
              count(*) FILTER (WHERE ns.label = 'NEGATIVE')::int AS negative_articles,
              COALESCE(avg(ns.score), 0)::text AS average_sentiment,
              max(ns.analyzed_at) AS analyzed_at
       FROM news_sentiment ns
       WHERE ns.analyzed_at >= now() - interval '24 hours'`,
    );
    return result.rows[0];
  }
}
