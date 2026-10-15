import { useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  Field,
  Loading,
  Row,
  Screen,
  Segmented,
} from '../../components/ui';
import { SymbolPicker } from '../../components/SymbolPicker';
import { useApiQuery } from '../../hooks/useApiQuery';
import { api } from '../../services/runtime';
import type { Instrument, Watchlist } from '../../services/types';
import type { RootParams } from '../../navigation/types';
export function WatchlistScreen({ navigation }: NativeStackScreenProps<RootParams, 'Watchlist'>) {
  const lists = useApiQuery<Watchlist[]>('watchlists', '/watchlists');
  const instruments = useApiQuery<Instrument[]>('instruments', '/market/symbols?limit=50&offset=0');
  const client = useQueryClient();
  const [selectedId, setSelectedId] = useState('');
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Instrument | undefined>();
  const list = lists.data?.find((item) => item.id === selectedId) ?? lists.data?.[0];
  const refresh = () => client.invalidateQueries({ queryKey: ['watchlists'] });
  const create = useMutation({
    mutationFn: () =>
      api.request<Watchlist>('/watchlists', { method: 'POST', body: { name: name.trim() } }),
    onSuccess: async (result) => {
      setName('');
      setSelectedId(result.id);
      await refresh();
    },
  });
  const add = useMutation({
    mutationFn: async () => {
      if (!list || !selected) throw new Error('Choose a watchlist and symbol.');
      await api.request('/watchlists/' + list.id + '/items', {
        method: 'POST',
        body: { symbolId: selected.id },
      });
    },
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (symbolId: string) =>
      api.request('/watchlists/' + list!.id + '/items/' + symbolId, { method: 'DELETE' }),
    onSuccess: refresh,
  });
  return (
    <Screen
      title="Watchlist"
      subtitle="Your saved markets, synced across devices."
      refreshing={lists.isRefetching}
      onRefresh={() => void lists.refetch()}
    >
      {lists.isLoading && <Loading />}
      <ErrorNotice
        error={lists.error ?? instruments.error}
        onRetry={() => {
          void lists.refetch();
          void instruments.refetch();
        }}
      />
      {lists.data && lists.data.length > 0 && (
        <Segmented
          options={lists.data.map((item) => item.id)}
          value={list?.id ?? ''}
          labels={Object.fromEntries(lists.data.map((item) => [item.id, item.name]))}
          onChange={setSelectedId}
        />
      )}
      <Card>
        <Field label="New watchlist name" value={name} onChangeText={setName} maxLength={80} />
        <Button
          title="Create watchlist"
          busy={create.isPending}
          disabled={!name.trim()}
          onPress={() => create.mutate()}
        />
        <ErrorNotice error={create.error} />
      </Card>
      {list && (
        <Card>
          <Field label="Selected watchlist" value={list.name} editable={false} />
          <SymbolPicker
            instruments={instruments.data ?? []}
            selected={selected}
            onSelect={setSelected}
          />
          <Button
            title="Save symbol"
            busy={add.isPending}
            disabled={!selected || list.items.some((item) => item.symbolId === selected.id)}
            onPress={() => add.mutate()}
          />
          <ErrorNotice error={add.error ?? remove.error} />
          {list.items.map((item) => (
            <Row
              key={item.symbolId}
              title={item.symbol}
              subtitle={item.companyName}
              onPress={() =>
                navigation.navigate('StockDetail', {
                  instrument: instruments.data?.find((asset) => asset.id === item.symbolId) ?? {
                    id: item.symbolId,
                    symbol: item.symbol,
                    company_name: item.companyName,
                    quote_currency: 'USD',
                    exchange_code: 'US market',
                    price: null,
                  },
                })
              }
            >
              <Button
                title="Remove"
                secondary
                busy={remove.isPending && remove.variables === item.symbolId}
                disabled={remove.isPending}
                onPress={() => remove.mutate(item.symbolId)}
              />
            </Row>
          ))}
          {!list.items.length && (
            <EmptyState text="Save a symbol to start following this watchlist." />
          )}
        </Card>
      )}
    </Screen>
  );
}
