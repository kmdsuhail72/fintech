import { createHash, randomUUID } from 'node:crypto';
import type { createClient } from 'redis';
import { AlertEngine, alertQuoteSchema } from './alert-engine.js';
import type { MarketQuote } from '../market-data/types.js';
import { logger } from '../utils/logger.js';

type Redis = ReturnType<typeof createClient>;
export const ALERT_PARTITIONS = 16;
export const ALERT_GROUP = 'price-alerts-v1';
export const streamKey = (partition: number) => `alerts:quotes:{${partition}}`;
export const quotePartition = (symbolId: string) =>
  createHash('sha256').update(symbolId).digest().readUInt32BE(0) % ALERT_PARTITIONS;

export async function publishAlertQuote(redis: Redis, quote: MarketQuote) {
  // No MAXLEN truncation: never delete events that have not been evaluated.
  await redis.xAdd(streamKey(quotePartition(quote.symbolId)), '*', {
    quote: JSON.stringify(quote),
  });
}

export class AlertStreamWorker {
  private running = false;
  private task?: Promise<void>;
  private readonly consumer = randomUUID();
  private readonly claimCursors = new Map<number, string>();
  constructor(
    private readonly redis: Redis,
    private readonly engine: AlertEngine,
    private readonly partitions: number[] = Array.from(
      { length: ALERT_PARTITIONS },
      (_, index) => index,
    ),
  ) {}
  async start() {
    if (this.running) return;
    for (const partition of this.partitions) {
      try {
        await this.redis.xGroupCreate(streamKey(partition), ALERT_GROUP, '0', { MKSTREAM: true });
      } catch (error) {
        if (!(error instanceof Error && error.message.includes('BUSYGROUP'))) throw error;
      }
    }
    this.running = true;
    this.task = this.loop();
  }
  async stop() {
    this.running = false;
    await this.task;
  }
  private async process(key: string, entry: { id: string; message: Record<string, string> }) {
    let payload: unknown;
    try {
      payload = JSON.parse(entry.message.quote ?? 'null');
    } catch {
      payload = null;
    }
    const parsed = alertQuoteSchema.safeParse(payload);
    if (!parsed.success) {
      // Preserve invalid events for inspection, without logging quote contents.
      await this.redis.xAdd(key + ':invalid', '*', { eventId: entry.id, reason: 'INVALID_QUOTE' });
    } else {
      while (this.running && (await this.engine.evaluate(parsed.data)) > 0) {
        // Keep the event pending until the entire threshold cohort commits.
        await this.redis.xClaim(key, ALERT_GROUP, this.consumer, 0, [entry.id]);
      }
      if (!this.running) return;
    }
    await this.redis.eval(
      `redis.call('XACK',KEYS[1],ARGV[1],ARGV[2]); return redis.call('XDEL',KEYS[1],ARGV[2])`,
      { keys: [key], arguments: [ALERT_GROUP, entry.id] },
    ); // One consumer group by contract.
  }
  private async shard(partition: number) {
    const key = streamKey(partition);
    const recovered = await this.redis.xAutoClaim(
      key,
      ALERT_GROUP,
      this.consumer,
      180_000,
      this.claimCursors.get(partition) ?? '0-0',
      { COUNT: 10 },
    );
    this.claimCursors.set(partition, recovered.nextId);
    for (const entry of recovered.messages) if (entry) await this.process(key, entry);
    const fresh = await this.redis.xReadGroup(
      ALERT_GROUP,
      this.consumer,
      { key, id: '>' },
      { COUNT: 10 },
    );
    for (const batch of fresh ?? [])
      for (const entry of batch.messages) await this.process(key, entry);
  }
  private async loop() {
    while (this.running) {
      // Each XREADGROUP targets one key, so this layout can migrate to Redis Cluster.
      const outcomes = await Promise.allSettled(
        this.partitions.map((partition) => this.shard(partition)),
      );
      for (const result of outcomes)
        if (result.status === 'rejected')
          logger.error('Alert stream processing failed', {
            type: result.reason instanceof Error ? result.reason.name : 'unknown',
          });
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}
