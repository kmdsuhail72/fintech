import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import {
  Button,
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
import { useSession } from '../../hooks/useSession';
import { money } from '../../theme/tokens';
import type { TabParams } from '../../navigation/types';
type Summary = {
  totalPortfolioValue: string;
  availableCash: string;
  dailyPnl: string;
  totalPnl: string;
  currency: string;
  positions: { symbol: string; companyName: string; marketValue: string }[];
};
export function DashboardScreen({ navigation }: BottomTabScreenProps<TabParams, 'Dashboard'>) {
  const { user } = useSession();
  const portfolio = useApiQuery<Summary[]>('analytics', '/portfolio/analytics', {
    interval: 15000,
  });
  const summary = portfolio.data?.[0];
  return (
    <Screen
      title={'Hello, ' + (user?.displayName?.split(' ')[0] ?? 'investor')}
      subtitle="A clear view of your paper portfolio."
      refreshing={portfolio.isRefetching}
      onRefresh={() => void portfolio.refetch()}
    >
      <Copy>SIMULATED MARKETS · VIRTUAL FUNDS</Copy>
      {portfolio.isLoading && <Loading label="Loading your portfolio…" />}
      <ErrorNotice error={portfolio.error} onRetry={() => void portfolio.refetch()} />
      {summary ? (
        <>
          <Card>
            <Metric
              label="TOTAL PORTFOLIO VALUE"
              value={money(summary.totalPortfolioValue, summary.currency)}
            />
            <Metric
              label="Today's P/L"
              value={money(summary.dailyPnl, summary.currency)}
              tone={Number(summary.dailyPnl) >= 0 ? 'positive' : 'negative'}
            />
            <Metric label="Available cash" value={money(summary.availableCash, summary.currency)} />
            <Button title="Explore markets" onPress={() => navigation.navigate('Markets')} />
          </Card>
          <Card>
            <Copy>Your positions</Copy>
            {summary.positions.slice(0, 5).map((position) => (
              <Row
                key={position.symbol}
                title={position.symbol}
                subtitle={position.companyName}
                value={money(position.marketValue, summary.currency)}
              />
            ))}
            {!summary.positions.length && (
              <EmptyState text="Your first paper trade will appear here." />
            )}
            <Button
              secondary
              title="View portfolio"
              onPress={() => navigation.navigate('Portfolio')}
            />
          </Card>
        </>
      ) : (
        !portfolio.isLoading &&
        !portfolio.error && <EmptyState text="No paper portfolio is available for this account." />
      )}
    </Screen>
  );
}
