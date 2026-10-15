import { StatusBar } from 'expo-status-bar';
import { preventAutoHideAsync } from 'expo-splash-screen';
import { AppProviders } from './src/providers/AppProviders';
import { AppNavigator } from './src/navigation/AppNavigator';
void preventAutoHideAsync().catch(() => {});
export default function App() {
  return (
    <AppProviders>
      <StatusBar style="light" />
      <AppNavigator />
    </AppProviders>
  );
}
