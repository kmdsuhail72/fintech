import { Card, Copy, EmptyState, ErrorNotice, Loading, Row, Screen } from '../../components/ui';
import { useApiQuery } from '../../hooks/useApiQuery';
import type { MarketSummary, Research } from '../../services/types';
function researchText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    for (const key of ['answer', 'summary', 'text', 'content'])
      if (typeof object[key] === 'string') return object[key];
    return JSON.stringify(value, null, 2);
  }
  return 'No retained response is available.';
}
export function AIResearchScreen() {
  const research = useApiQuery<Research[]>('research', '/ai/research?limit=25&offset=0');
  const summary = useApiQuery<MarketSummary>('sentiment-summary', '/ai/market-summary');
  return (
    <Screen
      title="AI research"
      subtitle="Explore your retained research and market sentiment."
      refreshing={research.isRefetching}
      onRefresh={() => {
        void research.refetch();
        void summary.refetch();
      }}
    >
      {summary.data && (
        <Card>
          <Copy>Market sentiment · last 24 hours</Copy>
          <Row title="Analyzed articles" value={String(summary.data.analyzed_articles)} />
          <Row
            title="Positive / negative"
            value={summary.data.positive_articles + ' / ' + summary.data.negative_articles}
          />
        </Card>
      )}
      <ErrorNotice error={summary.error} onRetry={() => void summary.refetch()} />
      {research.isLoading && <Loading />}
      <ErrorNotice error={research.error} onRetry={() => void research.refetch()} />
      {research.data?.map((item) => (
        <Card key={item.id}>
          <Copy>
            {item.symbol ?? 'MARKET'} · {item.research_type}
          </Copy>
          <Row
            title={item.question || 'Research report'}
            subtitle={new Date(item.generated_at).toLocaleString() + ' · ' + item.provider}
          />
          <Copy>{researchText(item.response)}</Copy>
        </Card>
      ))}
      {research.data?.length === 0 && (
        <EmptyState text="No retained AI research yet. New reports appear when the server research service produces them." />
      )}
      <Copy>Research is educational and may be incomplete. It is not investment advice.</Copy>
    </Screen>
  );
}
