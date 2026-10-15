import {
  Card,
  Copy,
  EmptyState,
  ErrorNotice,
  Loading,
  Metric,
  Row,
  Screen,
} from '../../components/ui';
import { useApiQuery } from '../../hooks/useApiQuery';
import type { Portfolio } from '../../services/types';
import { money } from '../../theme/tokens';
export function PortfolioScreen() {
  const portfolios = useApiQuery<Portfolio[]>('portfolio', '/portfolio', { interval: 15000 });
  return (
    <Screen
      title="Portfolio"
      subtitle="Track your virtual balance and holdings."
      refreshing={portfolios.isRefetching}
      onRefresh={() => void portfolios.refetch()}
    >
      {portfolios.isLoading && <Loading />}
      <ErrorNotice error={portfolios.error} onRetry={() => void portfolios.refetch()} />
      {portfolios.data?.map((portfolio) => (
        <Card key={portfolio.portfolio_id}>
          <Copy>{portfolio.name}</Copy>
          <Metric
            label="Portfolio value"
            value={
              portfolio.positions.some((position) => position.lastPrice === null)
                ? 'Quote unavailable'
                : money(portfolio.total_value, portfolio.base_currency)
            }
          />
          <Metric
            label="Available cash"
            value={money(portfolio.cash_balance, portfolio.base_currency)}
          />
          <Metric
            label="Unrealized P/L"
            value={money(portfolio.unrealized_pnl, portfolio.base_currency)}
            tone={Number(portfolio.unrealized_pnl) >= 0 ? 'positive' : 'negative'}
          />
          {portfolio.positions.map((position) => (
            <Row
              key={position.symbolId}
              title={position.symbol}
              subtitle={
                position.quantity +
                ' shares · Average ' +
                money(position.averageCost, portfolio.base_currency)
              }
              value={money(position.marketValue, portfolio.base_currency)}
            >
              <Copy
                positive={Number(position.unrealizedPnl) >= 0}
                negative={Number(position.unrealizedPnl) < 0}
              >
                P/L {money(position.unrealizedPnl, portfolio.base_currency)}
              </Copy>
            </Row>
          ))}
          {!portfolio.positions.length && <EmptyState text="No open positions yet." />}
        </Card>
      ))}
    </Screen>
  );
}
