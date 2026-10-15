import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import {
  biometricUnlock,
  biometricsAvailable,
  setLocalPin,
  verifyLocalPin,
} from '../../auth/localUnlock';
import { Button, Card, Copy, ErrorNotice, Field, Screen } from '../../components/ui';
import { useSession } from '../../hooks/useSession';
import { session } from '../../services/runtime';
export function BiometricUnlockScreen() {
  const { status, user } = useSession();
  const setup = status === 'setupPin';
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    void biometricsAvailable()
      .then(setAvailable)
      .catch(() => setAvailable(false));
  }, []);
  const unlock = async (biometric = false) => {
    setBusy(true);
    setError(null);
    try {
      if (setup) {
        if (pin !== confirm) throw new Error('PIN entries do not match.');
        await setLocalPin(pin);
        if (AppState.currentState !== 'active') throw new Error('Return to the app to continue.');
        session.completePinSetup();
      } else {
        const valid = biometric ? await biometricUnlock() : await verifyLocalPin(pin);
        if (!valid)
          throw new Error(
            biometric
              ? 'Biometric unlock was cancelled or is not enabled. Use your PIN.'
              : 'PIN did not match.',
          );
        if (AppState.currentState !== 'active')
          throw new Error('Unlock was interrupted. Please retry.');
        await session.unlock(true);
      }
      setPin('');
      setConfirm('');
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen
      fullScreen
      title={setup ? 'Protect your account' : 'Unlock Asteriq AI'}
      subtitle={
        setup
          ? 'Create a device PIN before opening your portfolio.'
          : (user?.email ?? 'Your session is securely stored on this device.')
      }
    >
      <Card>
        <Field
          label={setup ? 'Create PIN · 6 to 12 digits' : 'Device PIN'}
          value={pin}
          onChangeText={setPin}
          keyboardType="number-pad"
          secureTextEntry
          maxLength={12}
          autoComplete="off"
        />
        {setup && (
          <Field
            label="Confirm PIN"
            value={confirm}
            onChangeText={setConfirm}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={12}
            autoComplete="off"
          />
        )}
        <ErrorNotice error={error} />
        <Button
          title={setup ? 'Save PIN and continue' : 'Unlock with PIN'}
          busy={busy}
          disabled={pin.length < 6}
          onPress={() => void unlock()}
        />
        {!setup && available && (
          <Button
            title="Use Face ID / fingerprint"
            secondary
            disabled={busy}
            onPress={() => void unlock(true)}
          />
        )}
        <Button
          title="Use a different account"
          secondary
          disabled={busy}
          onPress={() => {
            void session.logout().catch(() => {});
          }}
        />
      </Card>
      <Copy>
        Your PIN and biometric verification stay on this device. Your account still uses server
        authentication.
      </Copy>
    </Screen>
  );
}
