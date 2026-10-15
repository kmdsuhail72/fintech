export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}
export type RequestOptions = {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  public?: boolean;
};
export interface TokenSource {
  token(force?: boolean): Promise<string>;
  invalidate(): Promise<void>;
}
export class ApiClient {
  constructor(
    readonly baseUrl: string,
    private readonly tokens?: TokenSource,
    private readonly transport: typeof fetch = fetch,
  ) {}
  async request<T>(path: string, options: RequestOptions = {}, retry = true): Promise<T> {
    const access = options.public ? undefined : await this.tokens?.token();
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort);
    if (options.signal?.aborted) abort();
    const timeout = setTimeout(abort, 15000);
    try {
      const response = await this.transport(this.baseUrl + path, {
        method: options.method ?? 'GET',
        headers: {
          'Content-Type': 'application/json',
          'x-client-type': 'mobile',
          ...(access ? { Authorization: 'Bearer ' + access } : {}),
        },
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
        signal: controller.signal,
      });
      if (response.status === 401 && !options.public && retry && this.tokens) {
        await this.tokens.token(true);
        return this.request<T>(path, options, false);
      }
      if (response.status === 401 && !options.public) await this.tokens?.invalidate();
      if (response.status === 204 && response.ok) return undefined as T;
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        data?: T;
        error?: { message?: string; code?: string };
      } | null;
      if (!response.ok || !payload?.ok || payload.data === undefined)
        throw new ApiError(
          payload?.error?.message ?? 'Unable to complete the request.',
          response.status,
          payload?.error?.code ?? 'REQUEST_FAILED',
        );
      return payload.data as T;
    } catch (error) {
      if (controller.signal.aborted)
        throw new ApiError(
          options.signal?.aborted ? 'Request cancelled.' : 'The request timed out. Please retry.',
          0,
          options.signal?.aborted ? 'CANCELLED' : 'TIMEOUT',
        );
      throw error;
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abort);
    }
  }
}
