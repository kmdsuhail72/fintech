import { useEffect, useRef } from 'react';
import { Text } from 'react-native';
import {
  DarkTheme,
  NavigationContainer,
  createNavigationContainerRef,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { hideAsync } from 'expo-splash-screen';
import { useSession } from '../hooks/useSession';
import { colors } from '../theme/tokens';
import { SplashScreen } from '../screens/auth/SplashScreen';
import { LoginScreen } from '../screens/auth/LoginScreen';
import { RegisterScreen } from '../screens/auth/RegisterScreen';
import { BiometricUnlockScreen } from '../screens/auth/BiometricUnlockScreen';
import { DashboardScreen } from '../screens/account/DashboardScreen';
import { MarketsScreen } from '../screens/market/MarketsScreen';
import { StockDetailScreen } from '../screens/market/StockDetailScreen';
import { TradeScreen } from '../screens/trading/TradeScreen';
import { PortfolioScreen } from '../screens/account/PortfolioScreen';
import { WatchlistScreen } from '../screens/market/WatchlistScreen';
import { AIResearchScreen } from '../screens/insights/AIResearchScreen';
import { AlertsScreen } from '../screens/insights/AlertsScreen';
import { ProfileScreen } from '../screens/account/ProfileScreen';
import { SettingsScreen } from '../screens/account/SettingsScreen';
import {
  configureNotificationPresentation,
  enrollPushNotifications,
  notificationsEnabled,
  subscribeToNotifications,
} from '../notifications/service';
import type { NotificationTarget } from '../notifications/service';
import type { AuthParams, RootParams, TabParams } from './types';
const Root = createNativeStackNavigator<RootParams>();
const Auth = createNativeStackNavigator<AuthParams>();
const Tabs = createBottomTabNavigator<TabParams>();
const ref = createNavigationContainerRef<RootParams>();
const theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.background,
    card: colors.surface,
    border: colors.border,
    primary: colors.accent,
    text: colors.text,
  },
};
function MainTabs() {
  return (
    <Tabs.Navigator
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarIcon: ({ color, size }) => (
          <Text style={{ color, fontSize: size }}>
            {
              { Dashboard: '⌂', Markets: '◉', Trade: '⇄', Portfolio: '◎', Profile: '☰' }[
                route.name
              ]
            }
          </Text>
        ),
      })}
    >
      <Tabs.Screen name="Dashboard" component={DashboardScreen} options={{ title: 'Overview' }} />
      <Tabs.Screen name="Markets" component={MarketsScreen} />
      <Tabs.Screen name="Trade" component={TradeScreen} />
      <Tabs.Screen name="Portfolio" component={PortfolioScreen} />
      <Tabs.Screen name="Profile" component={ProfileScreen} />
    </Tabs.Navigator>
  );
}
export function AppNavigator() {
  const { status, user } = useSession();
  const pending = useRef<NotificationTarget | null>(null);
  const openTarget = (target: NotificationTarget) => {
    if (!ref.isReady() || status !== 'ready') {
      pending.current = target;
      return;
    }
    if (target === 'Portfolio') ref.navigate('Main', { screen: 'Portfolio' });
    else ref.navigate(target);
  };
  useEffect(() => {
    if (status !== 'booting') void hideAsync().catch(() => {});
  }, [status]);
  useEffect(() => {
    configureNotificationPresentation();
  }, []);
  useEffect(() => {
    if (status !== 'ready') return;
    const unsubscribe = subscribeToNotifications(openTarget);
    void notificationsEnabled()
      .then((enabled) => (enabled ? enrollPushNotifications(false) : undefined))
      .catch(() => {});
    return unsubscribe;
    // The navigator and notification subscription follow the authenticated session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, user?.id]);
  if (status === 'booting') return <SplashScreen />;
  if (status === 'locked' || status === 'setupPin') return <BiometricUnlockScreen />;
  return (
    <NavigationContainer
      key={user?.id ?? 'signedOut'}
      ref={ref}
      theme={theme}
      onReady={() => {
        const target = pending.current;
        if (target && status === 'ready') {
          pending.current = null;
          openTarget(target);
        }
      }}
    >
      {status === 'signedOut' ? (
        <Auth.Navigator
          screenOptions={{
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.text,
            contentStyle: { backgroundColor: colors.background },
          }}
        >
          <Auth.Screen name="Login" component={LoginScreen} options={{ title: 'Asteriq AI' }} />
          <Auth.Screen
            name="Register"
            component={RegisterScreen}
            options={{ title: 'Create account' }}
          />
        </Auth.Navigator>
      ) : (
        <Root.Navigator
          screenOptions={{
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.text,
            contentStyle: { backgroundColor: colors.background },
          }}
        >
          <Root.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
          <Root.Screen
            name="StockDetail"
            component={StockDetailScreen}
            options={{ title: 'Stock detail' }}
          />
          <Root.Screen name="Watchlist" component={WatchlistScreen} />
          <Root.Screen
            name="AIResearch"
            component={AIResearchScreen}
            options={{ title: 'AI research' }}
          />
          <Root.Screen name="Alerts" component={AlertsScreen} />
          <Root.Screen name="Settings" component={SettingsScreen} />
        </Root.Navigator>
      )}
    </NavigationContainer>
  );
}
