import { Platform } from 'react-native';
export const API_URL = (
  process.env.EXPO_PUBLIC_API_URL ??
  (Platform.OS === 'android' ? 'http://10.0.2.2:3000/api/v1' : 'http://localhost:3000/api/v1')
).replace(/\/$/, '');
export const SOCKET_URL = process.env.EXPO_PUBLIC_SOCKET_URL ?? API_URL.replace(/\/api\/v1$/, '');
