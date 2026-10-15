import { env } from '../config.js';
import { ResearchAssistantService } from '../services/research-assistant.service.js';
import type { ResearchAssistantInput } from '../services/research-assistant.service.js';
import { PushDeviceRepository } from '../notifications/push.repository.js';
import type { Request, RequestHandler, Response } from 'express';
import type { Pool } from 'pg';
import type { Server as SocketServer } from 'socket.io';
import type { MarketDataService } from '../market-data/market-data.service.js';
import { getValidated } from '../middleware/validation.js';
import type { PageQuery, SubmitOrder } from '../models/api.js';
import {
  AlertService,
  MarketService,
  NotificationService,
  PortfolioAnalyticsService,
  ResearchService,
  TradingService,
  UserService,
  WatchlistService,
} from '../services/domain.services.js';

type Dependencies = {
  users: UserService;
  market: MarketService;
  watchlists: WatchlistService;
  trading: TradingService;
  alerts: AlertService;
  notifications: NotificationService;
  research: ResearchService;
  portfolioAnalytics: PortfolioAnalyticsService;
};

const run =
  (handler: (request: Request, response: Response) => Promise<void>): RequestHandler =>
  (request, response, next) => {
    void handler(request, response).catch(next);
  };

const userId = (request: Request) => {
  if (!request.auth) throw new Error('Authenticated route has no user identity');
  return request.auth.userId;
};
const pageFrom = (value: { limit: number; offset: number }): PageQuery => value;
const send = (_request: Request, response: Response, data: unknown, status = 200) => {
  response.status(status).json({
    ok: true,
    data,
    requestId: response.getHeader('X-Request-Id'),
  });
};

