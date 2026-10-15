import { useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, Card, Copy, ErrorNotice, Field, Screen } from '../../components/ui';
import { session } from '../../services/runtime';
import type { AuthParams } from '../../navigation/types';
export function LoginScreen({ navigation }: NativeStackScreenProps<AuthParams, 'Login'>) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const login = async () => {
    setBusy(true);
    setError(null);
    try {
      await session.login(email, password);
      setPassword('');
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen title="Welcome back" subtitle="Your Asteriq AI paper portfolio is ready.">
      <Card>
        <Field
          label="Email address"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="current-password"
        />
        <ErrorNotice error={error} />
        <Button
          title="Sign in"
          busy={busy}
          disabled={!email.trim() || !password}
          onPress={() => void login()}
        />
        <Button
          secondary
          title="Create an account"
          disabled={busy}
          onPress={() => navigation.navigate('Register')}
        />
      </Card>
      <Copy>Practice with virtual funds and simulated market data. No real-money orders.</Copy>
    </Screen>
  );
}
