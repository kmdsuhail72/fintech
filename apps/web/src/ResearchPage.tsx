import { useRef, useState, useEffect } from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';
import { researchSectionTitles } from '@asteriq/types';
import type { ResearchAssistantReport, ResearchSectionKey } from '@asteriq/types';
import { PageTitle } from './MarketUI.js';
import { requestApi } from './api.js';
import { ResearchDocuments } from './ResearchDocuments.js';

const examples = [
  'Explain NVDA performance.',
  'Why has NVDA moved?',
  'Summarize my portfolio risk.',
  'Compare AAPL and MSFT.',
  'Explain RSI for Tesla.',
];

export function ResearchPage() {
  const [question, setQuestion] = useState('');
  const [symbols, setSymbols] = useState('');
  const [interval, setInterval] = useState('1d');
  const [portfolio, setPortfolio] = useState(false);
  const [documentMode, setDocumentMode] = useState('off');
  const [documentIds, setDocumentIds] = useState<string[]>([]);
  const [report, setReport] = useState<ResearchAssistantReport | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);

  async function submit() {
    if (pending.current || question.trim().length < 3) return;
    const selected = symbols
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((s) => s.toUpperCase());
    if (
      documentMode !== 'only' &&
      (selected.length > 4 ||
        new Set(selected).size !== selected.length ||
        selected.some((s) => !/^[A-Z0-9.^_-]{1,24}$/.test(s)))
    ) {
      setError('Enter up to four unique ticker symbols.');
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError('');
    setReport(null);
    const timeout = setTimeout(() => controller.abort(), 110_000);
    try {
      const result = await requestApi<ResearchAssistantReport>(
        documentMode === 'only' ? '/ai/research/questions' : '/ai/research/assistant',
        {
          method: 'POST',
          signal: controller.signal,
          body:
            documentMode === 'only'
              ? { question: question.trim(), document_ids: documentIds }
              : {
                  question: question.trim(),
                  symbols: selected,
                  interval,
                  include_portfolio: portfolio ? true : null,
                  include_documents: documentMode === 'combined',
                  document_ids: documentMode === 'combined' ? documentIds : [],
                },
        },
      );
      if (!controller.signal.aborted) setReport(result);
    } catch (cause) {
      setError(
        controller.signal.aborted
          ? 'Research was cancelled or timed out. You can retry.'
          : cause instanceof Error
            ? cause.message
            : 'Research is unavailable. Retry later.',
      );
    } finally {
      clearTimeout(timeout);
      pending.current = null;
      setBusy(false);
    }
  }

  return (
    <div className="workspace-page research-workspace">
      <PageTitle
        eyebrow="ASTERIQ INTELLIGENCE"
        title="AI research"
        subtitle="Company, market, technical, news, and portfolio context with cited evidence."
      />
      <section className="research-hero">
        <div className="research-hero-copy">
          <span className="eyebrow">AI-GENERATED RESEARCH</span>
          <h2>Understand the evidence behind the market.</h2>
          <p>
            Educational research only. AI can be inaccurate. No profits or investment returns are
            guaranteed.
          </p>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="research-input">
            <Sparkles size={17} />
            <input
              aria-label="Research question"
              maxLength={2000}
              value={question}
              disabled={busy}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Explain NVDA performance..."
            />
            <button type="submit" disabled={busy || question.trim().length < 3} aria-label="Ask AI">
              <ArrowRight size={17} />
            </button>
          </div>
          <div className="research-controls">
            <label>
              Document research
              <select
                value={documentMode}
                disabled={busy}
                onChange={(event) => setDocumentMode(event.target.value)}
              >
                <option value="off">Market research</option>
                <option value="combined">Market + documents</option>
                <option value="only">Documents only</option>
              </select>
            </label>
            <label>
              Tickers (optional)
              <input
                value={symbols}
                disabled={busy}
                onChange={(event) => setSymbols(event.target.value)}
                placeholder="AAPL, MSFT"
              />
            </label>
            <label>
              Historical interval
              <select
                value={interval}
                disabled={busy}
                onChange={(event) => setInterval(event.target.value)}
              >
                <option value="1d">Daily</option>
                <option value="1h">Hourly</option>
                <option value="15m">15 minutes</option>
                <option value="5m">5 minutes</option>
                <option value="1m">1 minute</option>
              </select>
            </label>
            <label className="research-portfolio-toggle">
              <input
                type="checkbox"
                checked={portfolio}
                disabled={busy}
                onChange={(event) => setPortfolio(event.target.checked)}
              />{' '}
              Include my paper portfolio
            </label>
          </div>
          <p className="research-disclaimer">
            Questions about your portfolio include your authenticated paper holdings. Selected
            research evidence is sent to OpenAI.
          </p>
        </form>
        {busy && (
          <div role="status" className="research-notice">
            Gathering evidence and generating research…{' '}
            <button onClick={() => pending.current?.abort()}>Cancel</button>
          </div>
        )}
        {error && (
          <div role="alert" className="research-notice">
            {error}
          </div>
        )}
      </section>
      <ResearchDocuments disabled={busy} selected={documentIds} onSelected={setDocumentIds} />
      <div className="research-content-grid">
        <section className="panel content-panel" aria-live="polite">
          {report ? (
            <>
              <span className="ai-status-chip">{report.label}</span>
              <h2>{report.question}</h2>
              <p>
                {report.provider} · {new Date(report.generated_at).toLocaleString()}
              </p>
              {(Object.keys(researchSectionTitles) as ResearchSectionKey[]).map((key) => (
                <article className="research-section" key={key}>
                  <h3>{researchSectionTitles[key]}</h3>
                  <p>{report[key].content}</p>
                  <div className="research-citations">
                    {report[key].source_ids.map((id) => (
                      <a key={id} href={`#source-${encodeURIComponent(id)}`}>
                        {report.sources.find((source) => source.id === id)?.title ?? id}
                      </a>
                    ))}
                  </div>
                </article>
              ))}
              <h3>Data limitations</h3>
              <ul>
                {report.data_quality.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
              <h3>Sources</h3>
              <ul>
                {report.sources.map((source) => (
                  <li id={`source-${encodeURIComponent(source.id)}`} key={source.id}>
                    {source.title} — {source.available ? 'Available' : 'Unavailable'}
                    {source.as_of ? ` · ${source.as_of}` : ''}
                    {source.kind === 'document' && (
                      <details>
                        <summary>View cited excerpt and metadata</summary>
                        <p>
                          {String(source.data.publisher ?? '')} · Document:{' '}
                          {String(source.data.document_id ?? '')} · Chunk:{' '}
                          {String(source.data.chunk_id ?? '')}
                        </p>
                        <blockquote>{String(source.data.excerpt ?? '')}</blockquote>
                      </details>
                    )}
                    {source.url && /^https?:\/\//i.test(source.url) && (
                      <>
                        {' '}
                        ·{' '}
                        <a href={source.url} target="_blank" rel="noreferrer">
                          Open source
                        </a>
                      </>
                    )}
                  </li>
                ))}
              </ul>
              <p className="research-disclaimer">{report.disclaimer}</p>
            </>
          ) : (
            <>
              <h2>Your research starts with a question</h2>
              <p>
                Ask about a supported company, compare up to four tickers, or explore your portfolio
                risk. Reports separate facts from interpretation and disclose unavailable data.
              </p>
            </>
          )}
        </section>
        <aside className="panel research-quick">
          <h3>Try asking</h3>
          {examples.map((example) => (
            <button
              className="prompt-chip"
              disabled={busy}
              key={example}
              onClick={() => setQuestion(example)}
            >
              {example}
              <ArrowRight size={14} />
            </button>
          ))}
        </aside>
      </div>
    </div>
  );
}
