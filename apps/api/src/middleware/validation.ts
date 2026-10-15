import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodType } from 'zod';

declare module 'express-serve-static-core' {
  interface Request {
    validated?: {
      body?: unknown;
      params?: unknown;
      query?: unknown;
    };
  }
}

type RequestSchemas = {
  body?: ZodType;
  params?: ZodType;
  query?: ZodType;
};

export function validateRequest(schemas: RequestSchemas): RequestHandler {
  return (request: Request, _response: Response, next: NextFunction) => {
    try {
      request.validated = {
        ...(schemas.body ? { body: schemas.body.parse(request.body) } : {}),
        ...(schemas.params ? { params: schemas.params.parse(request.params) } : {}),
        ...(schemas.query ? { query: schemas.query.parse(request.query) } : {}),
      };
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function getValidated<T>(request: Request, key: keyof NonNullable<Request['validated']>): T {
  if (!request.validated || !(key in request.validated)) {
    throw new Error(`Validated request field '${key}' is missing`);
  }
  return request.validated[key] as T;
}
