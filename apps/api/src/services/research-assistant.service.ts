import { z } from 'zod';
import type { ResearchAssistantReport } from '@asteriq/types';
import { ApiError } from '../utils/errors.js';
import { readBoundedResponse } from '../utils/bounded-response.js';
import { observeAiCall, traceHeaders } from '../utils/observability.js';

export type ResearchAssistantInput = {
  question: string;
  symbols: string[];
  interval: '1m' | '5m' | '15m' | '1h' | '1d';
  include_portfolio?: boolean | null;
  include_documents?: boolean;
  document_ids?: string[];
};
const section = z.object({ content: z.string(), source_ids: z.array(z.string()) });
const report = z.object({
  ai_generated: z.literal(true),
  label: z.literal('AI-generated research'),
  question: z.string(),
  symbols: z.array(z.string()),
  generated_at: z.string(),
  provider: z.string(),
  model: z.string(),
  prompt_version: z.string(),
  summary: section,
  market_context: section,
  technical_analysis: section,
  news_sentiment: section,
  potential_risks: section,
  potential_opportunities: section,
  educational_conclusion: section,
  sources: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      title: z.string(),
      available: z.boolean(),
      as_of: z.string().nullable(),
      url: z.string().nullable(),
      data: z.record(z.unknown()),
    }),
  ),
  data_quality: z.array(z.string()),
  disclaimer: z.string(),
});

export class ResearchAssistantService {
  constructor(
    private readonly serviceUrl: string,
    private readonly transport: typeof fetch = fetch,
  ) {}

  async generate(
    input: ResearchAssistantInput,
    authorization: string,
  ): Promise<ResearchAssistantReport> {
    return observeAiCall(() => this.generateResult(input, authorization));
  }

  private async generateResult(
    input: ResearchAssistantInput,
    authorization: string,
  ): Promise<ResearchAssistantReport> {
    let result: Response;
    try {
      result = await this.transport(this.serviceUrl.replace(/\/$/, '') + '/research/assistant', {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(100_000),
        headers: {
          'Content-Type': 'application/json',
          Authorization: authorization,
          ...traceHeaders(),
        },
        body: JSON.stringify(input),
      });
    } catch {
      throw new ApiError(
        503,
        'RESEARCH_UNAVAILABLE',
        'AI research is unavailable. Please retry later.',
      );
    }
    const text = await readBoundedResponse(result, 1_000_000);
    if (text.length > 1_000_000)
      throw new ApiError(
        502,
        'INVALID_RESEARCH_RESPONSE',
        'The AI service returned an invalid response.',
      );
    let payload: { ok?: boolean; data?: unknown; error?: { message?: unknown } };
    try {
      payload = JSON.parse(text) as typeof payload;
    } catch {
      throw new ApiError(
        502,
        'INVALID_RESEARCH_RESPONSE',
        'The AI service returned an invalid response.',
      );
    }
    if (!result.ok || payload.ok !== true) {
      const status = [401, 403, 422, 502, 503].includes(result.status) ? result.status : 503;
      const message =
        typeof payload.error?.message === 'string'
          ? payload.error.message.slice(0, 300)
          : 'AI research is unavailable. Please retry later.';
      throw new ApiError(status, 'RESEARCH_UNAVAILABLE', message);
    }
    const parsed = report.safeParse(payload.data);
    if (!parsed.success)
      throw new ApiError(
        502,
        'INVALID_RESEARCH_RESPONSE',
        'The AI service returned an invalid response.',
      );
    return parsed.data;
  }
}
