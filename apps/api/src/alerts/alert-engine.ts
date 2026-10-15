import type { Pool } from 'pg';
import { z } from 'zod';
import { alertTriggers } from '../utils/prometheus.js';
import type { MarketQuote } from '../market-data/types.js';

const decimal = z
  .string()
  .regex(/^-?\d+(?:\.\d{1,8})?$/)
  .refine((v) => Number.isFinite(Number(v)));
export const alertQuoteSchema = z.object({
  symbolId: z.string().uuid(),
  symbol: z.string().min(1).max(24),
  currency: z.string().regex(/^[A-Z]{3}$/),
  price: decimal.refine((v) => Number(v) > 0 && Number(v) < 1e12),
  previousClose: decimal.refine((v) => Number(v) > 0 && Number(v) < 1e12),
  timestamp: z.string().datetime({ offset: true }),
  quoteStatus: z.enum(['SIMULATED', 'DELAYED', 'REALTIME', 'STALE']),
  source: z.string().min(1).max(100),
});
export type AlertQuote = z.infer<typeof alertQuoteSchema>;
export type AlertInput = {
  symbolId: string;
  currency: string;
  condition: 'ABOVE' | 'BELOW' | 'CHANGE_PERCENT';
  targetPrice?: string;
  targetChangePercent?: string;
  channels: ('IN_APP' | 'EMAIL' | 'PUSH')[];
};

export function matchesAlert(alert: AlertInput, quote: AlertQuote) {
  if (
    quote.quoteStatus === 'STALE' ||
    alert.symbolId !== quote.symbolId ||
    alert.currency !== quote.currency
  )
    return false;
  const fixed = (value: string) => {
    const [whole, fraction = ''] = value.split('.');
    return BigInt(whole ?? '0') * 100_000_000n + BigInt(fraction.padEnd(8, '0'));
  };
  const price = fixed(quote.price);
  if (alert.condition === 'ABOVE') return price > fixed(alert.targetPrice!);
  if (alert.condition === 'BELOW') return price < fixed(alert.targetPrice!);
  const close = fixed(quote.previousClose);
  const difference = price > close ? price - close : close - price;
  return difference * 100n * 100_000_000n > fixed(alert.targetChangePercent!) * close;
}

export class AlertEngine {
  constructor(private readonly pool: Pool) {}
  async evaluate(input: MarketQuote | AlertQuote) {
    const quote = alertQuoteSchema.parse(input);
    if (quote.quoteStatus === 'STALE' || Date.parse(quote.timestamp) > Date.now() + 60_000)
      return 0;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout = '15s'");
      // Lock rather than SKIP LOCKED here: a rolled-back competing match must not lose an event.
      const result = await client.query<{ id: string; alert_id: string }>(
        `WITH candidates AS (
        SELECT id FROM price_alerts WHERE symbol_id=$1 AND currency=$2 AND status='ACTIVE'
          AND updated_at <= $5::timestamptz AND (
            (condition='ABOVE' AND target_price < $3::numeric) OR
            (condition='BELOW' AND target_price > $3::numeric) OR
            (condition='CHANGE_PERCENT' AND target_change_percent < abs(($3::numeric/$4::numeric-1)*100)))
        ORDER BY id LIMIT 500 FOR UPDATE
      ), triggered AS (
        UPDATE price_alerts a SET status='TRIGGERED', triggered_price=$3, triggered_at=$5
        FROM candidates c WHERE a.id=c.id AND a.status='ACTIVE'
        RETURNING a.*
      ) INSERT INTO notifications (user_id,channel,notification_type,title,body,payload,deduplication_key)
        SELECT t.user_id, channel, 'PRICE_ALERT', 'Asteriq price alert',
          $6 || ' met your ' || t.condition || ' threshold at ' || $3 || ' ' || $2 ||
          ' as of ' || $5::text ||
          CASE WHEN $7='SIMULATED' THEN ' (simulated market data).' WHEN $7='DELAYED' THEN ' (delayed market data).' ELSE '.' END,
          jsonb_build_object('alertId',t.id,'symbolId',$1::text,'symbol',$6::text,'price',$3::text,
            'currency',$2::text,'quoteStatus',$7::text,'source',$8::text,'observedAt',$5::text,
            'condition',t.condition,'targetPrice',t.target_price::text,'targetChangePercent',t.target_change_percent::text,
            'changePercent',(($3::numeric/$4::numeric-1)*100)::text,'screen','Alerts'),
          'price-alert:' || t.id || ':' || channel::text
        FROM triggered t CROSS JOIN LATERAL unnest(t.channels) channel
        ON CONFLICT (user_id,deduplication_key) DO NOTHING RETURNING id, payload->>'alertId' AS alert_id`,
        [
          quote.symbolId,
          quote.currency,
          quote.price,
          quote.previousClose,
          quote.timestamp,
          quote.symbol,
          quote.quoteStatus,
          quote.source,
        ],
      );
      const ids = result.rows.map((row) => row.id);
      if (ids.length) {
        await client.query(
          `INSERT INTO notification_outbox (notification_id,target_key)
          SELECT id,channel::text FROM notifications WHERE id=ANY($1::uuid[]) AND channel IN ('IN_APP','EMAIL')
          ON CONFLICT DO NOTHING`,
          [ids],
        );
        await client.query(
          `INSERT INTO notification_outbox (notification_id,target_key,device_id)
          SELECT n.id,d.id::text,d.id FROM notifications n JOIN notification_devices d ON d.user_id=n.user_id
          JOIN sessions s ON s.id=d.session_id
          WHERE n.id=ANY($1::uuid[]) AND n.channel='PUSH' AND s.revoked_at IS NULL
            AND s.expires_at>now() AND d.updated_at>=now()-interval '30 days'
          ON CONFLICT DO NOTHING`,
          [ids],
        );
        await client.query(
          `UPDATE notifications n SET status='FAILED' WHERE id=ANY($1::uuid[])
          AND channel='PUSH' AND NOT EXISTS (SELECT 1 FROM notification_outbox o WHERE o.notification_id=n.id)`,
          [ids],
        );
      }
      await client.query('COMMIT');
      alertTriggers.inc(new Set(result.rows.map((row) => row.alert_id)).size);
      // Number of channels is variable; use this only to decide whether to drain another batch.
      return ids.length;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
