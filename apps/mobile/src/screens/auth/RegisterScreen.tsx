import { useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, Card, Copy, ErrorNotice, Field, Notice, Screen } from '../../components/ui';
import { api, session } from '../../services/runtime';
import type { AuthParams } from '../../navigation/types';
export function RegisterScreen({ navigation }: NativeStackScreenProps<AuthParams, 'Register'>) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (password !== confirm) throw new Error('Passwords do not match.');
      if (password.length < 12) throw new Error('Use a password with at least 12 characters.');
      const result = await session.register(email, password, name);
      setNotice(result.message + ' Verify your email before signing in.');
      setPassword('');
      setConfirm('');
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };
  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.request('/auth/email/verify', {
        public: true,
        method: 'POST',
        body: { token: token.trim() },
      });
      setNotice('Email verified. You can now sign in.');
      setToken('');
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen title="Start with confidence" subtitle="Create your educational paper-trading account.">
      <Card>
        <Field label="Full name" value={name} onChangeText={setName} autoComplete="name" />
        <Field
          label="Email address"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
        />
        <Field
          label="Password · at least 12 characters"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="new-password"
        />
        <Field
          label="Confirm password"
          value={confirm}
          onChangeText={setConfirm}
          secureTextEntry
          autoCapitalize="none"
        />
        <ErrorNotice error={error} />
        {notice && <Notice>{notice}</Notice>}
        <Button
          title="Create account"
          busy={busy}
          disabled={!name.trim() || !email.trim() || !password}
          onPress={() => void submit()}
        />
        <Button secondary title="Back to sign in" onPress={() => navigation.navigate('Login')} />
      </Card>
      {notice && (
        <Card>
          <Copy>If your verification email includes a token, you can verify it here.</Copy>
          <Field
            label="Email verification token"
            value={token}
            onChangeText={setToken}
            autoCapitalize="none"
          />
          <Button
            title="Verify email"
            busy={busy}
            disabled={!token.trim()}
            onPress={() => void verify()}
          />
        </Card>
      )}
    </Screen>
  );
}
