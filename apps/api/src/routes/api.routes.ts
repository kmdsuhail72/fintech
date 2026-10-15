import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { browserTraceProxy } from './telemetry.js';
import { createRagRouter } from './rag.routes.js';
import type { Pool } from 'pg';
import { createClient } from 'redis';
import type { Server as SocketServer } from 'socket.io';
import { AuthService } from '../auth/service.js';
import { requireAuthentication } from '../auth/middleware.js';
import { requireRole } from '../middleware/rbac.js';
import { validateRequest } from '../middleware/validation.js';
import { createApiController } from '../controllers/api.controller.js';
import type { MarketDataService } from '../market-data/market-data.service.js';
import {
  researchAssistantSchema,
  addWatchlistItemSchema,
  candleQuerySchema,
  adminQuoteSchema,
  adminSymbolSchema,
  alertPathSchema,
  alertStatusSchema,
  createAlertSchema,
  createWatchlistSchema,
  marketSearchSchema,
  marketSnapshotsSchema,
  newsSearchSchema,
  notificationPathSchema,
  orderPathSchema,
  pageQuerySchema,
  profileUpdateSchema,
  pushDeviceSchema,
  pushDevicePathSchema,
  sentimentQuerySchema,
  symbolIdPathSchema,
  submitOrderSchema,
  symbolPathSchema,
  watchlistItemPathSchema,
  watchlistPathSchema,
} from '../validators/api.validators.js';

type RedisClient = ReturnType<typeof createClient>;

export function createApiRouter(
  pool: Pool,
  redis: RedisClient,
  getIO?: () => SocketServer | undefined,
  marketData?: MarketDataService,
) {
  const router = Router();
  const auth = new AuthService(pool, redis);
  const controller = createApiController(pool, getIO, marketData);
  const authenticated = requireAuthentication(auth);
  const admin = requireRole(pool, 'admin');
  const privateApi = Router();
  privateApi.use(authenticated);
  privateApi.post(
    '/telemetry/traces',
    rateLimit({
      windowMs: 60_000,
      limit: 30,
      keyGenerator: (request) => request.auth!.userId,
      store: new RedisStore({
        sendCommand: (...args: string[]) => redis.sendCommand(args),
        prefix: 'rl:telemetry:',
      }),
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    }),
    browserTraceProxy,
  );
  privateApi.use('/ai/research', createRagRouter());

  privateApi.get('/users/me', controller.getProfile);
  privateApi.patch(
    '/users/me',
    validateRequest({ body: profileUpdateSchema }),
    controller.updateProfile,
  );

  router.get(
    '/market/symbols',
    validateRequest({ query: marketSearchSchema }),
    controller.listSymbols,
  );
  router.get(
    '/market/quotes/:symbol',
    validateRequest({ params: symbolPathSchema }),
    controller.getQuote,
  );
  router.get(
    '/market/snapshots',
    validateRequest({ query: marketSnapshotsSchema }),
    controller.getSnapshots,
  );
  router.get(
    '/market/quotes/:symbol/history',
    validateRequest({ params: symbolPathSchema, query: pageQuerySchema }),
    controller.quoteHistory,
  );
  router.get(
    '/market/quotes/:symbol/candles',
    validateRequest({ params: symbolPathSchema, query: candleQuerySchema }),
    controller.candles,
  );
  router.get('/market/news', validateRequest({ query: newsSearchSchema }), controller.listNews);
  router.post(
    '/market/symbols',
    authenticated,
    admin,
    validateRequest({ body: adminSymbolSchema }),
    controller.createSymbol,
  );
  router.post(
    '/market/symbols/:symbolId/quotes',
    authenticated,
    admin,
    validateRequest({
      params: symbolIdPathSchema,
      body: adminQuoteSchema,
    }),
    controller.recordQuote,
  );

  privateApi.get('/watchlists', controller.listWatchlists);
  privateApi.post(
    '/watchlists',
    validateRequest({ body: createWatchlistSchema }),
    controller.createWatchlist,
  );
  privateApi.patch(
    '/watchlists/:watchlistId',
    validateRequest({ params: watchlistPathSchema, body: createWatchlistSchema }),
    controller.renameWatchlist,
  );
  privateApi.delete(
    '/watchlists/:watchlistId',
    validateRequest({ params: watchlistPathSchema }),
    controller.deleteWatchlist,
  );
  privateApi.post(
    '/watchlists/:watchlistId/items',
    validateRequest({ params: watchlistPathSchema, body: addWatchlistItemSchema }),
    controller.addWatchlistItem,
  );
  privateApi.delete(
    '/watchlists/:watchlistId/items/:symbolId',
    validateRequest({ params: watchlistItemPathSchema }),
    controller.removeWatchlistItem,
  );

  privateApi.get('/orders', validateRequest({ query: pageQuerySchema }), controller.listOrders);
  privateApi.post('/orders', validateRequest({ body: submitOrderSchema }), controller.submitOrder);
  privateApi.delete(
    '/orders/:orderId',
    validateRequest({ params: orderPathSchema }),
    controller.cancelOrder,
  );
  privateApi.get('/trades', validateRequest({ query: pageQuerySchema }), controller.listTrades);
  privateApi.get('/portfolio', controller.getPortfolio);
  privateApi.get('/portfolio/analytics', controller.getPortfolioAnalytics);
  privateApi.get(
    '/transactions',
    validateRequest({ query: pageQuerySchema }),
    controller.listTransactions,
  );

  privateApi.get('/alerts', controller.listAlerts);
  privateApi.post('/alerts', validateRequest({ body: createAlertSchema }), controller.createAlert);
  privateApi.patch(
    '/alerts/:alertId',
    validateRequest({ params: alertPathSchema, body: alertStatusSchema }),
    controller.setAlertStatus,
  );
  privateApi.post(
    '/notifications/devices',
    validateRequest({ body: pushDeviceSchema }),
    controller.registerPushDevice,
  );
  privateApi.delete(
    '/notifications/devices/:installationId',
    validateRequest({ params: pushDevicePathSchema }),
    controller.unregisterPushDevice,
  );
  privateApi.get(
    '/notifications',
    validateRequest({ query: pageQuerySchema }),
    controller.listNotifications,
  );
  privateApi.patch(
    '/notifications/:notificationId/read',
    validateRequest({ params: notificationPathSchema }),
    controller.markNotificationRead,
  );

  privateApi.post(
    '/ai/research/assistant',
    validateRequest({ body: researchAssistantSchema }),
    controller.generateResearch,
  );
  privateApi.get(
    '/ai/research',
    validateRequest({ query: pageQuerySchema }),
    controller.listResearch,
  );
  router.get(
    '/ai/news-sentiment',
    validateRequest({ query: sentimentQuerySchema }),
    controller.listSentiment,
  );
  router.get('/ai/market-summary', controller.marketSummary);

  // Mount at the API root: mounting this router at each resource prefix would
  // strip that prefix before matching its full /orders, /watchlists, etc. routes.
  router.use((request, response, next) => {
    if (
      /^\/(?:users|watchlists|orders|trades|portfolio|transactions|alerts|notifications|ai\/research|telemetry)(?:\/|$)/i.test(
        request.path,
      )
    ) {
      privateApi(request, response, next);
    } else {
      next();
    }
  });
  return router;
}
