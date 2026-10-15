import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { createClient } from 'redis';
import type { Server as SocketServer } from 'socket.io';
import { env } from '../config.js';
import { logger } from '../utils/logger.js';
import { ApiError, notFound } from '../utils/errors.js';
import { MarketDataRepository } from './market-data.repository.js';
import { SimulatedMarketDataProvider } from './simulator.provider.js';
import type { MarketDataProvider, MarketInstrument, MarketQuote } from './types.js';
import { publishAlertQuote } from '../alerts/quote-stream.js';

type RedisClient = ReturnType<typeof createClient>;

const cacheKey = (symbolId: string) => `market:quote:${symbolId}`;
const historyMarkerKey = (symbolId: string) => `market:history:last:${symbolId}`;
const simulationLockKey = 'market:simulator:tick-lock';
const subscriberKey = (symbolId: string) => `market:subscribers:${symbolId}`;
const SUBSCRIBER_LEASE_MS = 45_000;
const compareAndDeleteLock = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
  end
  return 0
`;

export class MarketDataService {
  private readonly repository: MarketDataRepository;
  private timer: NodeJS.Timeout | undefined;
  private inFlight = false;

  constructor(
    pool: Pool,
    private readonly redis: RedisClient,
    private readonly getIO: () => SocketServer | undefined,
    private readonly provider: MarketDataProvider = new SimulatedMarketDataProvider(),
  ) {
    this.repository = new MarketDataRepository(pool);
  }

  start() {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), env.MARKET_SIMULATION_INTERVAL_MS);
    this.timer.unref();
    logger.info('Market data simulator started', {
      provider: this.provider.name,
      intervalMs: env.MARKET_SIMULATION_INTERVAL_MS,
      historyIntervalMs: env.MARKET_HISTORY_INTERVAL_MS,
    });
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    while (this.inFlight) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  async snapshot(symbol: string): Promise<MarketQuote> {
    const instruments = await this.repository.listProviderInstruments(this.provider.name);
    const instrument = instruments.find(
      (entry) => entry.symbol.toUpperCase() === symbol.toUpperCase(),
    );
    if (!instrument) {
      const row = await this.repository.quoteBySymbol(symbol);
      if (!row) throw notFound('Market quote');
      return row;
    }
    const quote =
      (await this.cachedQuote(instrument)) ?? (await this.repository.quoteBySymbol(symbol));
    if (!quote) throw notFound('Market quote');
    return quote;
  }

  async snapshots(symbols: string[]) {
    const unique = [...new Set(symbols.map((symbol) => symbol.toUpperCase()))];
    const instruments = await this.repository.listProviderInstruments(this.provider.name);
    const bySymbol = new Map(
      instruments.map((instrument) => [instrument.symbol.toUpperCase(), instrument]),
    );
    const cached = await this.redis.mGet(
      unique.map((symbol) => {
        const instrument = bySymbol.get(symbol);
        return instrument ? cacheKey(instrument.id) : `market:quote:symbol:${symbol}`;
      }),
    );
    const quotes = await Promise.all(
      unique.map(async (symbol, index) => {
        const cache = cached[index];
        if (cache) return JSON.parse(cache) as MarketQuote;
        const quote = await this.repository.quoteBySymbol(symbol);
        if (!quote) throw notFound(`Market quote for ${symbol}`);
        return quote;
      }),
    );
    return quotes;
  }

  async history(symbol: string, limit: number, offset: number) {
    const rows = await this.repository.history(symbol, limit, offset);
    if (!rows.length && !(await this.repository.quoteBySymbol(symbol))) throw notFound('Symbol');
    return rows;
  }

  async recordProviderQuote(quote: MarketQuote) {
    const instrument = (await this.repository.listProviderInstruments(this.provider.name)).find(
      (candidate) => candidate.id === quote.symbolId,
    );
    if (!instrument) throw notFound('Market instrument');
    if (quote.currency !== instrument.quoteCurrency) {
      throw new ApiError(
        422,
        'CURRENCY_MISMATCH',
        'Quote currency does not match the market instrument',
      );
    }
    const normalized = { ...quote, symbolId: instrument.id, symbol: instrument.symbol };
    await this.writeQuote(instrument, normalized, true);
    return normalized;
  }

  private async cachedQuote(instrument: MarketInstrument) {
    const value = await this.redis.get(cacheKey(instrument.id));
    return value ? (JSON.parse(value) as MarketQuote) : null;
  }

  private async tick() {
    if (this.inFlight) return;
    this.inFlight = true;
    const lockToken = randomUUID();
    let acquired = false;
    try {
      acquired =
        (await this.redis.set(simulationLockKey, lockToken, { NX: true, PX: 15_000 })) === 'OK';
      if (!acquired) return;

      const instruments = await this.repository.listProviderInstruments(this.provider.name);
      const now = new Date();
      for (const instrument of instruments) {
        const previous = await this.cachedQuote(instrument);
        const quote = await this.provider.generateQuote(instrument, previous, now);
        await this.writeQuote(instrument, quote, false);
      }
    } catch (error) {
      logger.error('Market data simulation tick failed', {
        error: error instanceof Error ? error.message : 'unknown error',
      });
    } finally {
      if (acquired) {
        try {
          await this.redis.eval(compareAndDeleteLock, {
            keys: [simulationLockKey],
            arguments: [lockToken],
          });
        } catch (error) {
          logger.error('Failed to release market simulation lock', {
            error: error instanceof Error ? error.message : 'unknown error',
          });
        }
      }
      this.inFlight = false;
    }
  }

  private async writeQuote(instrument: MarketInstrument, quote: MarketQuote, persist: boolean) {
    // Monitoring is independent of browser subscriptions and history sampling.
    await publishAlertQuote(this.redis, quote);
    const ttlSeconds = Math.max(10, Math.ceil((env.MARKET_SIMULATION_INTERVAL_MS * 5) / 1000));
    await this.redis.set(cacheKey(instrument.id), JSON.stringify(quote), { EX: ttlSeconds });

    const currentTime = Date.parse(quote.timestamp);
    const previousPersisted = await this.redis.get(historyMarkerKey(instrument.id));
    const shouldPersist =
      persist ||
      !previousPersisted ||
      currentTime - Number(previousPersisted) >= env.MARKET_HISTORY_INTERVAL_MS;
    if (shouldPersist) {
      await this.repository.persistQuote(quote, instrument.quoteCurrency);
      await this.redis.set(historyMarkerKey(instrument.id), String(currentTime), {
        EX: Math.max(120, Math.ceil(env.MARKET_HISTORY_INTERVAL_MS / 1000) * 4),
      });
    }

    await this.redis.zRemRangeByScore(
      subscriberKey(instrument.id),
      0,
      Date.now() - SUBSCRIBER_LEASE_MS,
    );
    const io = this.getIO();
    const subscriberCount = await this.redis.zCard(subscriberKey(instrument.id));
    if (io && subscriberCount > 0) {
      const room = `market:${instrument.id}`;
      io.to(room).emit('market:quote', quote);
    }
  }
}
