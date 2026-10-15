import { useState } from 'react';
import { requestApi } from './api.js';

type DocumentRecord = {
  id: string;
  metadata: {
    title: string;
    publisher: string;
    document_type: string;
    published_date: string | null;
  };
  chunk_count: number;
};
const documentTypes = [
  'company_report',
  'financial_document',
  'earnings_report',
  'market_research',
  'investment_education',
] as const;

export function ResearchDocuments({
  disabled,
  selected,
  onSelected,
}: {
  disabled: boolean;
  selected: string[];
  onSelected: (ids: string[]) => void;
}) {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [title, setTitle] = useState('');
  const [publisher, setPublisher] = useState('');
  const [type, setType] = useState<string>('company_report');
  const [date, setDate] = useState('');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const locked = disabled || busy;
  async function load() {
    const result = await requestApi<{ documents: DocumentRecord[] }>(
      '/ai/research/documents?limit=100',
    );
    setDocuments(result.documents);
    onSelected(selected.filter((id) => result.documents.some((document) => document.id === id)));
  }
  async function perform(action: () => Promise<void>) {
    if (locked) return;
    setBusy(true);
    setMessage('');
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Document action failed.');
    } finally {
      setBusy(false);
    }
  }
  async function ingest() {
    if (!file) return;
    if (file.size > 6_000_000) throw new Error('Choose a file smaller than 6 MB.');
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (!['pdf', 'txt', 'md'].includes(extension ?? ''))
      throw new Error('Choose a PDF, TXT, or Markdown document.');
    const format = extension === 'pdf' ? 'pdf' : extension === 'md' ? 'markdown' : 'text';
    let content: string;
    if (format === 'pdf') {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const parts: string[] = [];
      for (let start = 0; start < bytes.length; start += 8192)
        parts.push(String.fromCharCode(...bytes.subarray(start, start + 8192)));
      content = btoa(parts.join(''));
    } else content = await file.text();
    const result = await requestApi<{ document: DocumentRecord; deduplicated: boolean }>(
      '/ai/research/documents',
      {
        method: 'POST',
        body: {
          format,
          content,
          metadata: {
            title,
            publisher,
            document_type: type,
            published_date: date || null,
            source_url: url || null,
            symbols: [],
          },
        },
        signal: AbortSignal.timeout(180_000),
      },
    );
    await load();
    onSelected([...new Set([...selected, result.document.id])].slice(0, 20));
    setMessage(
      result.deduplicated
        ? 'This document is already indexed.'
        : `Indexed ${result.document.chunk_count} chunks. Document selected for research.`,
    );
  }
  return (
    <section className="panel content-panel research-documents">
      <h2>Research documents</h2>
      <p>
        Upload reports, earnings releases, market research, or educational material. Text is sent to
        OpenAI for embeddings. Documents are private to your signed-in account.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void perform(ingest);
        }}
      >
        <div className="research-controls">
          <label>
            Title
            <input
              required
              maxLength={300}
              value={title}
              disabled={locked}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label>
            Publisher
            <input
              required
              maxLength={200}
              value={publisher}
              disabled={locked}
              onChange={(event) => setPublisher(event.target.value)}
            />
          </label>
          <label>
            Document type
            <select
              value={type}
              disabled={locked}
              onChange={(event) => setType(event.target.value)}
            >
              {documentTypes.map((kind) => (
                <option key={kind} value={kind}>
                  {kind.replaceAll('_', ' ')}
                </option>
              ))}
            </select>
          </label>
          <label>
            Publication date
            <input
              type="date"
              value={date}
              disabled={locked}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
          <label>
            Source URL
            <input
              type="url"
              maxLength={2000}
              value={url}
              disabled={locked}
              onChange={(event) => setUrl(event.target.value)}
            />
          </label>
          <label>
            PDF, TXT, or Markdown
            <input
              type="file"
              required
              accept=".pdf,.txt,.md"
              disabled={locked}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>
        </div>
        <button
          className="prompt-chip"
          type="submit"
          disabled={locked || !file || !title.trim() || !publisher.trim()}
        >
          {busy ? 'Working…' : 'Ingest document'}
        </button>
      </form>
      <p>
        PDFs must contain selectable text. Scans require OCR before upload. Publication details are
        supplied by you and are preserved in citations.
      </p>
      <button className="prompt-chip" disabled={locked} onClick={() => void perform(load)}>
        Load my documents
      </button>
      <div role="status">{message}</div>
      <ul>
        {documents.map((document) => (
          <li key={document.id}>
            <label>
              <input
                type="checkbox"
                checked={selected.includes(document.id)}
                disabled={locked || (!selected.includes(document.id) && selected.length >= 20)}
                onChange={(event) =>
                  onSelected(
                    event.target.checked
                      ? [...selected, document.id]
                      : selected.filter((id) => id !== document.id),
                  )
                }
              />{' '}
              {document.metadata.title} · {document.metadata.publisher} · {document.chunk_count}{' '}
              chunks
            </label>{' '}
            <button
              disabled={locked}
              onClick={() =>
                void perform(async () => {
                  await requestApi(`/ai/research/documents/${document.id}`, { method: 'DELETE' });
                  await load();
                })
              }
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
      <p>
        Select up to 20 documents. If none are selected, document research searches all your indexed
        documents.
      </p>
    </section>
  );
}
