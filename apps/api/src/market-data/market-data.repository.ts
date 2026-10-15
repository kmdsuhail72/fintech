import { notFound } from '../utils/errors.js';
import type { Pool } from 'pg';
import type { MarketInstrument, MarketQuote } from './types.js';

export class MarketDataRepository {
  constructor(private readonly pool: Pool) {}

  async listProviderInstruments(providerName: string) {
    const result = await this.pool.query<{
      id: string;
      symbol: string;
      quote_currency: string;
      price: string;
      observed_at: Date;
      open_price: string;
      high_price: string;
      low_price: string;
      previous_close: string;
      change_amount: string;
      change_percent: string;
      volume: string;
      quote_status: MarketQuote['quoteStatus'];
      source: string;
    }>(
      `SELECT s.id, s.symbol, s.quote_currency, q.price::text, q.observed_at,
              q.open_price::text, q.high_price::text, q.low_price::text,
              q.previous_close::text, q.change_amount::text,
              q.change_percent::text, q.volume::text, q.quote_status, q.source
       FROM symbols s
       JOIN LATERAL (
         SELECT price, observed_at, open_price, high_price, low_price,
                previous_close, change_amount, change_percent, volume, quote_status, source
         FROM market_quotes
         WHERE symbol_id = s.id
         ORDER BY observed_at DESC
         LIMIT 1
       ) q ON true
       WHERE s.is_active AND s.data_provider = $1
       ORDER BY s.symbol`,
      [providerName],
    );
    return result.rows.map((row) => {
      const initialQuote: MarketQuote = {
        symbolId: row.id,
        symbol: row.symbol,
        currency: row.quote_currency,
        price: row.price,
        open: row.open_price,
        high: row.high_price,
        low: row.low_price,
        previousClose: row.previous_close,
        change: row.change_amount,
        changePercent: row.change_percent,
        volume: Number(row.volume),
        timestamp: row.observed_at.toISOString(),
        quoteStatus: row.quote_status,
        source: row.source,
      };
      return {
        id: row.id,
        symbol: row.symbol,
        quoteCurrency: row.quote_currency,
        latestQuote: initialQuote,
      };
    }) satisfies MarketInstrument[];
  }

  async quoteBySymbol(symbol: string) {
    const result = await this.pool.query<{
      symbol_id: string;
      symbol: string;
      price: string;
      open_price: string;
      high_price: string;
      low_price: string;
      previous_close: string;
      change_amount: string;
      change_percent: string;
      volume: string;
      currency: string;
      quote_status: MarketQuote['quoteStatus'];
      source: string;
      observed_at: Date;
    }>(
      `SELECT s.id AS symbol_id, s.symbol, q.price::text, q.open_price::text,
              q.high_price::text, q.low_price::text, q.previous_close::text,
              q.change_amount::text, q.change_percent::text, q.volume::text,
              q.currency, q.quote_status, q.source, q.observed_at
       FROM symbols s
       JOIN LATERAL (
         SELECT * FROM market_quotes WHERE symbol_id = s.id
         ORDER BY observed_at DESC LIMIT 1
       ) q ON true
       WHERE s.is_active AND upper(s.symbol) = upper($1)`,
      [symbol],
    );
    const row = result.rows[0];
    return row
      ? ({
          symbolId: row.symbol_id,
          symbol: row.symbol,
          currency: row.currency,
          price: row.price,
          open: row.open_price,
          high: row.high_price,
          low: row.low_price,
          previousClose: row.previous_close,
          change: row.change_amount,
          changePercent: row.change_percent,
          volume: Number(row.volume),
          timestamp: row.observed_at.toISOString(),
          quoteStatus: row.quote_status,
          source: row.source,
        } satisfies MarketQuote)
      : null;
  }

