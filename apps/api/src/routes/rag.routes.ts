import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { env } from '../config.js';
import { validateRequest, getValidated } from '../middleware/validation.js';
import { ApiError } from '../utils/errors.js';
import { observeAiCall, traceHeaders } from '../utils/observability.js';

const metadata = z
  .object({
    title: z.string().trim().min(1).max(300),
    document_type: z.enum([
      'company_report',
      'financial_document',
      'earnings_report',
      'market_research',
      'investment_education',
    ]),
    publisher: z.string().trim().min(1).max(200),
    published_date: z.string().date().nullable().optional(),
    source_url: z
      .string()
      .url()
      .max(2000)
      .refine((value) => {
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
      })
      .nullable()
      .optional(),
    symbols: z
      .array(
        z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^[A-Z0-9.^_-]{1,24}$/),
      )
      .max(20)
      .default([]),
  })
  .strict();
export const ingestionSchema = z
  .object({
    metadata,
    format: z.enum(['text', 'markdown', 'pdf']).default('text'),
    content: z.string().min(1).max(8_000_000),
  })
  .strict();
export const retrievalSchema = z
  .object({
    question: z.string().trim().min(3).max(2000),
    document_ids: z.array(z.string().uuid()).max(20).default([]),
    top_k: z.number().int().min(1).max(12).default(6),
  })
  .strict();
const documentPath = z.object({ documentId: z.string().uuid() }).strict();
const pagination = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(100000).default(0),
  })
  .strict();

export async function forwardRag(
  path: string,
  method: string,
  authorization: string,
  body?: unknown,
  transport: typeof fetch = fetch,
): Promise<unknown> {
  return observeAiCall(async () => {
    try {
      const result = await transport(env.AI_SERVICE_URL.replace(/\/$/, '') + '/research' + path, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(180_000),
        headers: {
          Authorization: authorization,
          'Content-Type': 'application/json',
          ...traceHeaders(),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await readBoundedResponse(result, 2_000_000);
      if (text.length > 2_000_000) throw new Error('Oversized response');
      const payload = JSON.parse(text) as {
        ok?: boolean;
        data?: unknown;
        error?: { message?: unknown };
      };
      if (!result.ok || payload.ok !== true) {
        const status = [401, 403, 404, 413, 422, 429, 502, 503].includes(result.status)
          ? result.status
          : 503;
        throw new ApiError(
          status,
          'DOCUMENT_RESEARCH_UNAVAILABLE',
          typeof payload.error?.message === 'string'
            ? payload.error.message.slice(0, 300)
            : 'Document research is unavailable.',
        );
      }
      if (payload.data === undefined) throw new Error('Missing response data');
      return payload.data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        503,
        'DOCUMENT_RESEARCH_UNAVAILABLE',
        'Document research is unavailable. Retry later.',
      );
    }
  });
}

// Mounted behind the existing authenticated router, never public.
export function createRagRouter() {
  const router = Router();
  const handle =
    (path: (request: Request) => string) =>
    (request: Request, response: Response, next: NextFunction) => {
      void forwardRag(
        path(request),
        request.method,
        request.header('authorization')!,
        request.method === 'POST' ? getValidated<unknown>(request, 'body') : undefined,
      )
        .then((data) =>
          response.json({ ok: true, data, requestId: response.getHeader('X-Request-Id') }),
        )
        .catch(next);
    };
  router.post(
    '/documents',
    validateRequest({ body: ingestionSchema }),
    handle(() => '/documents'),
  );
  router.get(
    '/documents',
    validateRequest({ query: pagination }),
    handle((request) => {
      const page = getValidated<z.infer<typeof pagination>>(request, 'query');
      return `/documents?limit=${page.limit}&offset=${page.offset}`;
    }),
  );
  router.delete(
    '/documents/:documentId',
    validateRequest({ params: documentPath }),
    handle(
      (request) =>
        `/documents/${getValidated<z.infer<typeof documentPath>>(request, 'params').documentId}`,
    ),
  );
  router.post(
    '/retrieve',
    validateRequest({ body: retrievalSchema }),
    handle(() => '/retrieve'),
  );
  router.post(
    '/questions',
    validateRequest({ body: retrievalSchema }),
    handle(() => '/questions'),
  );
  return router;
}
import { readBoundedResponse } from '../utils/bounded-response.js';
