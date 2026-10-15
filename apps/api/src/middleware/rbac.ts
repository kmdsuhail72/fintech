import type { NextFunction, Request, Response } from 'express';
import type { Pool } from 'pg';
import { forbidden } from '../utils/errors.js';

declare module 'express-serve-static-core' {
  interface Request {
    roles?: string[];
  }
}

export function requireRole(pool: Pool, ...allowedRoles: string[]) {
  return async (request: Request, _response: Response, next: NextFunction) => {
    try {
      if (!request.auth) {
        next(forbidden());
        return;
      }
      const result = await pool.query<{ name: string }>(
        `SELECT r.name
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
         WHERE ur.user_id = $1`,
        [request.auth.userId],
      );
      const roles = result.rows.map((row) => row.name);
      request.roles = roles;
      if (!allowedRoles.some((role) => roles.includes(role))) {
        next(forbidden());
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
