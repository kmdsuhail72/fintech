import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  biometricsAvailable,
  disableBiometricUnlock,
  enableBiometricUnlock,
  setLocalPin,
  verifyLocalPin,
} from '../../auth/localUnlock';
import { Button, Card, Copy, ErrorNotice, Field, Notice, Row, Screen } from '../../components/ui';
import { useApiQuery } from '../../hooks/useApiQuery';
import { api, session } from '../../services/runtime';
import {
  disablePushNotifications,
  enrollPushNotifications,
  notificationsEnabled,
} from '../../notifications/service';
import { errorMessage } from '../../theme/tokens';
type Notification = {
  id: string;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
};
export function SettingsScreen() {
  const [current, setCurrent] = useState('');
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [hardware, setHardware] = useState(false);
  const [push, setPush] = useState(false);
  const notifications = useApiQuery<Notification[]>(
    'notifications',
    '/notifications?limit=25&offset=0',
  );
  const client = useQueryClient();
  useEffect(() => {
    void biometricsAvailable()
      .then(setHardware)
      .catch(() => {});
    void notificationsEnabled()
      .then(setPush)
      .catch(() => {});
  }, []);
  const action = async (operation: () => Promise<void>, message: string) => {
    setBusy(true);
    setError(null);
    setNotice('');
    try {
      await operation();
      setNotice(message);
    } catch (failure) {
      setError(new Error(errorMessage(failure)));
    } finally {
      setBusy(false);
    }
  };
  const changePin = async () => {
    if (pin !== confirm) throw new Error('New PIN entries do not match.');
    if (!(await verifyLocalPin(current))) throw new Error('Current PIN did not match.');
    await setLocalPin(pin);
    setCurrent('');
    setPin('');
    setConfirm('');
  };
  const markRead = useMutation({
    mutationFn: (id: string) => api.request('/notifications/' + id + '/read', { method: 'PATCH' }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['notifications'] }),
  });
  return (
    <Screen title="Settings" subtitle="Device security, notifications, and account preferences.">
      <ErrorNotice error={error} />
      {notice && <Notice>{notice}</Notice>}
      <Card>
        <Copy>Device unlock</Copy>
        {hardware && (
          <Button
            title="Enable Face ID / fingerprint"
            secondary
            disabled={busy}
            onPress={() =>
              void action(async () => {
                if (!(await enableBiometricUnlock()))
                  throw new Error('Biometric enrollment was cancelled.');
              }, 'Biometric unlock enabled.')
            }
          />
        )}
        <Button
          title="Disable biometric unlock"
          secondary
          disabled={busy}
          onPress={() => void action(disableBiometricUnlock, 'Biometric unlock disabled.')}
        />
        <Field
          label="Current device PIN"
          value={current}
          onChangeText={setCurrent}
          secureTextEntry
          keyboardType="number-pad"
          maxLength={12}
        />
        <Field
          label="New PIN · 6 to 12 digits"
          value={pin}
          onChangeText={setPin}
          secureTextEntry
          keyboardType="number-pad"
          maxLength={12}
        />
        <Field
          label="Confirm new PIN"
          value={confirm}
          onChangeText={setConfirm}
          secureTextEntry
          keyboardType="number-pad"
          maxLength={12}
        />
        <Button
          title="Change PIN"
          disabled={busy || current.length < 6 || pin.length < 6}
          onPress={() => void action(changePin, 'Device PIN updated.')}
        />
      </Card>
      <Card>
        <Copy>Notifications</Copy>
        <Button
          title={push ? 'Disable remote notifications' : 'Enable remote notifications'}
          secondary
          disabled={busy}
          onPress={() =>
            void action(
              async () => {
                if (push) {
                  await disablePushNotifications();
                  setPush(false);
                } else {
                  await enrollPushNotifications();
                  setPush(true);
                }
              },
              push ? 'Remote notifications disabled.' : 'Device registered for notifications.',
            )
          }
        />
        <Copy>Remote notification delivery requires a configured server notification service.</Copy>
        <ErrorNotice
          error={notifications.error ?? markRead.error}
          onRetry={() => void notifications.refetch()}
        />
        {notifications.data?.map((item) => (
          <Row key={item.id} title={item.title} subtitle={item.body}>
            {!item.read_at && (
              <Button
                title="Mark read"
                secondary
                disabled={markRead.isPending}
                onPress={() => markRead.mutate(item.id)}
              />
            )}
          </Row>
        ))}
      </Card>
      <Button
        title="Sign out"
        danger
        disabled={busy}
        onPress={() => void action(() => session.logout(), 'Signed out.')}
      />
      <Copy>Asteriq AI · Virtual funds · Simulated market data</Copy>
    </Screen>
  );
}
