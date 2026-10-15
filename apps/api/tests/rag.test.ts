import assert from 'node:assert/strict';
import test from 'node:test';
import { ingestionSchema, retrievalSchema, forwardRag } from '../src/routes/rag.routes.js';
import { researchAssistantSchema } from '../src/validators/api.validators.js';

const metadata = {
  title: 'Earnings',
  publisher: 'Example issuer',
  document_type: 'earnings_report',
};
test('RAG rejects supplied ownership, unsafe URLs and unbounded retrieval', () => {
  assert.equal(
    ingestionSchema.safeParse({ metadata, content: 'Revenue', owner_id: 'foreign' }).success,
    false,
  );
  assert.equal(
    ingestionSchema.safeParse({
      metadata: { ...metadata, source_url: 'javascript:alert(1)' },
      content: 'Revenue',
    }).success,
    false,
  );
  assert.equal(
    ingestionSchema.safeParse({
      metadata: { ...metadata, source_url: 'https://user:password@example.com' },
      content: 'Revenue',
    }).success,
    false,
  );
  assert.equal(retrievalSchema.safeParse({ question: 'Risk?', top_k: 13 }).success, false);
  assert.equal(
    retrievalSchema.safeParse({ question: 'Risk?', document_ids: ['invalid'] }).success,
    false,
  );
  assert.equal(
    researchAssistantSchema.parse({ question: 'NVDA?', include_documents: true }).include_documents,
    true,
  );
});

test('RAG gateway preserves source metadata and forwards the session', async () => {
  const expected = {
    sources: [
      {
        id: 'document:1:chunk:2',
        data: {
          publisher: 'Issuer',
          page_number: 3,
          source_url: 'https://example.com/report',
          excerpt: 'Revenue grew',
        },
      },
    ],
  };
  const transport: typeof fetch = async (input, options) => {
    assert.ok(String(input).endsWith('/research/retrieve'));
    assert.equal((options?.headers as Record<string, string>).Authorization, 'Bearer user-session');
    assert.equal(options?.redirect, 'error');
    return new Response(JSON.stringify({ ok: true, data: expected }), { status: 200 });
  };
  assert.deepEqual(
    await forwardRag(
      '/retrieve',
      'POST',
      'Bearer user-session',
      { question: 'Revenue?' },
      transport,
    ),
    expected,
  );
});

test('RAG gateway sanitizes transport failures and preserves ownership errors', async () => {
  const broken: typeof fetch = async () => {
    throw new Error('secret provider body');
  };
  await assert.rejects(
    forwardRag('/retrieve', 'POST', 'Bearer session', {}, broken),
    (error: Error) => !error.message.includes('secret') && error.message.includes('unavailable'),
  );
  const denied: typeof fetch = async () =>
    new Response(JSON.stringify({ ok: false, error: { message: 'Document unavailable.' } }), {
      status: 404,
    });
  await assert.rejects(
    forwardRag('/documents/foreign', 'DELETE', 'Bearer session', undefined, denied),
    (error: Error & { status?: number }) => error.status === 404,
  );
});
