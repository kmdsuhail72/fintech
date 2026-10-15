export type ApiError = {
  code: string;
  message: string;
  requestId?: string;
  details?: unknown;
};

export type ApiResponse<T> =
  { ok: true; data: T; requestId: string } | { ok: false; error: ApiError; requestId: string };

export type HealthStatus = {
  status: 'ok' | 'degraded';
  service: string;
  timestamp: string;
};

export type ReadinessStatus = HealthStatus & {
  dependencies: {
    postgres: 'ok' | 'error';
    redis: 'ok' | 'error';
  };
};

export const researchSectionTitles = {
  summary: 'Summary',
  market_context: 'Market Context',
  technical_analysis: 'Technical Analysis',
  news_sentiment: 'News Sentiment',
  potential_risks: 'Potential Risks',
  potential_opportunities: 'Potential Opportunities',
  educational_conclusion: 'Educational Conclusion',
} as const;

export type ResearchSectionKey = keyof typeof researchSectionTitles;
export type ResearchSection = { content: string; source_ids: string[] };
export type ResearchAssistantReport = Record<ResearchSectionKey, ResearchSection> & {
  ai_generated: true;
  label: 'AI-generated research';
  question: string;
  symbols: string[];
  generated_at: string;
  provider: string;
  model: string;
  prompt_version: string;
  sources: Array<{
    id: string;
    kind: string;
    title: string;
    available: boolean;
    as_of: string | null;
    url: string | null;
    data: Record<string, unknown>;
  }>;
  data_quality: string[];
  disclaimer: string;
};
