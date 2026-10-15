import type { Pool } from 'pg';
import {
  PortfolioAnalyticsRepository,
  type PortfolioAnalyticsPosition,
  type PortfolioAnalyticsRow,
} from '../repositories/portfolio-analytics.repository.js';

export type PortfolioDashboard = Omit<PortfolioAnalyticsRow, 'missingQuotes'> & {
  largestPosition: PortfolioAnalyticsPosition | null;
  bestPerformingAsset: PortfolioAnalyticsPosition | null;
  worstPerformingAsset: PortfolioAnalyticsPosition | null;
  charts: {
    positionAllocation: Array<{ label: string; value: string; percentage: string }>;
    portfolioAllocation: Array<{
      label: string;
      kind: 'CASH' | 'POSITION';
      value: string;
      percentage: string;
    }>;
    pnlBreakdown: Array<{ label: string; value: string }>;
  };
};

export interface PortfolioAnalyticsDataSource {
  getUserPortfolios(userId: string): Promise<PortfolioAnalyticsRow[]>;
}

function compareDecimals(left: string, right: string) {
  const parse = (value: string) => {
    const negative = value.startsWith('-');
    const unsigned = negative ? value.slice(1) : value;
    const [whole = '0', fraction = ''] = unsigned.split('.');
    return { negative, whole: whole.replace(/^0+(?=\d)/, ''), fraction };
  };
  const leftValue = parse(left);
  const rightValue = parse(right);
  const scale = Math.max(leftValue.fraction.length, rightValue.fraction.length);
  const leftInteger = BigInt(`${leftValue.whole}${leftValue.fraction.padEnd(scale, '0')}`);
  const rightInteger = BigInt(`${rightValue.whole}${rightValue.fraction.padEnd(scale, '0')}`);
  const signedLeft = leftValue.negative ? -leftInteger : leftInteger;
  const signedRight = rightValue.negative ? -rightInteger : rightInteger;
  return signedLeft < signedRight ? -1 : signedLeft > signedRight ? 1 : 0;
}

export class PortfolioAnalyticsService {
  private readonly repository: PortfolioAnalyticsDataSource;

  constructor(pool: Pool);
  constructor(repository: PortfolioAnalyticsDataSource);
  constructor(source: Pool | PortfolioAnalyticsDataSource) {
    this.repository = 'connect' in source ? new PortfolioAnalyticsRepository(source) : source;
  }

  async getDashboard(userId: string): Promise<PortfolioDashboard[]> {
    const portfolios = await this.repository.getUserPortfolios(userId);
    return portfolios.map((portfolio) => {
      const positions = portfolio.positions;
      const byProfitability = [...positions].sort(
        (left, right) =>
          compareDecimals(right.profitLossPercentage, left.profitLossPercentage) ||
          left.symbol.localeCompare(right.symbol),
      );
      const largestPosition =
        positions.reduce<PortfolioAnalyticsPosition | null>(
          (largest, position) =>
            !largest || compareDecimals(position.marketValue, largest.marketValue) > 0
              ? position
              : largest,
          null,
        ) ?? null;
      const positionAllocation = positions.map((position) => ({
        label: position.symbol,
        value: position.marketValue,
        percentage: position.positionAllocationPercentage,
      }));
      const portfolioAllocation = [
        {
          label: 'Available cash',
          kind: 'CASH' as const,
          value: portfolio.availableCash,
          percentage: portfolio.cashAllocationPercentage,
        },
        ...positions.map((position) => ({
          label: position.symbol,
          kind: 'POSITION' as const,
          value: position.marketValue,
          percentage: position.portfolioAllocationPercentage,
        })),
      ];

      return {
        ...portfolio,
        largestPosition,
        bestPerformingAsset: byProfitability[0] ?? null,
        worstPerformingAsset: byProfitability.at(-1) ?? null,
        charts: {
          positionAllocation,
          portfolioAllocation,
          pnlBreakdown: [
            { label: 'Realized P/L', value: portfolio.realizedPnl },
            { label: 'Unrealized P/L', value: portfolio.unrealizedPnl },
            { label: 'Daily P/L', value: portfolio.dailyPnl },
          ],
        },
      };
    });
  }
}
