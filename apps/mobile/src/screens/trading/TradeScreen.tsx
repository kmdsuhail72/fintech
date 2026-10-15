import { useEffect, useState } from 'react';
import { Modal } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import {
  Button,
  Card,
  Copy,
  EmptyState,
  ErrorNotice,
  Field,
  Loading,
  Metric,
  Notice,
  Row,
  Screen,
  Segmented,
} from '../../components/ui';
import { SymbolPicker } from '../../components/SymbolPicker';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useLiveQuotes } from '../../hooks/useLiveQuotes';
import { api } from '../../services/runtime';
import { validateTrade } from '../../services/tradeValidation';
import type { Instrument, Order, Portfolio, Trade } from '../../services/types';
import { money } from '../../theme/tokens';
import type { TabParams } from '../../navigation/types';
type Draft = {
  portfolioId: string;
  symbolId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: string;
  price: string;
  currency: string;
  idempotencyKey: string;
};
export function TradeScreen({ route }: BottomTabScreenProps<TabParams, 'Trade'>) {
  const instruments = useApiQuery<Instrument[]>('instruments', '/market/symbols?limit=50&offset=0');
  const [selected, setSelected] = useState<Instrument | undefined>(route.params?.instrument);
  const asset = selected ?? instruments.data?.[0];
  useEffect(() => {
    if (route.params?.instrument) setSelected(route.params.instrument);
  }, [route.params?.instrument]);
  const rows = asset
    ? [asset, ...(instruments.data ?? []).filter((item) => item.id !== asset.id)]
    : (instruments.data ?? []);
  const live = useLiveQuotes(asset ? [asset] : []);
  const quote = asset ? live.quotes.get(asset.symbol) : undefined;
  const portfolios = useApiQuery<Portfolio[]>('portfolio', '/portfolio');
  const portfolio = portfolios.data?.[0];
  const position = portfolio?.positions.find((item) => item.symbolId === asset?.id);
  const orders = useApiQuery<Order[]>('orders', '/orders?limit=50&offset=0');
  const trades = useApiQuery<Trade[]>('trades', '/trades?limit=50&offset=0');
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [quantity, setQuantity] = useState('1');
  const [tab, setTab] = useState<'Open orders' | 'Order history' | 'Trade history'>('Open orders');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [notice, setNotice] = useState('');
  const client = useQueryClient();
  const refresh = () =>
    Promise.all(
      ['portfolio', 'analytics', 'orders', 'trades'].map((key) =>
        client.invalidateQueries({ queryKey: [key] }),
      ),
    );
  const submit = useMutation({
    mutationFn: (review: Draft) =>
      api.request<Order>('/orders', {
        method: 'POST',
        body: {
          portfolioId: review.portfolioId,
          symbolId: review.symbolId,
          side: review.side,
          quantity: review.quantity,
          idempotencyKey: review.idempotencyKey,
        },
      }),
    onSuccess: async (order) => {
      setDraft(null);
      setNotice(
        order.side + ' ' + order.quantity + ' ' + order.symbol + ' · ' + order.status.toLowerCase(),
      );
      await refresh();
    },
    onError: async () => {
      await refresh();
    },
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api.request('/orders/' + id, { method: 'DELETE' }),
    onSuccess: async () => {
      setNotice('Paper order cancelled.');
      await refresh();
    },
  });
  const validation = validateTrade({
    quantity,
    side,
    cash: portfolios.isError ? undefined : portfolio?.cash_balance,
    shares: position?.quantity ?? '0',
    quote,
    currency: portfolio?.base_currency,
  });
  const shown = (orders.data ?? []).filter(
    (order) => tab !== 'Open orders' || ['PENDING', 'PARTIALLY_FILLED'].includes(order.status),
  );
  const review = () => {
    if (!asset || !portfolio || !quote || validation) return;
    submit.reset();
    setDraft({
      portfolioId: portfolio.portfolio_id,
      symbolId: asset.id,
      symbol: asset.symbol,
      side,
      quantity,
      price: quote.price,
      currency: quote.currency,
      idempotencyKey: randomUUID(),
    });
  };
  return (
    <Screen title="Paper trade" subtitle="Practice your strategy with virtual funds.">
      {notice && <Notice>{notice}</Notice>}
      <ErrorNotice
        error={instruments.error ?? portfolios.error}
        onRetry={() => {
          void instruments.refetch();
          void portfolios.refetch();
        }}
      />
      {instruments.isLoading && <Loading />}
      <Card>
        <Segmented options={['BUY', 'SELL'] as const} value={side} onChange={setSide} />
        <SymbolPicker instruments={rows} selected={asset} onSelect={setSelected} />
        <Metric label="CURRENT MARKET PRICE" value={money(quote?.price, asset?.quote_currency)} />
        <Field
          label="Quantity · shares"
          value={quantity}
          onChangeText={setQuantity}
          keyboardType="decimal-pad"
        />
        <Metric
          label="Estimated trade value"
          value={money(Number(quantity || 0) * Number(quote?.price ?? 0), asset?.quote_currency)}
        />
        <Copy>
          {side === 'BUY'
            ? 'Available balance: ' + money(portfolio?.cash_balance, portfolio?.base_currency)
            : 'Available shares: ' + (position?.quantity ?? '0')}
        </Copy>
        {validation && <Copy>{validation}</Copy>}
        <ErrorNotice error={live.error} onRetry={() => void live.refetch()} />
        <Button
          title={'Review ' + side.toLowerCase() + ' order'}
          disabled={Boolean(validation) || !asset || portfolios.isLoading}
          onPress={review}
        />
        <Copy>Market orders use the latest server quote and usually fill immediately.</Copy>
      </Card>
      <Card>
        <Segmented
          options={['Open orders', 'Order history', 'Trade history'] as const}
          value={tab}
          onChange={setTab}
        />
        <ErrorNotice
          error={tab === 'Trade history' ? trades.error : orders.error}
          onRetry={() => {
            void trades.refetch();
            void orders.refetch();
          }}
        />
        <ErrorNotice error={cancel.error} />
        {(tab === 'Trade history' ? trades.isLoading : orders.isLoading) && <Loading />}
        {tab === 'Trade history'
          ? (trades.data ?? []).map((trade) => (
              <Row
                key={trade.id}
                title={trade.side + ' ' + trade.symbol}
                subtitle={
                  trade.quantity + ' shares · ' + new Date(trade.executed_at).toLocaleString()
                }
                value={money(Number(trade.quantity) * Number(trade.price), trade.currency)}
              />
            ))
          : shown.map((order) => (
              <Row
                key={order.id}
                title={order.side + ' ' + order.symbol}
                subtitle={order.quantity + ' shares · ' + order.status}
                value={money(order.average_fill_price, portfolio?.base_currency)}
              >
                {['PENDING', 'PARTIALLY_FILLED'].includes(order.status) && (
                  <Button
                    title="Cancel order"
                    secondary
                    busy={cancel.isPending && cancel.variables === order.id}
                    disabled={cancel.isPending}
                    onPress={() => cancel.mutate(order.id)}
                  />
                )}
              </Row>
            ))}
        {!(tab === 'Trade history' ? trades.data?.length : shown.length) && (
          <EmptyState
            text={
              tab === 'Open orders'
                ? 'No open orders. Filled market orders appear in history.'
                : 'No recorded activity yet.'
            }
          />
        )}
      </Card>
      <Modal
        visible={draft !== null}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!submit.isPending) setDraft(null);
        }}
      >
        {draft && (
          <Screen fullScreen title="Confirm paper order">
            <Card>
              <Metric
                label={draft.side + ' ' + draft.symbol}
                value={money(Number(draft.quantity) * Number(draft.price), draft.currency)}
              />
              <Copy>
                {draft.quantity} shares · Estimated value. Final execution uses the server's latest
                price.
              </Copy>
              <ErrorNotice error={submit.error} />
              <Button
                title={'Confirm ' + draft.side.toLowerCase()}
                busy={submit.isPending}
                onPress={() => submit.mutate(draft)}
              />
              <Button
                title="Back"
                secondary
                disabled={submit.isPending}
                onPress={() => setDraft(null)}
              />
            </Card>
          </Screen>
        )}
      </Modal>
    </Screen>
  );
}
