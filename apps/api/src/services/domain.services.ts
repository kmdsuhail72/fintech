import { MarketDataRepository } from '../market-data/market-data.repository.js';
import type { Pool } from 'pg';
import type { Server as SocketServer } from 'socket.io';
import type { MarketQuote } from '../market-data/types.js';
import type { PageQuery, SubmitOrder } from '../models/api.js';
import type { MarketDataService } from '../market-data/market-data.service.js';
import { PortfolioAnalyticsService } from './portfolio-analytics.service.js';
import { ApiError } from '../utils/errors.js';
import {
  AlertRepository,
  MarketRepository,
  NotificationRepository,
  ResearchRepository,
  TradingRepository,
  UserRepository,
  WatchlistRepository,
} from '../repositories/domain.repositories.js';

export class UserService {
  private readonly repository: UserRepository;
  constructor(pool: Pool) {
    this.repository = new UserRepository(pool);
  }
  getProfile(userId: string) {
    return this.repository.getProfile(userId);
  }
  updateProfile(
    userId: string,
    input: { displayName?: string | null; locale?: string; timeZone?: string },
  ) {
    return this.repository.updateProfile(userId, input);
  }
}

export class MarketService {
  private readonly repository: MarketRepository;
  constructor(
    private readonly pool: Pool,
    private readonly getIO?: () => SocketServer | undefined,
    private readonly marketData?: MarketDataService,
  ) {
    this.repository = new MarketRepository(pool);
  }
  symbols(query: string | undefined, page: PageQuery) {
    return this.repository.searchSymbols(query, page);
  }
  quote(symbol: string) {
    if (this.marketData) return this.marketData.snapshot(symbol);
    return this.repository.latestQuote(symbol);
  }
  snapshots(symbols: string[]) {
    if (this.marketData) return this.marketData.snapshots(symbols);
    return Promise.all(symbols.map((symbol) => this.repository.latestQuote(symbol)));
  }
  history(symbol: string, page: PageQuery) {
    if (this.marketData) return this.marketData.history(symbol, page.limit, page.offset);
    return this.repository.quoteHistory(symbol, page);
  }
  async candles(symbol: string, interval: string, limit: number) {
    const rows = await new MarketDataRepository(this.pool).candles(symbol, interval, limit);
    return { interval, source: 'sampled-quotes', candles: rows };
  }
  news(query: string | undefined, page: PageQuery) {
    return this.repository.news(query, page);
  }

  async recordQuote(symbolId: string, input: Omit<MarketQuote, 'symbolId' | 'symbol'>) {
    if (this.marketData) {
      return this.marketData.recordProviderQuote({
        symbolId,
        symbol: '',
        ...input,
      });
    }
    const quoteStatus = input.quoteStatus;
    if (quoteStatus === 'STALE') {
      throw new ApiError(
        422,
        'STALE_QUOTE',
        'Stale quotes cannot be submitted to the market data service',
      );
    }
    const quote = await this.repository.recordQuote(symbolId, {
      price: input.price,
      open: input.open,
      high: input.high,
      low: input.low,
      previousClose: input.previousClose,
      change: input.change,
      changePercent: input.changePercent,
      volume: input.volume,
      currency: input.currency,
      quoteStatus,
      source: input.source,
      observedAt: input.timestamp,
    });
    this.getIO?.()?.to(`market:${symbolId}`).emit('market:quote', quote);
    return quote;
  }

  createSymbol(input: Parameters<MarketRepository['createSymbol']>[0]) {
    return this.repository.createSymbol(input);
  }
}

export class WatchlistService {
  private readonly repository: WatchlistRepository;
  constructor(pool: Pool) {
    this.repository = new WatchlistRepository(pool);
  }
  list(userId: string) {
    return this.repository.list(userId);
  }
  create(userId: string, name: string) {
    return this.repository.create(userId, name);
  }
  rename(userId: string, id: string, name: string) {
    return this.repository.rename(userId, id, name);
  }
  delete(userId: string, id: string) {
    return this.repository.delete(userId, id);
  }
  addSymbol(userId: string, id: string, symbolId: string) {
    return this.repository.addSymbol(userId, id, symbolId);
  }
  removeSymbol(userId: string, id: string, symbolId: string) {
    return this.repository.removeSymbol(userId, id, symbolId);
  }
}

export class TradingService {
  private readonly repository: TradingRepository;
  constructor(pool: Pool) {
    this.repository = new TradingRepository(pool);
  }
  orders(userId: string, page: PageQuery) {
    return this.repository.listOrders(userId, page);
  }
  submit(userId: string, input: SubmitOrder) {
    return this.repository.createMarketOrder(userId, input);
  }
  cancel(userId: string, orderId: string) {
    return this.repository.cancelOrder(userId, orderId);
  }
  trades(userId: string, page: PageQuery) {
    return this.repository.listTrades(userId, page);
  }
  portfolio(userId: string) {
    return this.repository.portfolio(userId);
  }
  transactions(userId: string, page: PageQuery) {
    return this.repository.transactions(userId, page);
  }
}

export { PortfolioAnalyticsService };

export class AlertService {
  private readonly repository: AlertRepository;
  constructor(pool: Pool) {
    this.repository = new AlertRepository(pool);
  }
  list(userId: string) {
    return this.repository.list(userId);
  }
  create(userId: string, input: Parameters<AlertRepository['create']>[1]) {
    return this.repository.create(userId, input);
  }
  setStatus(userId: string, alertId: string, status: 'ACTIVE' | 'PAUSED' | 'CANCELLED') {
    return this.repository.updateStatus(userId, alertId, status);
  }
}

export class NotificationService {
  private readonly repository: NotificationRepository;
  constructor(pool: Pool) {
    this.repository = new NotificationRepository(pool);
  }
  list(userId: string, page: PageQuery) {
    return this.repository.list(userId, page);
  }
  markRead(userId: string, id: string) {
    return this.repository.markRead(userId, id);
  }
}

export class ResearchService {
  private readonly repository: ResearchRepository;
  constructor(pool: Pool) {
    this.repository = new ResearchRepository(pool);
  }
  list(userId: string, page: PageQuery) {
    return this.repository.list(userId, page);
  }
  sentiment(symbol: string | undefined, page: PageQuery) {
    return this.repository.newsSentiment(symbol, page);
  }
  marketSummary() {
    return this.repository.marketSummary();
  }
}
