import { useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Card,
  Copy,
  ErrorNotice,
  Loading,
  Metric,
  Notice,
  Screen,
  Segmented,
} from '../../components/ui';
import { PriceChart } from '../../components/PriceChart';
import { ranges, rangeRequests } from '../../config/chart';
import type { ChartRange } from '../../config/chart';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useLiveQuotes } from '../../hooks/useLiveQuotes';
import { api } from '../../services/runtime';
import type { CandleResponse, Watchlist } from '../../services/types';
import { money } from '../../theme/tokens';
import type { RootParams } from '../../navigation/types';
export function StockDetailScreen({
  route,
  navigation,
}: NativeStackScreenProps<RootParams, 'StockDetail'>) {
  const { instrument } = route.params;
  const [range, setRange] = useState<ChartRange>('1D');
  const request = rangeRequests[range];
  const live = useLiveQuotes([instrument]);
  const quote = live.quotes.get(instrument.symbol);
  const history = useApiQuery<CandleResponse>(
    'candles',
    '/market/quotes/' +
      encodeURIComponent(instrument.symbol) +
      '/candles?interval=' +
      request.interval +
      '&limit=' +
      request.limit,
    { interval: 15000 },
  );
  const lists = useApiQuery<Watchlist[]>('watchlists', '/watchlists');
  const client = useQueryClient();
  const [notice, setNotice] = useState('');
  const save = useMutation({
    mutationFn: async () => {
      const target =
        lists.data?.[0] ??
        (await api.request<{ id: string }>('/watchlists', {
          method: 'POST',
          body: { name: 'My watchlist' },
        }));
      await api.request('/watchlists/' + target.id + '/items', {
        method: 'POST',
        body: { symbolId: instrument.id },
      });
    },
    onSuccess: async () => {
      setNotice('Saved to your watchlist.');
      await client.invalidateQueries({ queryKey: ['watchlists'] });
    },
  });
  const saved = lists.data?.some((list) =>
    list.items.some((item) => item.symbolId === instrument.id),
  );
  return (
    <Screen
      title={instrument.symbol}
      subtitle={instrument.company_name + ' · ' + instrument.exchange_code}
    >
      <Card>
        <Metric
          label="CURRENT MARKET PRICE"
          value={money(quote?.price, instrument.quote_currency)}
        />
        <Copy
          positive={Number(quote?.changePercent ?? 0) >= 0}
          negative={Number(quote?.changePercent ?? 0) < 0}
        >
          {quote
            ? Number(quote.changePercent).toFixed(2) +
              '% · ' +
              new Date(quote.timestamp).toLocaleTimeString()
            : 'Waiting for a current quote'}
        </Copy>
        <ErrorNotice error={live.error} onRetry={() => void live.refetch()} />
        <Segmented options={ranges} value={range} onChange={setRange} />
        {history.isLoading ? (
          <Loading label="Loading price history…" />
        ) : (
          <PriceChart
            data={history.data?.candles ?? []}
            symbol={instrument.symbol}
            range={range}
            currency={instrument.quote_currency}
          />
        )}
        <ErrorNotice error={history.error} onRetry={() => void history.refetch()} />
      </Card>
      <Button
        title={'Trade ' + instrument.symbol}
        onPress={() => navigation.navigate('Main', { screen: 'Trade', params: { instrument } })}
      />
      <Button
        title={saved ? 'In your watchlist' : 'Add to watchlist'}
        secondary
        busy={save.isPending}
        disabled={Boolean(saved) || lists.isLoading || lists.isError}
        onPress={() => save.mutate()}
      />
      <ErrorNotice error={save.error ?? lists.error} />
      {notice && <Notice>{notice}</Notice>}
    </Screen>
  );
}
