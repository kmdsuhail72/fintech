import { useEffect, useState } from 'react';
import { requestApi } from './api.js';

export function RecoveryPage({ reset = false }: { reset?: boolean }) {
  const [token] = useState(() => {
    const value =
      new URLSearchParams(window.location.hash.slice(1)).get('token') ??
      new URLSearchParams(window.location.search).get('token') ??
      '';
    return value;
  });
  useEffect(() => {
    window.history.replaceState(null, '', window.location.pathname);
  }, []);
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <main className="page">
      <h1>{reset ? 'Reset password' : 'Verify email'}</h1>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          void requestApi(reset ? '/auth/reset-password' : '/auth/verify-email', {
            method: 'POST',
            body: { token, ...(reset ? { password } : {}) },
          })
            .then(() =>
              setMessage(
                reset ? 'Password reset. You can sign in.' : 'Email verified. You can sign in.',
              ),
            )
            .catch((error: Error) => setMessage(error.message))
            .finally(() => setBusy(false));
        }}
      >
        {reset && (
          <label>
            New password
            <input
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
        )}
        <button disabled={busy || !token} type="submit">
          {busy ? 'Submitting…' : 'Confirm'}
        </button>
        {!token && <p role="alert">This link is missing its token. Request a new link.</p>}
        {message && <p role="status">{message}</p>}
      </form>
    </main>
  );
}
