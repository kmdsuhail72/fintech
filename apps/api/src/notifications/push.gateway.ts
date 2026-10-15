export type PushTicket =
  { status: 'ok'; id: string } | { status: 'error'; message: string; details?: { error?: string } };
export type PushReceipt =
  { status: 'ok' } | { status: 'error'; message: string; details?: { error?: string } };
export type PushTarget = 'Alerts' | 'Portfolio' | 'Watchlist' | 'AIResearch';
/** Server-side gateway. A durable outbox worker must call this, then check receipts.
 * Accepted tickets are not proof of delivery. Never put portfolio values or tokens in logs. */
export class ExpoPushGateway {
  constructor(
    private readonly accessToken?: string,
    private readonly transport: typeof fetch = fetch,
  ) {}
  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await this.transport('https://exp.host/--/api/v2/push/' + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.accessToken ? { Authorization: 'Bearer ' + this.accessToken } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('Push gateway returned HTTP ' + response.status);
    const result = (await response.json()) as { data?: T; errors?: unknown[] };
    if (!result.data || result.errors?.length) throw new Error('Push gateway rejected the request');
    return result.data;
  }
  send(messages: { token: string; notificationId: string; screen: PushTarget }[]) {
    if (messages.length < 1 || messages.length > 100)
      throw new Error('Push batches require 1 to 100 messages');
    return this.post<PushTicket[]>(
      'send',
      messages.map((message) => ({
        to: message.token,
        title: 'Asteriq AI',
        body: 'You have a new update in your Asteriq account.',
        channelId: 'market-alerts',
        sound: 'default',
        data: { screen: message.screen, notificationId: message.notificationId },
      })),
    );
  }
  receipts(ids: string[]) {
    if (!ids.length || ids.length > 1000)
      throw new Error('Receipt batches require 1 to 1000 tickets');
    return this.post<Record<string, PushReceipt>>('getReceipts', { ids });
  }
}
export function pushRetryDelay(attempt: number) {
  return Math.min(3600000, 30000 * 2 ** Math.min(Math.max(attempt, 0), 7));
}
