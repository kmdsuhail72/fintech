import { SessionController } from '../auth/session';
import {
  clearLocalAuthentication,
  hasLocalPin,
  readRefreshToken,
  storeRefreshToken,
} from '../auth/localUnlock';
import { API_URL } from '../config/env';
import { ApiClient } from './client';
export const session = new SessionController(API_URL, {
  read: readRefreshToken,
  write: storeRefreshToken,
  clear: clearLocalAuthentication,
  hasPin: hasLocalPin,
});
export const api = new ApiClient(API_URL, session);
