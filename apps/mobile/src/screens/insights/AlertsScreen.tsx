import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Card,
  Copy,
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
import type { Instrument, PriceAlert } from '../../services/types';
import { money } from '../../theme/tokens';
export function AlertsScreen() {
  const alerts = useApiQuery<PriceAlert[]>('alerts', '/alerts');
  const instruments = useApiQuery<Instrument[]>('instruments', '/market/symbols?limit=50&offset=0');
  const client = useQueryClient();
  const [selected, setSelected] = useState<Instrument | undefined>();
  const [condition, setCondition] = useState<'ABOVE' | 'BELOW' | 'CHANGE_PERCENT'>('ABOVE');
  const [channels, setChannels] = useState<'IN_APP' | 'EMAIL' | 'PUSH' | 'ALL'>('IN_APP');
  const [target, setTarget] = useState('');
  const create = useMutation({
    mutationFn: async () => {
      if (!selected || !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,8})?$/.test(target) || Number(target) <= 0)
        throw new Error('Choose a symbol and a positive target price.');
      await api.request('/alerts', {
        method: 'POST',
        body: {
          symbolId: selected.id,
          condition,
          ...(condition === 'CHANGE_PERCENT'
            ? { targetChangePercent: target }
            : { targetPrice: target }),
          channels:
            channels === 'ALL'
              ? ['IN_APP', 'EMAIL', 'PUSH']
              : channels === 'IN_APP'
                ? ['IN_APP']
                : ['IN_APP', channels],
          currency: selected.quote_currency,
        },
      });
    },
    onSuccess: async () => {
      setTarget('');
      await client.invalidateQueries({ queryKey: ['alerts'] });
    },
  });
  const update = useMutation({
    mutationFn: (input: { id: string; status: 'ACTIVE' | 'PAUSED' | 'CANCELLED' }) =>
      api.request('/alerts/' + input.id, { method: 'PATCH', body: { status: input.status } }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['alerts'] }),
  });
  return (
    <Screen
      title="Price alerts"
      subtitle="Follow price levels in simulated markets."
      refreshing={alerts.isRefetching}
      onRefresh={() => void alerts.refetch()}
    >
      <Card>
        <SymbolPicker
          instruments={instruments.data ?? []}
          selected={selected}
          onSelect={setSelected}
        />
        <Segmented
          options={['ABOVE', 'BELOW', 'CHANGE_PERCENT'] as const}
          value={condition}
          onChange={setCondition}
        />
        <Field
          label={
            condition === 'CHANGE_PERCENT'
              ? 'Absolute change from previous close (%)'
              : 'Target price'
          }
          value={target}
          onChangeText={setTarget}
          keyboardType="decimal-pad"
        />
        <Segmented
          options={['IN_APP', 'EMAIL', 'PUSH', 'ALL'] as const}
          value={channels}
          onChange={setChannels}
        />
        <Copy>
          Email requires a verified address. Push requires an enrolled device. Alerts trigger once.
        </Copy>
        <Button
          title="Create alert"
          busy={create.isPending}
          disabled={!selected || !target}
          onPress={() => create.mutate()}
        />
        <ErrorNotice error={create.error ?? instruments.error} />
      </Card>
      {alerts.isLoading && <Loading />}
      <ErrorNotice error={alerts.error ?? update.error} onRetry={() => void alerts.refetch()} />
      <Card>
        {alerts.data?.map((alert) => (
          <Row
            key={alert.id}
            title={
              alert.symbol +
              ' · ' +
              alert.condition.toLowerCase() +
              ' ' +
              (alert.condition === 'CHANGE_PERCENT'
                ? `${alert.target_change_percent}% absolute change`
                : money(alert.target_price ?? '0', alert.currency))
            }
            subtitle={alert.status}
          >
            {['ACTIVE', 'PAUSED'].includes(alert.status) && (
              <Button
                title={alert.status === 'ACTIVE' ? 'Pause alert' : 'Resume alert'}
                secondary
                busy={update.isPending && update.variables?.id === alert.id}
                disabled={update.isPending}
                onPress={() =>
                  update.mutate({
                    id: alert.id,
                    status: alert.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE',
                  })
                }
              />
            )}
          </Row>
        ))}
        {alerts.data?.length === 0 && <EmptyState text="No price alerts yet." />}
      </Card>
      <Copy>Alert delivery depends on the server's alert evaluation and notification service.</Copy>
    </Screen>
  );
}