export function createApiController(
  pool: Pool,
  getIO?: () => SocketServer | undefined,
  marketData?: MarketDataService,
) {
  const service: Dependencies = {
    users: new UserService(pool),
    market: new MarketService(pool, getIO, marketData),
    watchlists: new WatchlistService(pool),
    trading: new TradingService(pool),
    alerts: new AlertService(pool),
    notifications: new NotificationService(pool),
    research: new ResearchService(pool),
    portfolioAnalytics: new PortfolioAnalyticsService(pool),
  };

  const assistant = new ResearchAssistantService(env.AI_SERVICE_URL);
  return {
    generateResearch: run(async (request, response) => {
      userId(request);
      const input = getValidated<ResearchAssistantInput>(request, 'body');
      send(request, response, await assistant.generate(input, request.header('authorization')!));
    }),
    getProfile: run(async (request, response) =>
      send(request, response, await service.users.getProfile(userId(request))),
    ),
    updateProfile: run(async (request, response) => {
      const input = getValidated<{
        displayName?: string | null;
        locale?: string;
        timeZone?: string;
      }>(request, 'body');
      send(request, response, await service.users.updateProfile(userId(request), input));
    }),

    listSymbols: run(async (request, response) => {
      const query = getValidated<{ q?: string; limit: number; offset: number }>(request, 'query');
      send(request, response, await service.market.symbols(query.q, pageFrom(query)));
    }),
    getQuote: run(async (request, response) => {
      const { symbol } = getValidated<{ symbol: string }>(request, 'params');
      send(request, response, await service.market.quote(symbol));
    }),
    getSnapshots: run(async (request, response) => {
      const { symbols } = getValidated<{ symbols: string[] }>(request, 'query');
      send(request, response, await service.market.snapshots(symbols));
    }),
    quoteHistory: run(async (request, response) => {
      const { symbol } = getValidated<{ symbol: string }>(request, 'params');
      const page = getValidated<{ limit: number; offset: number }>(request, 'query');
      send(request, response, await service.market.history(symbol, pageFrom(page)));
    }),
    candles: run(async (request, response) => {
      const { symbol } = getValidated<{ symbol: string }>(request, 'params');
      const { interval, limit } = getValidated<{ interval: string; limit: number }>(
        request,
        'query',
      );
      send(request, response, await service.market.candles(symbol, interval, limit));
    }),
    listNews: run(async (request, response) => {
      const query = getValidated<{ q?: string; limit: number; offset: number }>(request, 'query');
      send(request, response, await service.market.news(query.q, pageFrom(query)));
    }),
    createSymbol: run(async (request, response) => {
      const input = getValidated<{
        symbol: string;
        exchangeCode: string;
        companyName: string;
        assetType: string;
        quoteCurrency: string;
        countryCode?: string | null;
        dataProvider: string;
        providerSymbol: string;
      }>(request, 'body');
      send(request, response, await service.market.createSymbol(input), 201);
    }),
    recordQuote: run(async (request, response) => {
      const { symbolId } = getValidated<{ symbolId: string }>(request, 'params');
      const input = getValidated<{
        price: string;
        open: string;
        high: string;
        low: string;
        previousClose: string;
        change: string;
        changePercent: string;
        volume: number;
        currency: string;
        quoteStatus: 'SIMULATED';
        source: string;
        timestamp?: string;
      }>(request, 'body');
      send(
        request,
        response,
        await service.market.recordQuote(symbolId, {
          ...input,
          timestamp: input.timestamp ?? new Date().toISOString(),
        }),
        201,
      );
    }),

    listWatchlists: run(async (request, response) =>
      send(request, response, await service.watchlists.list(userId(request))),
    ),
    createWatchlist: run(async (request, response) => {
      const { name } = getValidated<{ name: string }>(request, 'body');
      send(request, response, await service.watchlists.create(userId(request), name), 201);
    }),
    renameWatchlist: run(async (request, response) => {
      const { watchlistId } = getValidated<{ watchlistId: string }>(request, 'params');
      const { name } = getValidated<{ name: string }>(request, 'body');
      send(request, response, await service.watchlists.rename(userId(request), watchlistId, name));
    }),
    deleteWatchlist: run(async (request, response) => {
      const { watchlistId } = getValidated<{ watchlistId: string }>(request, 'params');
      await service.watchlists.delete(userId(request), watchlistId);
      response.status(204).end();
    }),
    addWatchlistItem: run(async (request, response) => {
      const { watchlistId } = getValidated<{ watchlistId: string }>(request, 'params');
      const { symbolId } = getValidated<{ symbolId: string }>(request, 'body');
      send(
        request,
        response,
        await service.watchlists.addSymbol(userId(request), watchlistId, symbolId),
        201,
      );
    }),
    removeWatchlistItem: run(async (request, response) => {
      const { watchlistId, symbolId } = getValidated<{ watchlistId: string; symbolId: string }>(
        request,
        'params',
      );
      await service.watchlists.removeSymbol(userId(request), watchlistId, symbolId);
      response.status(204).end();
    }),

    listOrders: run(async (request, response) => {
      const page = getValidated<{ limit: number; offset: number }>(request, 'query');
      send(request, response, await service.trading.orders(userId(request), pageFrom(page)));
    }),
    submitOrder: run(async (request, response) => {
      const input = getValidated<SubmitOrder>(request, 'body');
      send(request, response, await service.trading.submit(userId(request), input), 201);
    }),
    cancelOrder: run(async (request, response) => {
      const { orderId } = getValidated<{ orderId: string }>(request, 'params');
      send(request, response, await service.trading.cancel(userId(request), orderId));
    }),
    listTrades: run(async (request, response) => {
      const page = getValidated<{ limit: number; offset: number }>(request, 'query');
      send(request, response, await service.trading.trades(userId(request), pageFrom(page)));
    }),
    getPortfolio: run(async (request, response) =>
      send(request, response, await service.trading.portfolio(userId(request))),
    ),
    getPortfolioAnalytics: run(async (request, response) =>
      send(request, response, await service.portfolioAnalytics.getDashboard(userId(request))),
    ),
    listTransactions: run(async (request, response) => {
      const page = getValidated<{ limit: number; offset: number }>(request, 'query');
      send(request, response, await service.trading.transactions(userId(request), pageFrom(page)));
    }),

    listAlerts: run(async (request, response) =>
      send(request, response, await service.alerts.list(userId(request))),
    ),
    createAlert: run(async (request, response) => {
      const input = getValidated<import('../alerts/alert-engine.js').AlertInput>(request, 'body');
      send(request, response, await service.alerts.create(userId(request), input), 201);
    }),
    setAlertStatus: run(async (request, response) => {
      const { alertId } = getValidated<{ alertId: string }>(request, 'params');
      const { status } = getValidated<{ status: 'ACTIVE' | 'PAUSED' | 'CANCELLED' }>(
        request,
        'body',
      );
      send(request, response, await service.alerts.setStatus(userId(request), alertId, status));
    }),

    registerPushDevice: run(async (request, response) => {
      const input = getValidated<{
        installationId: string;
        token: string;
        platform: 'ios' | 'android';
      }>(request, 'body');
      if (!request.auth) throw new Error('Authenticated route has no session');
      send(
        request,
        response,
        await new PushDeviceRepository(pool).register(
          userId(request),
          request.auth.sessionId,
          input,
        ),
        201,
      );
    }),
    unregisterPushDevice: run(async (request, response) => {
      const { installationId } = getValidated<{ installationId: string }>(request, 'params');
      await new PushDeviceRepository(pool).unregister(userId(request), installationId);
      response.status(204).end();
    }),
    listNotifications: run(async (request, response) => {
      const page = getValidated<{ limit: number; offset: number }>(request, 'query');
      send(request, response, await service.notifications.list(userId(request), pageFrom(page)));
    }),
    markNotificationRead: run(async (request, response) => {
      const { notificationId } = getValidated<{ notificationId: string }>(request, 'params');
      send(
        request,
        response,
        await service.notifications.markRead(userId(request), notificationId),
      );
    }),

    listResearch: run(async (request, response) => {
      const page = getValidated<{ limit: number; offset: number }>(request, 'query');
      send(request, response, await service.research.list(userId(request), pageFrom(page)));
    }),
    listSentiment: run(async (request, response) => {
      const query = getValidated<{ symbol?: string; limit: number; offset: number }>(
        request,
        'query',
      );
      send(request, response, await service.research.sentiment(query.symbol, pageFrom(query)));
    }),
    marketSummary: run(async (request, response) =>
      send(request, response, await service.research.marketSummary()),
    ),
  };
}
