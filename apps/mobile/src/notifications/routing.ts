export type NotificationTarget = 'Alerts' | 'Portfolio' | 'Watchlist' | 'AIResearch';
export function parseNotificationTarget(data: unknown): NotificationTarget | null {
  if (!data || typeof data !== 'object') return null;
  const screen = (data as { screen?: unknown }).screen;
  return typeof screen === 'string' &&
    ['Alerts', 'Portfolio', 'Watchlist', 'AIResearch'].includes(screen)
    ? (screen as NotificationTarget)
    : null;
}
