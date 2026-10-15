import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { Pool } from 'pg';
import { TradingRepository } from '../src/repositories/domain.repositories.js';
import { PortfolioAnalyticsService } from '../src/services/portfolio-analytics.service.js';
import { ApiError } from '../src/utils/errors.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

test(
  'paper order execution updates wallet, positions, history, and P/L atomically',
  { skip: !databaseUrl },
  async () => {
    const schema = `paper_trading_${randomUUID().replaceAll('-', '')}`;
    const admin = new Pool({ connectionString: databaseUrl });
    let pool: Pool | undefined;

    try {
      await admin.query(`CREATE SCHEMA "${schema}"`);
      pool = new Pool({
        connectionString: databaseUrl,
        options: `-c search_path=${schema},public`,
      });

      const migrationsPath = resolve(process.cwd(), '../../database/migrations');
      const migrations = (await readdir(migrationsPath))
        .filter((file) => /^\d+_.+\.sql$/.test(file))
        .sort();
      for (const migration of migrations) {
        await pool.query(await readFile(resolve(migrationsPath, migration), 'utf8'));
      }

      const userId = randomUUID();
      const accountId = randomUUID();
      const walletId = randomUUID();
      const portfolioId = randomUUID();
      const symbolId = randomUUID();
      await pool.query(
        `INSERT INTO users (id, email, password_hash, status, email_verified_at)
         VALUES ($1, $2, 'test-hash', 'ACTIVE', now())`,
        [userId, `${userId}@example.test`],
      );
      await pool.query(
        `INSERT INTO accounts (id, user_id, account_type, name, base_currency, initial_virtual_capital)
         VALUES ($1, $2, 'PAPER', 'Test Paper Account', 'USD', 100000)`,
        [accountId, userId],
      );
      await pool.query(
        `INSERT INTO wallets (id, account_id, currency, balance)
         VALUES ($1, $2, 'USD', 100000)`,
        [walletId, accountId],
      );
      await pool.query(
        `INSERT INTO portfolios (id, account_id, name, base_currency)
         VALUES ($1, $2, 'Test Portfolio', 'USD')`,
        [portfolioId, accountId],
      );
      await pool.query(
        `INSERT INTO symbols (
           id, symbol, exchange_code, company_name, asset_type, quote_currency, is_active
         ) VALUES ($1, 'AAPL', 'TEST', 'Apple Test', 'EQUITY', 'USD', true)`,
        [symbolId],
      );

      const addQuote = async (price: string, previousClose = price, timeOffset = '0 seconds') => {
        await pool!.query(
          `INSERT INTO market_quotes (
             symbol_id, price, currency, quote_status, source, observed_at,
             open_price, high_price, low_price, previous_close,
             change_amount, change_percent, volume
           )
           VALUES (
             $1, $2, 'USD', 'SIMULATED', 'test-simulator', now() + $4::interval,
             $2, $2, $2, $3,
             $2::numeric - $3::numeric,
             CASE WHEN $3::numeric = 0 THEN 0
                  ELSE (($2::numeric - $3::numeric) / $3::numeric) * 100 END,
             0
           )`,
          [symbolId, price, previousClose, timeOffset],
        );
      };
      await addQuote('200');

      const repository = new TradingRepository(pool);
      const order = (side: 'BUY' | 'SELL', quantity: string, idempotencyKey: string) => ({
        portfolioId,
        symbolId,
        side,
        quantity,
        idempotencyKey,
      });

      await assert.rejects(
        repository.createMarketOrder(userId, {
          ...order('BUY', '1', 'buy-missing-symbol'),
          symbolId: randomUUID(),
        }),
        (error: unknown) => error instanceof ApiError && error.status === 404,
      );

      const firstBuy = await repository.createMarketOrder(
        userId,
        order('BUY', '10', 'buy-aapl-001'),
      );
      assert.equal(firstBuy.status, 'FILLED');
      assert.equal(Number(firstBuy.average_fill_price), 200);

      const replayedBuy = await repository.createMarketOrder(
        userId,
        order('BUY', '10', 'buy-aapl-001'),
      );
      assert.equal(replayedBuy.id, firstBuy.id);

      await assert.rejects(
        repository.createMarketOrder(userId, order('SELL', '10', 'buy-aapl-001')),
        (error: unknown) => error instanceof ApiError && error.code === 'IDEMPOTENCY_KEY_REUSED',
      );

      await addQuote('220');
      await repository.createMarketOrder(userId, order('BUY', '10', 'buy-aapl-002'));
      await addQuote('230');
      await repository.createMarketOrder(userId, order('SELL', '5', 'sell-aapl-001'));
      await addQuote('240');

      const portfolio = (await repository.portfolio(userId))[0]!;
      assert.equal(Number(portfolio.cash_balance), 96_950);
      assert.equal(Number(portfolio.market_value), 3_600);
      assert.equal(Number(portfolio.total_value), 100_550);
      assert.equal(Number(portfolio.realized_pnl), 100);
      assert.equal(Number(portfolio.unrealized_pnl), 450);
      const positions = portfolio.positions as Array<{
        quantity: string;
        averageCost: string;
        marketValue: string;
        unrealizedPnl: string;
      }>;
      assert.equal(Number(positions[0]!.quantity), 15);
      assert.equal(Number(positions[0]!.averageCost), 210);
      assert.equal(Number(positions[0]!.marketValue), 3_600);
      assert.equal(Number(positions[0]!.unrealizedPnl), 450);

      await addQuote('240', '230', '1 hour');
      const [dashboard] = await new PortfolioAnalyticsService(pool).getDashboard(userId);
      assert.ok(dashboard);
      assert.equal(Number(dashboard.totalPortfolioValue), 100_550);
      assert.equal(Number(dashboard.availableCash), 96_950);
      assert.equal(Number(dashboard.investedAmount), 3_150);
      assert.equal(Number(dashboard.marketValue), 3_600);
      assert.equal(Number(dashboard.dailyPnl), 150);
      assert.equal(Number(dashboard.totalPnl), 550);
      assert.equal(dashboard.largestPosition?.symbol, 'AAPL');
      assert.equal(dashboard.bestPerformingAsset?.symbol, 'AAPL');
      assert.equal(Number(dashboard.positions[0]!.averagePrice), 210);
      assert.equal(Number(dashboard.positions[0]!.currentPrice), 240);
      assert.equal(Number(dashboard.positions[0]!.marketValue), 3_600);
      assert.equal(Number(dashboard.positions[0]!.costBasis), 3_150);
      assert.equal(Number(dashboard.positions[0]!.profitLoss), 450);
      assert.ok(Number(dashboard.positions[0]!.portfolioAllocationPercentage) > 3.5);
      assert.equal(dashboard.charts.portfolioAllocation.length, 2);

      const ordersBeforeRejectedSell = await repository.listOrders(userId, {
        limit: 100,
        offset: 0,
      });
      const tradesBeforeRejectedSell = await repository.listTrades(userId, {
        limit: 100,
        offset: 0,
      });
      assert.equal(ordersBeforeRejectedSell.length, 3);
      assert.equal(tradesBeforeRejectedSell.length, 3);
      const ledgerAfterValidTrades = await pool.query(
        `SELECT count(*)::int AS count, sum(amount)::text AS net_amount
         FROM transactions WHERE account_id = $1`,
        [accountId],
      );
      assert.equal(ledgerAfterValidTrades.rows[0]!.count, 3);
      assert.equal(Number(ledgerAfterValidTrades.rows[0]!.net_amount), -3_050);

      await assert.rejects(
        repository.createMarketOrder(userId, order('SELL', '16', 'sell-aapl-too-many')),
        (error: unknown) => error instanceof ApiError && error.code === 'INSUFFICIENT_POSITION',
      );
      assert.equal(
        (await repository.listOrders(userId, { limit: 100, offset: 0 })).length,
        ordersBeforeRejectedSell.length,
      );
      assert.equal(
        (await repository.listTrades(userId, { limit: 100, offset: 0 })).length,
        tradesBeforeRejectedSell.length,
      );

      const sameKeyResults = await Promise.all([
        repository.createMarketOrder(userId, order('BUY', '1', 'buy-aapl-race')),
        repository.createMarketOrder(userId, order('BUY', '1', 'buy-aapl-race')),
      ]);
      assert.equal(sameKeyResults[0].id, sameKeyResults[1].id);
      assert.equal((await repository.listTrades(userId, { limit: 100, offset: 0 })).length, 4);

      await pool.query(`UPDATE wallets SET balance = 2400 WHERE id = $1`, [walletId]);
      const competingBuys = await Promise.allSettled([
        repository.createMarketOrder(userId, order('BUY', '10', 'buy-race-cash-001')),
        repository.createMarketOrder(userId, order('BUY', '10', 'buy-race-cash-002')),
      ]);
      assert.equal(competingBuys.filter((result) => result.status === 'fulfilled').length, 1);
      assert.equal(competingBuys.filter((result) => result.status === 'rejected').length, 1);
      const finalState = await pool.query(
        `SELECT w.balance::text AS balance, count(DISTINCT o.id)::int AS order_count,
                count(DISTINCT t.id)::int AS trade_count
         FROM wallets w
         JOIN accounts a ON a.id = w.account_id
         LEFT JOIN orders o ON o.account_id = a.id
         LEFT JOIN trades t ON t.order_id = o.id
         WHERE w.id = $1
         GROUP BY w.balance`,
        [walletId],
      );
      assert.equal(Number(finalState.rows[0]!.balance), 0);
      assert.equal(finalState.rows[0]!.order_count, 5);
      assert.equal(finalState.rows[0]!.trade_count, 5);

      const [beforeLiquidation] = await repository.portfolio(userId);
      const remaining = (beforeLiquidation!.positions as Array<{ quantity: string }>)[0]!.quantity;
      await repository.createMarketOrder(userId, order('SELL', remaining, 'sell-entire-position'));
      const [liquidated] = await repository.portfolio(userId);
      assert.deepEqual(liquidated!.positions, []);
      assert.equal(Number(liquidated!.realized_pnl), 550);
      const [closedAnalytics] = await new PortfolioAnalyticsService(pool).getDashboard(userId);
      assert.equal(Number(closedAnalytics!.realizedPnl), Number(liquidated!.realized_pnl));

      const unavailableSymbolId = randomUUID();
      await pool.query(
        `INSERT INTO symbols (
           id, symbol, exchange_code, company_name, asset_type, quote_currency, is_active
         ) VALUES ($1, 'NOQUOTE', 'TEST', 'Missing quote test', 'EQUITY', 'USD', true)`,
        [unavailableSymbolId],
      );
      await pool.query(
        `INSERT INTO positions (portfolio_id, symbol_id, quantity, average_cost)
         VALUES ($1, $2, 1, 100)`,
        [portfolioId, unavailableSymbolId],
      );
      await assert.rejects(
        new PortfolioAnalyticsService(pool).getDashboard(userId),
        (error: unknown) =>
          error instanceof ApiError && error.code === 'PORTFOLIO_VALUATION_UNAVAILABLE',
      );
      await assert.rejects(
        repository.portfolio(userId),
        (error: unknown) =>
          error instanceof ApiError && error.code === 'PORTFOLIO_VALUATION_UNAVAILABLE',
      );
      await pool.query(
        `INSERT INTO market_quotes(symbol_id,price,currency,quote_status,source,observed_at,
          open_price,high_price,low_price,previous_close,change_amount,change_percent,volume)
         VALUES ($1,100,'EUR','SIMULATED','currency-test',now(),100,100,100,100,0,0,0)`,
        [unavailableSymbolId],
      );
      await assert.rejects(
        repository.portfolio(userId),
        (error: unknown) =>
          error instanceof ApiError && error.code === 'PORTFOLIO_VALUATION_UNAVAILABLE',
      );
    } finally {
      await pool?.end();
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  },
);
