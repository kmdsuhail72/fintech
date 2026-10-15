import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { randomUUID } from 'expo-crypto';
import { api } from '../services/runtime';
const installationKey = 'asteriq.push.installation.v1';
const enabledKey = 'asteriq.push.enabled.v1';
import { parseNotificationTarget } from './routing';
import type { NotificationTarget } from './routing';
export type { NotificationTarget } from './routing';
let lastResponseId = '';
export function configureNotificationPresentation() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: false,
      shouldShowBanner: false,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}
async function installationId() {
  const existing = await SecureStore.getItemAsync(installationKey);
  if (existing) return existing;
  const id = randomUUID();
  await SecureStore.setItemAsync(installationKey, id);
  return id;
}
export async function notificationsEnabled() {
  return (await SecureStore.getItemAsync(enabledKey)) === 'enabled';
}
export async function enrollPushNotifications(requestPermission = true) {
  if (!Device.isDevice || Platform.OS === 'web')
    throw new Error('Remote notifications require a physical iOS or Android device.');
  if (Constants.appOwnership === 'expo')
    throw new Error('Use an Expo development build to enable remote notifications.');
  const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID || Constants.easConfig?.projectId;
  if (!projectId) throw new Error('Push notifications are not configured for this build yet.');
  if (Platform.OS === 'android')
    await Notifications.setNotificationChannelAsync('market-alerts', {
      name: 'Market alerts',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && requestPermission)
    permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) throw new Error('Notifications are disabled in device settings.');
  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  await api.request('/notifications/devices', {
    method: 'POST',
    body: { installationId: await installationId(), token: token.data, platform: Platform.OS },
  });
  await SecureStore.setItemAsync(enabledKey, 'enabled');
}
export async function disablePushNotifications() {
  const id = await SecureStore.getItemAsync(installationKey);
  if (id) await api.request('/notifications/devices/' + id, { method: 'DELETE' });
  await SecureStore.deleteItemAsync(enabledKey);
}
export function subscribeToNotifications(onTarget: (target: NotificationTarget) => void) {
  const handle = (response: Notifications.NotificationResponse) => {
    const id = response.notification.request.identifier;
    if (id === lastResponseId) return;
    lastResponseId = id;
    const target = parseNotificationTarget(response.notification.request.content.data);
    if (target) onTarget(target);
  };
  const listener = Notifications.addNotificationResponseReceivedListener(handle);
  void Notifications.getLastNotificationResponseAsync()
    .then((response) => {
      if (response) handle(response);
    })
    .catch(() => {});
  return () => listener.remove();
}
