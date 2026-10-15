# Financial news sentiment

Single-article and batch financial-news classification using the English [ProsusAI/FinBERT model](https://huggingface.co/ProsusAI/finbert), pinned to commit 4556d13015211d73dccd3fdd39d39232506f3e43. Outputs are positive, negative, or neutral. The existing /analysis/sentiment lexicon API remains available separately; this service never relabels a lexicon polarity score as model confidence.

## Setup

From apps/ai-service in PowerShell:

```powershell
..\..\.venv\Scripts\python.exe -m pip install -r requirements.txt -r requirements-news.txt
..\..\.venv\Scripts\python.exe scripts/warm_news_model.py --download
..\..\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

The additional NLP runtime is isolated in requirements-news.txt (Transformers and PyTorch). Other analysis endpoints and the standard test suite do not require it. The first warm-up downloads the pinned tokenizer/config/weights into artifacts/huggingface. Articles are classified locally on CPU and are not submitted to a hosted inference provider. Keep that cache between deployments. Relative cache paths resolve from the service directory, so the existing root `npm run dev:ai` command uses the same warmed cache. The API defaults to local cache only and returns 503 until the dependencies and model are available. It does not download arbitrary models from request payloads.

Settings in .env.example:

| Setting                         | Default                    |
| ------------------------------- | -------------------------- |
| NEWS_SENTIMENT_ENABLED          | true                       |
| NEWS_SENTIMENT_MODEL            | ProsusAI/finbert           |
| NEWS_SENTIMENT_REVISION         | pinned 40-character commit |
| NEWS_SENTIMENT_CACHE_DIR        | artifacts/huggingface      |
| NEWS_SENTIMENT_LOCAL_FILES_ONLY | true                       |
| NEWS_SENTIMENT_BATCH_SIZE       | 8                          |

An alternate model must expose exactly the positive/negative/neutral semantic labels in id2label and have a supported token window. The revision must be a commit SHA; trust_remote_code is disabled. Restart to apply configuration changes. Each worker owns a cached model instance, so account for model memory when choosing worker count.

## Single article

POST /news/sentiment:

```json
{
  "symbol": "AAPL",
  "headline": "Apple reports higher earnings and revenue",
  "articleSummary": "Apple reported revenue growth and higher quarterly profits. Management raised its full-year earnings guidance."
}
```

Input accepts articleSummary, article_summary, or summary. The symbol follows the shared ticker format. Headline is limited to 300 characters and summary to 6,000; both must be nonblank. Optional language must be en. This declares English input; language detection is not performed. No article URLs, model identifiers, or credentials are accepted in requests.

The response has exactly the requested five fields:

```json
{
  "symbol": "AAPL",
  "sentiment": "positive",
  "confidence": 0.86,
  "summary": "Apple reported revenue growth and higher quarterly profits. Management raised its full-year earnings guidance.",
  "keyTopics": ["earnings", "revenue", "guidance"]
}
```

This is an illustrative shape, not a claimed model score for that article. Exact scores depend on the loaded model and text. X-Sentiment-Model, X-Sentiment-Revision, and X-Confidence-Method headers identify the method; the shared X-Request-Id remains present. Unlike older analysis routes, the single result is returned directly rather than inside a data envelope.

## Batch

POST /news/sentiment/batch accepts {"articles": [ ... ]}, with 1–32 articles. Results preserve input order, including duplicate symbols/articles. The response contains results, count, model, revision, confidence_method, and limitations. Different symbols are supported in one batch; results are per article, not an aggregate portfolio sentiment.

Requests are validated before inference. An invalid article rejects the batch with 422. Model/cache failure or a busy inference instance rejects the batch with 503 and Retry-After; it does not return fabricated per-item confidence or misleading partial success. The service batches model chunks in groups of eight by default and serializes concurrent inference for each model instance.

Ready-to-send examples are in examples/news-sentiment.json and examples/news-sentiment-batch.json. From the repository root:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/news/sentiment -Method Post -ContentType application/json -InFile apps/ai-service/examples/news-sentiment.json
Invoke-RestMethod http://127.0.0.1:8000/news/sentiment/batch -Method Post -ContentType application/json -InFile apps/ai-service/examples/news-sentiment-batch.json
```

## Meaning of confidence, summaries, and topics

FinBERT is trained for English financial sentiment and provides softmax scores over three labels. The headline and supplied summary are combined as the classifier input. Long text is split into non-overlapping model-token chunks that fit the model window (up to 512 tokens including special tokens). No input tail is silently discarded. Each article is limited to 8,192 model tokens; exceeding it returns 422. Articles are aggregated by the content-token-weighted mean of chunk class scores, then the largest score determines the label. Chunk boundaries can disrupt context, and averaging can obscure conflicting sentiments. Exact ties use the declared positive/negative/neutral order.

Confidence is the winning softmax-derived score, not an empirically calibrated probability of correctness, article truth, relevance to the supplied symbol, or investment profit. Calibration and accuracy on a representative labeled news dataset are separate evaluation work. Negative or positive tone does not guarantee a future stock-price direction.

Summary is an extract of at most the first two sentences of the caller's article summary, bounded to 600 characters. It is not a generated synopsis, causal explanation, or fact check. keyTopics uses a deterministic financial keyword taxonomy (earnings, revenue, guidance, acquisitions, dividends, buybacks, financing, regulation, litigation, products, employment, and macroeconomics), ordered by first mention and capped at ten. Topics indicate textual mentions, including negated mentions; they do not assert that an event occurred.

The symbol is retained from the request. FinBERT produces article-level sentiment, not entity-targeted sentiment: a story involving competitors, customers, or several companies can have a different implication for the requested ticker. Unsupported languages, sarcasm, conflicting statements, quotation attribution, and changing news language can produce errors. Use representative entity-aware evaluation before drawing company-specific conclusions.

## Integration and verification

app/models/financial_nlp.py handles pinned model loading and chunked inference; app/services/news_sentiment.py handles result assembly, extractive summaries, and topics; app/schemas/news.py validates requests/results; app/api/news.py provides the endpoints. CPU inference uses synchronous FastAPI worker threads with a nonblocking model lock. There is no article scraping, news persistence, broker integration, or automatic trade action.

The standard suite tests the contract and adapter with deterministic test doubles, including semantic label mapping, full-text chunk processing, weighted aggregation, batch ordering, bounds, and explicit failures. Test doubles verify implementation, not real model accuracy. Real-model smoke checks require installing the optional runtime and warming the cache. Keep deployment behind the authenticated API gateway and apply request-size and rate limits as described in README.md.

Model and implementation references: [FinBERT model card](https://huggingface.co/ProsusAI/finbert), [pinned label mapping](https://huggingface.co/ProsusAI/finbert/blob/4556d13015211d73dccd3fdd39d39232506f3e43/config.json), and [Hugging Face classification pipelines](https://huggingface.co/docs/transformers/main_classes/pipelines).

## Container option and real-model smoke check

The existing Dockerfile supports `--build-arg INSTALL_NEWS_NLP=true` to include the optional NLP runtime and warm-up scripts. Its non-root user can write `/app/artifacts/huggingface`. Mount that directory as a persistent cache, run the warm-up script with `--download` inside the image before serving, and reuse the same cache for the service. The default lightweight image keeps the existing analysis endpoints and returns 503 for uncached financial NLP. A container build is separate from the Python verification.

After warming the cache, run `python scripts/check_news_model.py` from apps/ai-service. It exercises the real model through both routes, checks identical single/batch classification, and verifies a multi-chunk article. It writes sample outputs to artifacts/news-smoke. These examples check execution and response contracts, not calibrated accuracy or investment performance.

Real-model single, batch, and multi-window smoke checks passed on the bundled illustrative articles. Sample outputs are saved locally under artifacts/news-smoke; they are not an accuracy benchmark.