  async persistQuote(quote: MarketQuote, currency: string) {
    await this.pool.query(
      `INSERT INTO market_quotes (
         symbol_id, price, currency, quote_status, source, observed_at,
         open_price, high_price, low_price, previous_close,
         change_amount, change_percent, volume
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        quote.symbolId,
        quote.price,
        currency,
        quote.quoteStatus,
        quote.source,
        quote.timestamp,
        quote.open,
        quote.high,
        quote.low,
        quote.previousClose,
        quote.change,
        quote.changePercent,
        quote.volume,
      ],
    );
  }

  async history(symbol: string, limit: number, offset: number) {
    const result = await this.pool.query<{
      symbol_id: string;
      symbol: string;
      price: string;
      open_price: string;
      high_price: string;
      low_price: string;
      previous_close: string;
      change_amount: string;
      change_percent: string;
      volume: string;
      quote_status: MarketQuote['quoteStatus'];
      source: string;
      observed_at: Date;
      currency: string;
    }>(
      `SELECT s.id AS symbol_id, s.symbol, q.price::text, q.open_price::text,
              q.high_price::text, q.low_price::text, q.previous_close::text,
              q.change_amount::text, q.change_percent::text, q.volume::text,
              q.quote_status, q.source, q.observed_at, q.currency
       FROM market_quotes q
       JOIN symbols s ON s.id = q.symbol_id
       WHERE s.is_active AND upper(s.symbol) = upper($1)
       ORDER BY q.observed_at DESC
       LIMIT $2 OFFSET $3`,
      [symbol, limit, offset],
    );
    return result.rows.map(
      (row) =>
        ({
          symbolId: row.symbol_id,
          symbol: row.symbol,
          currency: row.currency,
          price: row.price,
          open: row.open_price,
          high: row.high_price,
          low: row.low_price,
          previousClose: row.previous_close,
          change: row.change_amount,
          changePercent: row.change_percent,
          volume: Number(row.volume),
          timestamp: row.observed_at.toISOString(),
          quoteStatus: row.quote_status,
          source: row.source,
        }) satisfies MarketQuote,
    );
  }
  async candles(symbol: string, interval: string, limit: number) {
    const durations: Record<string, string> = {
      '1m': '1 minute',
      '5m': '5 minutes',
      '15m': '15 minutes',
      '1h': '1 hour',
      '1d': '1 day',
    };
    const duration = durations[interval];
    if (!duration) throw new Error('Unsupported candle interval');
    const instrument = await this.pool.query(
      'SELECT id FROM symbols WHERE is_active AND upper(symbol) = upper($1) LIMIT 1',
      [symbol],
    );
    if (!instrument.rowCount) throw notFound('Symbol');
    const result = await this.pool.query<{
      timestamp: Date;
      open: string;
      high: string;
      low: string;
      close: string;
      samples: number;
      volume: string | null;
    }>(
      `WITH window_start AS (
         SELECT date_bin($2::interval, now(), '2000-01-01'::timestamptz) - ($3 - 1) * $2::interval AS start_time
       ), source AS (
         SELECT q.id, q.observed_at, q.price, q.volume
         FROM market_quotes q
         WHERE q.symbol_id = $1::uuid AND q.observed_at >= (SELECT start_time FROM window_start) AND q.observed_at <= now()
         UNION ALL
         (SELECT q.id, q.observed_at, q.price, q.volume FROM market_quotes q
          WHERE q.symbol_id = $1::uuid AND q.observed_at < (SELECT start_time FROM window_start)
          ORDER BY q.observed_at DESC, q.id DESC LIMIT 1)
       ), deltas AS (
         SELECT *, lag(volume) OVER (ORDER BY observed_at, id) AS previous_volume,
                   lag(observed_at) OVER (ORDER BY observed_at, id) AS previous_time
         FROM source
       ), observations AS (
         SELECT *, date_bin($2::interval, observed_at, '2000-01-01'::timestamptz) AS bucket,
           CASE WHEN previous_time IS NOT NULL AND (previous_time AT TIME ZONE 'UTC')::date = (observed_at AT TIME ZONE 'UTC')::date
                THEN CASE WHEN volume >= previous_volume THEN volume - previous_volume ELSE NULL END
                WHEN date_bin($2::interval, observed_at, '2000-01-01'::timestamptz) = (date_trunc('day', observed_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') THEN volume
                ELSE NULL END AS volume_delta
         FROM deltas WHERE observed_at >= (SELECT start_time FROM window_start)
       ), bars AS (
         SELECT bucket AS timestamp,
                (array_agg(price ORDER BY observed_at, id))[1]::text AS open,
                max(price)::text AS high, min(price)::text AS low,
                (array_agg(price ORDER BY observed_at DESC, id DESC))[1]::text AS close,
                count(*)::int AS samples,
                CASE WHEN count(volume_delta) = count(*) THEN sum(volume_delta)::text ELSE NULL END AS volume
         FROM observations GROUP BY bucket
       ) SELECT * FROM bars ORDER BY timestamp ASC`,
      [instrument.rows[0]!.id, duration, limit],
    );
    return result.rows.map((row) => ({ ...row, timestamp: row.timestamp.toISOString() }));
  }
}
