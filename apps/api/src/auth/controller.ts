import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { env } from '../config.js';
import { AuthError } from './errors.js';
import { verifyAccessToken } from './service.js';
import type { AuthService, ClientType } from './service.js';
import {
  clientTypeSchema,
  emailSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  tokenSchema,
} from './validation.js';

const refreshBodySchema = z.object({ refreshToken: z.string().min(32).max(512) }).strict();
const uuidSchema = z.string().uuid();

export function createAuthController(auth: AuthService) {
  const run =
    (handler: (request: Request, response: Response) => Promise<void>) =>
    (request: Request, response: Response, next: NextFunction) => {
      void handler(request, response).catch(next);
    };

  const clientType = (request: Request): ClientType => {
    const parsed = clientTypeSchema.safeParse(request.header('x-client-type') ?? 'web');
    if (!parsed.success) throw new AuthError(400, 'INVALID_CLIENT_TYPE', 'Invalid client type');
    return parsed.data;
  };

  const setRefreshCookie = (response: Response, token: string) => {
    response.cookie('asteriq_refresh', token, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/v1/auth',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
  };

  const clearRefreshCookie = (response: Response) =>
    response.clearCookie('asteriq_refresh', {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/v1/auth',
    });

  const issueSession = async (
    request: Request,
    response: Response,
    credentials: { email: string; password: string },
  ) => {
    const type = clientType(request);
    const result = await auth.login(credentials, {
      clientType: type,
      ip: request.ip,
      userAgent: request.header('user-agent'),
      deviceLabel: request.header('x-device-label'),
    });
    if (type === 'web') setRefreshCookie(response, result.refreshToken);
    response.status(200).json({
      ok: true,
      data: {
        accessToken: result.accessToken,
        ...(type === 'mobile' ? { refreshToken: result.refreshToken } : {}),
        accessTokenExpiresIn: result.accessTokenExpiresIn,
        user: result.user,
      },
      requestId: response.getHeader('X-Request-Id'),
    });
  };

  return {
    register: run(async (request, response) => {
      const input = registerSchema.parse(request.body);
      clientType(request);
      const result = await auth.register(input);
      response.status(202).json({
        ok: true,
        data: result,
        requestId: response.getHeader('X-Request-Id'),
      });
    }),
    login: run(async (request, response) => {
      const input = loginSchema.parse(request.body);
      await issueSession(request, response, input);
    }),
    verifyEmail: run(async (request, response) => {
      const { token } = tokenSchema.parse(request.body);
      await auth.verifyEmail(token);
      response.status(200).json({
        ok: true,
        data: { message: 'Email verified. You can now sign in.' },
        requestId: response.getHeader('X-Request-Id'),
      });
    }),
    resendVerification: run(async (request, response) => {
      const { email } = emailSchema.parse(request.body);
      const result = await auth.resendVerification(email);
      response.status(202).json({
        ok: true,
        data: result,
        requestId: response.getHeader('X-Request-Id'),
      });
    }),
    forgotPassword: run(async (request, response) => {
      const { email } = emailSchema.parse(request.body);
      const result = await auth.forgotPassword(email);
      response.status(202).json({
        ok: true,
        data: result,
        requestId: response.getHeader('X-Request-Id'),
      });
    }),
    resetPassword: run(async (request, response) => {
      const { token, password } = resetPasswordSchema.parse(request.body);
      await auth.resetPassword(token, password);
      response.status(200).json({
        ok: true,
        data: { message: 'Password updated. Sign in again with your new password.' },
        requestId: response.getHeader('X-Request-Id'),
      });
    }),
    refresh: run(async (request, response) => {
      const type = clientType(request);
      const body = refreshBodySchema.safeParse(request.body);
      const refreshToken =
        type === 'web'
          ? request.cookies?.asteriq_refresh
          : body.success
            ? body.data.refreshToken
            : null;
      if (!refreshToken) {
        throw new AuthError(401, 'REFRESH_TOKEN_REQUIRED', 'Refresh token is required');
      }
      const result = await auth.refresh(refreshToken, {
        clientType: type,
        ip: request.ip,
        userAgent: request.header('user-agent'),
      });
      if (type === 'web') setRefreshCookie(response, result.refreshToken);
      response.status(200).json({
        ok: true,
        data: {
          accessToken: result.accessToken,
          ...(type === 'mobile' ? { refreshToken: result.refreshToken } : {}),
          accessTokenExpiresIn: result.accessTokenExpiresIn,
          user: result.user,
        },
        requestId: response.getHeader('X-Request-Id'),
      });
    }),
    logout: run(async (request, response) => {
      const type = clientType(request);
      const body = refreshBodySchema.safeParse(request.body);
      const refreshToken =
        type === 'web'
          ? request.cookies?.asteriq_refresh
          : body.success
            ? body.data.refreshToken
            : null;
      if (refreshToken) {
        await auth.logoutByRefreshToken(refreshToken);
      } else {
        const authorization = request.header('authorization');
        if (!authorization?.startsWith('Bearer ')) {
          throw new AuthError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required');
        }
        const identity = await verifyAccessToken(authorization.slice(7));
        await auth.assertSessionActive(identity.sessionId, identity.userId);
        await auth.logout(identity.sessionId);
      }
      clearRefreshCookie(response);
      response.status(200).json({
        ok: true,
        data: { message: 'Signed out.' },
        requestId: response.getHeader('X-Request-Id'),
      });
    }),
    logoutAll: run(async (request, response) => {
      const identity = request.auth;
      if (!identity)
        throw new AuthError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required');
      await auth.logoutAll(identity.userId);
      clearRefreshCookie(response);
      response.status(200).json({
        ok: true,
        data: { message: 'All sessions have been signed out.' },
        requestId: response.getHeader('X-Request-Id'),
      });
    }),
    listSessions: run(async (request, response) => {
      const identity = request.auth;
      if (!identity)
        throw new AuthError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required');
      const result = await auth.listSessions(identity.userId, identity.sessionId);
      response.status(200).json({
        ok: true,
        data: result,
        requestId: response.getHeader('X-Request-Id'),
      });
    }),
    revokeSession: run(async (request, response) => {
      const identity = request.auth;
      if (!identity)
        throw new AuthError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required');
      const sessionId = uuidSchema.parse(request.params.sessionId);
      await auth.revokeOwnedSession(identity.userId, sessionId);
      response.status(204).end();
    }),
  };
}
