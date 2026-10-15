import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PortfolioAnalyticsService,
  type PortfolioAnalyticsDataSource,
} from '../src/services/portfolio-analytics.service.js';
import type { PortfolioAnalyticsRow } from '../src/repositories/portfolio-analytics.repository.js';

const row: PortfolioAnalyticsRow = {
  portfolioId: 'portfolio-1',
  portfolioName: 'Learning Portfolio',
  currency: 'USD',
  availableCash: '600',
  investedAmount: '300',
  marketValue: '360',
  costBasis: '300',
  realizedPnl: '5',
  unrealizedPnl: '60',
  dailyPnl: '12',
  dailyPnlPercentage: '3.4482758620689655',
  totalPnl: '65',
  totalPnlPercentage: '21.6666666666666667',
  totalPortfolioValue: '960',
  cashAllocationPercentage: '62.5',
  asOf: new Date('2026-10-08T00:00:00.000Z'),
  unavailableSymbols: [],
  positions: [
    {
      symbolId: 'symbol-a',
      symbol: 'AAPL',
      companyName: 'Apple Inc.',
      quantity: '1',
      averagePrice: '100',
      currentPrice: '110',
      previousClose: '108',
      marketValue: '110',
      costBasis: '100',
      profitLoss: '10',
      profitLossPercentage: '10',
      dailyPnl: '2',
      positionAllocationPercentage: '30.5555555555555556',
      portfolioAllocationPercentage: '11.4583333333333333',
      currency: 'USD',
      quoteTimestamp: '2026-10-08T00:00:00.000Z',
    },
    {
      symbolId: 'symbol-b',
      symbol: 'MSFT',
      companyName: 'Microsoft Corporation',
      quantity: '2',
      averagePrice: '100',
      currentPrice: '125',
      previousClose: '119.5',
      marketValue: '250',
      costBasis: '200',
      profitLoss: '50',
      profitLossPercentage: '25',
      dailyPnl: '11',
      positionAllocationPercentage: '69.4444444444444444',
      portfolioAllocationPercentage: '26.0416666666666667',
      currency: 'USD',
      quoteTimestamp: '2026-10-08T00:00:00.000Z',
    },
  ],
};

test('portfolio analytics prepares dashboard summaries and chart-ready allocations', async () => {
  const source: PortfolioAnalyticsDataSource = {
    async getUserPortfolios() {
      return [row];
    },
  };
  const service = new PortfolioAnalyticsService(source);
  const [dashboard] = await service.getDashboard('user-1');

  assert.ok(dashboard);
  assert.equal(dashboard.totalPortfolioValue, '960');
  assert.equal(dashboard.availableCash, '600');
  assert.equal(dashboard.investedAmount, '300');
  assert.equal(dashboard.dailyPnl, '12');
  assert.equal(dashboard.totalPnl, '65');
  assert.equal(dashboard.totalPnlPercentage, '21.6666666666666667');
  assert.equal(dashboard.largestPosition?.symbol, 'MSFT');
  assert.equal(dashboard.bestPerformingAsset?.symbol, 'MSFT');
  assert.equal(dashboard.worstPerformingAsset?.symbol, 'AAPL');
  assert.deepEqual(dashboard.charts.positionAllocation, [
    { label: 'AAPL', value: '110', percentage: '30.5555555555555556' },
    { label: 'MSFT', value: '250', percentage: '69.4444444444444444' },
  ]);
  assert.deepEqual(dashboard.charts.portfolioAllocation[0], {
    label: 'Available cash',
    kind: 'CASH',
    value: '600',
    percentage: '62.5',
  });
  assert.equal(dashboard.positions[0]!.averagePrice, '100');
  assert.equal(dashboard.positions[1]!.profitLossPercentage, '25');
  assert.equal(dashboard.charts.pnlBreakdown[1]!.value, '60');
});

test('portfolio analytics handles a cash-only portfolio without fake leaders', async () => {
  const cashOnly: PortfolioAnalyticsRow = {
    ...row,
    investedAmount: '0',
    marketValue: '0',
    costBasis: '0',
    realizedPnl: '0',
    unrealizedPnl: '0',
    dailyPnl: '0',
    dailyPnlPercentage: '0',
    totalPnl: '0',
    totalPnlPercentage: '0',
    totalPortfolioValue: '1000',
    availableCash: '1000',
    cashAllocationPercentage: '100',
    positions: [],
  };
  const service = new PortfolioAnalyticsService({
    async getUserPortfolios() {
      return [cashOnly];
    },
  });
  const [dashboard] = await service.getDashboard('user-1');

  assert.equal(dashboard?.largestPosition, null);
  assert.equal(dashboard?.bestPerformingAsset, null);
  assert.equal(dashboard?.worstPerformingAsset, null);
  assert.deepEqual(dashboard?.charts.positionAllocation, []);
  assert.equal(dashboard?.charts.portfolioAllocation[0]?.percentage, '100');
});

test('portfolio analytics does not invent a return percentage when open cost basis is zero', async () => {
  const closedPortfolio: PortfolioAnalyticsRow = {
    ...row,
    availableCash: '1005',
    investedAmount: '0',
    marketValue: '0',
    costBasis: '0',
    realizedPnl: '5',
    unrealizedPnl: '0',
    dailyPnl: '0',
    dailyPnlPercentage: '0',
    totalPnl: '5',
    totalPnlPercentage: null,
    totalPortfolioValue: '1005',
    cashAllocationPercentage: '100',
    positions: [],
  };
  const service = new PortfolioAnalyticsService({
    async getUserPortfolios() {
      return [closedPortfolio];
    },
  });
  const [dashboard] = await service.getDashboard('user-1');

  assert.equal(dashboard?.totalPnl, '5');
  assert.equal(dashboard?.totalPnlPercentage, null);
});
