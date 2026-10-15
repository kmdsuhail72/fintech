import { ApiClient, ApiError } from '../services/client';
import type { AuthResult, User } from '../services/types';
export type SessionStatus = 'booting' | 'signedOut' | 'setupPin' | 'locked' | 'ready';
export type SessionSnapshot = { status: SessionStatus; user: User | null; error: string | null };
export type SessionStorage = {
  read(): Promise<string | null>;
  write(token: string): Promise<void>;
  clear(): Promise<void>;
  hasPin(): Promise<boolean>;
};
export class SessionController {
  private snapshot: SessionSnapshot = { status: 'booting', user: null, error: null };
  private listeners = new Set<() => void>();
  private access = '';
  private expiresAt = 0;
  private generation = 0;
  private identityVersion = 0;
  private storeQueue = Promise.resolve();
  private refreshing: Promise<string> | null = null;
  private readonly auth: ApiClient;
  constructor(
    baseUrl: string,
    private readonly storage: SessionStorage,
    transport: typeof fetch = fetch,
  ) {
    this.auth = new ApiClient(baseUrl, undefined, transport);
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(status: SessionStatus, user = this.snapshot.user, error: string | null = null) {
    this.snapshot = { status, user, error };
    this.listeners.forEach((listener) => listener());
  }
  private store(operation: () => Promise<void>) {
    const next = this.storeQueue.then(operation, operation);
    this.storeQueue = next.catch(() => {});
    return next;
  }
  async boot() {
    try {
      const stored = await this.storage.read();
      if (stored && (await this.storage.hasPin())) this.publish('locked');
      else {
        if (stored) await this.store(() => this.storage.clear());
        this.publish('signedOut');
      }
    } catch {
      this.publish('signedOut', null, 'Could not open secure device storage.');
    }
  }
  async login(email: string, password: string) {
    const identityVersion = ++this.identityVersion;
    const result = await this.auth.request<AuthResult>('/auth/login', {
      method: 'POST',
      public: true,
      body: { email: email.trim().toLowerCase(), password },
    });
    await this.store(async () => {
      if (identityVersion !== this.identityVersion) throw new Error('Sign in was interrupted.');
      await this.storage.clear();
      await this.storage.write(result.refreshToken);
    });
    this.generation++;
    this.access = result.accessToken;
    this.expiresAt = Date.now() + result.accessTokenExpiresIn * 1000;
    this.publish('setupPin', result.user);
  }
  async register(email: string, password: string, displayName: string) {
    return this.auth.request<{ message: string }>('/auth/register', {
      method: 'POST',
      public: true,
      body: { email: email.trim().toLowerCase(), password, displayName: displayName.trim() },
    });
  }
  completePinSetup() {
    if (this.snapshot.status !== 'setupPin')
      throw new Error('Sign in before setting up device unlock.');
    this.publish('ready');
  }
  lock() {
    if (this.snapshot.status === 'ready') {
      this.generation++;
      this.access = '';
      this.expiresAt = 0;
      this.publish('locked');
    }
  }
  async unlock(verified: boolean) {
    if (!verified || this.snapshot.status !== 'locked')
      throw new ApiError('Device unlock is required.', 401, 'APP_LOCKED');
    const generation = this.generation;
    const token = await this.refresh(generation);
    if (!token || generation !== this.generation)
      throw new Error('Unlock was interrupted. Please try again.');
    this.publish('ready');
  }
  async token(force = false) {
    if (this.snapshot.status !== 'ready')
      throw new ApiError('Unlock the app to continue.', 401, 'APP_LOCKED');
    if (!force && this.access && Date.now() < this.expiresAt - 30000) return this.access;
    return this.refresh(this.generation);
  }
  private async refresh(generation: number) {
    if (this.refreshing) {
      try {
        return await this.refreshing;
      } catch (error) {
        if (!(
          error instanceof ApiError &&
          error.code === 'APP_LOCKED' &&
          generation === this.generation
        ))
          throw error;
      }
    }
    const identityVersion = this.identityVersion;
    this.refreshing = (async () => {
      const refreshToken = await this.storage.read();
      if (!refreshToken) {
        await this.invalidate();
        throw new ApiError('Sign in again to continue.', 401, 'SESSION_EXPIRED');
      }
      try {
        const result = await this.auth.request<AuthResult>('/auth/refresh', {
          method: 'POST',
          public: true,
          body: { refreshToken },
        });
        await this.store(async () => {
          if (identityVersion !== this.identityVersion)
            throw new ApiError('Session changed.', 401, 'APP_LOCKED');
          await this.storage.write(result.refreshToken);
        });
        if (generation !== this.generation)
          throw new ApiError('The app was locked.', 401, 'APP_LOCKED');
        this.access = result.accessToken;
        this.expiresAt = Date.now() + result.accessTokenExpiresIn * 1000;
        this.publish(this.snapshot.status, result.user);
        return this.access;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401 && error.code !== 'APP_LOCKED')
          await this.invalidate();
        throw error;
      }
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }
  async logout() {
    const refreshToken = await this.storage.read();
    try {
      if (refreshToken)
        await this.auth.request('/auth/logout', {
          method: 'POST',
          public: true,
          body: { refreshToken },
        });
    } finally {
      await this.invalidate();
    }
  }
  async invalidate() {
    this.generation++;
    this.identityVersion++;
    this.access = '';
    this.expiresAt = 0;
    this.publish('signedOut', null);
    await this.store(() => this.storage.clear());
  }
}
