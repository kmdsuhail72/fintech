import { useState } from 'react';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  Card,
  Copy,
  EmptyState,
  ErrorNotice,
  Field,
  Loading,
  Row,
  Screen,
} from '../../components/ui';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useLiveQuotes } from '../../hooks/useLiveQuotes';
import { money } from '../../theme/tokens';
import type { Instrument } from '../../services/types';
import type { RootParams, TabParams } from '../../navigation/types';
export function MarketsScreen({ navigation }: BottomTabScreenProps<TabParams, 'Markets'>) {
  const [search, setSearch] = useState('');
  const instruments = useApiQuery<Instrument[]>('instruments', '/market/symbols?limit=50&offset=0');
  const rows = instruments.data ?? [];
  const live = useLiveQuotes(rows);
  const filtered = rows.filter((item) =>
    (item.symbol + ' ' + item.company_name).toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <Screen
      title="Markets"
      subtitle="Discover stocks and follow simulated prices."
      refreshing={instruments.isRefetching}
      onRefresh={() => {
        void instruments.refetch();
        void live.refetch();
      }}
    >
      <Field
        label="Search symbols or companies"
        value={search}
        onChangeText={setSearch}
        autoCapitalize="none"
      />
      <Copy>
        {live.connection === 'live' ? '● Streaming market prices' : '● REST price updates'} · Paper
        trading
      </Copy>
      {instruments.isLoading && <Loading />}
      <ErrorNotice
        error={instruments.error ?? live.error}
        onRetry={() => {
          void instruments.refetch();
          void live.refetch();
        }}
      />
      <Card>
        {filtered.map((instrument) => {
          const quote = live.quotes.get(instrument.symbol);
          return (
            <Row
              key={instrument.id}
              title={instrument.symbol}
              subtitle={instrument.company_name}
              value={money(quote?.price ?? instrument.price, instrument.quote_currency)}
              onPress={() =>
                navigation
                  .getParent<NativeStackNavigationProp<RootParams>>()
                  ?.navigate('StockDetail', { instrument })
              }
            >
              <Copy
                positive={Number(quote?.changePercent ?? 0) >= 0}
                negative={Number(quote?.changePercent ?? 0) < 0}
              >
                {quote ? Number(quote.changePercent).toFixed(2) + '%' : 'Quote loading'}
              </Copy>
            </Row>
          );
        })}
        {!filtered.length && !instruments.isLoading && (
          <EmptyState text="No matching market symbols." />
        )}
      </Card>
    </Screen>
  );
}
