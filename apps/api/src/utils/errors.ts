import { AuthError } from '../auth/errors.js';

export class ApiError extends AuthError {
  constructor(status: number, code: string, message: string) {
    super(status, code, message);
    this.name = 'ApiError';
  }
}

export const notFound = (resource: string) =>
  new ApiError(404, 'NOT_FOUND', `${resource} was not found`);

export const forbidden = () =>
  new ApiError(403, 'FORBIDDEN', 'You are not allowed to access this resource');

export const conflict = (message: string) => new ApiError(409, 'CONFLICT', message);
