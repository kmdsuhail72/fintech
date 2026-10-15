import type { NavigatorScreenParams } from '@react-navigation/native';
import type { Instrument } from '../services/types';
export type TabParams = {
  Dashboard: undefined;
  Markets: undefined;
  Trade: { instrument?: Instrument } | undefined;
  Portfolio: undefined;
  Profile: undefined;
};
export type RootParams = {
  Main: NavigatorScreenParams<TabParams> | undefined;
  StockDetail: { instrument: Instrument };
  Watchlist: undefined;
  AIResearch: undefined;
  Alerts: undefined;
  Settings: undefined;
};
export type AuthParams = { Login: undefined; Register: undefined };
