import { createContext, useContext } from 'react';
import type { SessionSnapshot } from '../auth/session';
export const SessionContext = createContext<SessionSnapshot | null>(null);
export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('Session provider is missing');
  return value;
}
