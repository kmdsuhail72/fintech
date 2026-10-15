import type { NextFunction, Request, Response } from 'express';
import type { AuthService } from './service.js';
import { verifyAccessToken } from './service.js';
import { AuthError } from './errors.js';

declare module 'express-serve-static-core' {
  interface Request {
    auth?: { userId: string; sessionId: string };
  }
}

export function requireAuthentication(authService: AuthService) {
  return async (request: Request, _response: Response, next: NextFunction) => {
    try {
      const authorization = request.header('authorization');
      if (!authorization?.startsWith('Bearer ')) {
        throw new AuthError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required');
      }
      const identity = await verifyAccessToken(authorization.slice(7));
      await authService.assertSessionActive(identity.sessionId, identity.userId);
      request.auth = identity;
      next();
    } catch (error) {
      next(error);
    }
  };
}
