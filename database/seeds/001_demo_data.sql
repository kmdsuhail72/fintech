BEGIN;

INSERT INTO users (id, email, password_hash, status, email_verified_at)
VALUES (
  '11111111-1111-4111-8111-111111111111',
  'demo@asteriq.example',
  '!DISABLED_DEMO_PASSWORD!replace-with-a-real-argon2id-hash',
  'ACTIVE',
  now()
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_profiles (user_id, display_name, locale, time_zone)
VALUES (
  '11111111-1111-4111-8111-111111111111',
  'Demo Learner',
  'en',
  'UTC'
)
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO accounts (
  id,
  user_id,
  account_type,
  name,
  base_currency,
  initial_virtual_capital
)
VALUES (
  '22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111',
  'PAPER',
  'Demo Paper Account',
  'USD',
  100000.0000
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO wallets (id, account_id, currency, balance)
VALUES (
  '33333333-3333-4333-8333-333333333333',
  '22222222-2222-4222-8222-222222222222',
  'USD',
  100000.0000
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO transactions (
  id,
  account_id,
  wallet_id,
  transaction_type,
  amount,
  currency,
  idempotency_key,
  description
)
VALUES (
  '44444444-4444-4444-8444-444444444444',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  'VIRTUAL_FUNDING',
  100000.0000,
  'USD',
  'demo-initial-virtual-capital-v1',
  'Initial virtual paper-trading capital; not a real-money deposit'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO portfolios (id, account_id, name, base_currency)
VALUES (
  '55555555-5555-4555-8555-555555555555',
  '22222222-2222-4222-8222-222222222222',
  'Demo Portfolio',
  'USD'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO symbols (
  id,
  symbol,
  exchange_code,
  company_name,
  asset_type,
  quote_currency,
  country_code,
  is_active,
  data_provider,
  provider_symbol
)
VALUES
  (
    '66666666-6666-4666-8666-666666666661',
    'ASTR',
    'DEMO',
    'Asteriq Demo Technologies',
    'EQUITY',
    'USD',
    'US',
    true,
    'synthetic-demo',
    'ASTR.DEMO'
  ),
  (
    '66666666-6666-4666-8666-666666666662',
    'NOVA',
    'DEMO',
    'Nova Learning Markets',
    'EQUITY',
    'USD',
    'US',
    true,
    'synthetic-demo',
    'NOVA.DEMO'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO market_quotes (
  id,
  symbol_id,
  price,
  currency,
  quote_status,
  source,
  observed_at,
  open_price,
  high_price,
  low_price,
  previous_close,
  change_amount,
  change_percent,
  volume
)
VALUES
  (
    '77777777-7777-4777-8777-777777777771',
    '66666666-6666-4666-8666-666666666661',
    125.25000000,
    'USD',
    'SIMULATED',
    'synthetic-demo',
    now(),
    125.25000000,
    125.25000000,
    125.25000000,
    125.25000000,
    0,
    0,
    0
  ),
  (
    '77777777-7777-4777-8777-777777777772',
    '66666666-6666-4666-8666-666666666662',
    48.75000000,
    'USD',
    'SIMULATED',
    'synthetic-demo',
    now(),
    48.75000000,
    48.75000000,
    48.75000000,
    48.75000000,
    0,
    0,
    0
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO watchlists (id, user_id, name)
VALUES (
  '88888888-8888-4888-8888-888888888888',
  '11111111-1111-4111-8111-111111111111',
  'Demo Watchlist'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO watchlist_items (id, watchlist_id, symbol_id, sort_order)
VALUES
  (
    '99999999-9999-4999-8999-999999999991',
    '88888888-8888-4888-8888-888888888888',
    '66666666-6666-4666-8666-666666666661',
    0
  ),
  (
    '99999999-9999-4999-8999-999999999992',
    '88888888-8888-4888-8888-888888888888',
    '66666666-6666-4666-8666-666666666662',
    1
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO price_alerts (
  id,
  user_id,
  symbol_id,
  condition,
  target_price,
  currency,
  status
)
VALUES (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '11111111-1111-4111-8111-111111111111',
  '66666666-6666-4666-8666-666666666661',
  'ABOVE',
  150.00000000,
  'USD',
  'ACTIVE'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO orders (
  id,
  account_id,
  portfolio_id,
  symbol_id,
  side,
  status,
  quantity,
  filled_quantity,
  average_fill_price,
  idempotency_key,
  submitted_at,
  completed_at
)
VALUES (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '22222222-2222-4222-8222-222222222222',
  '55555555-5555-4555-8555-555555555555',
  '66666666-6666-4666-8666-666666666661',
  'BUY',
  'FILLED',
  10.00000000,
  10.00000000,
  125.25000000,
  'demo-order-astr-buy-v1',
  now(),
  now()
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO trades (
  id,
  order_id,
  symbol_id,
  side,
  quantity,
  price,
  currency,
  execution_reference
)
VALUES (
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '66666666-6666-4666-8666-666666666661',
  'BUY',
  10.00000000,
  125.25000000,
  'USD',
  'demo-fill-1'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO transactions (
  id,
  account_id,
  wallet_id,
  order_id,
  trade_id,
  transaction_type,
  amount,
  currency,
  idempotency_key,
  description
)
VALUES (
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'BUY',
  -1252.5000,
  'USD',
  'demo-order-astr-buy-ledger-v1',
  'Simulated purchase of 10 ASTR shares'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO positions (
  id,
  portfolio_id,
  symbol_id,
  quantity,
  average_cost,
  realized_pnl
)
VALUES (
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  '55555555-5555-4555-8555-555555555555',
  '66666666-6666-4666-8666-666666666661',
  10.00000000,
  125.25000000,
  0
)
ON CONFLICT (id) DO NOTHING;

UPDATE wallets
SET balance = 98747.5000
WHERE id = '33333333-3333-4333-8333-333333333333';

INSERT INTO notifications (
  id,
  user_id,
  channel,
  status,
  notification_type,
  title,
  body,
  deduplication_key
)
VALUES (
  'abababab-abab-4bab-8bab-abababababab',
  '11111111-1111-4111-8111-111111111111',
  'IN_APP',
  'PENDING',
  'PAPER_ORDER_FILLED',
  'Paper order filled',
  'Your simulated ASTR order was filled.',
  'demo-order-filled-notification-v1'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO news_articles (
  id,
  source,
  source_article_id,
  canonical_url,
  headline,
  summary,
  published_at,
  language_code
)
VALUES (
  'acacacac-acac-4cac-8cac-acacacacacac',
  'synthetic-demo',
  'demo-article-001',
  'https://example.invalid/demo/astr-market-note',
  'Synthetic demo market note for ASTR',
  'Fictional seed content for testing news sentiment presentation.',
  now(),
  'en'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO news_sentiment (
  id,
  article_id,
  symbol_id,
  model_name,
  model_version,
  label,
  score,
  confidence
)
VALUES (
  'adadadad-adad-4dad-8dad-adadadadadad',
  'acacacac-acac-4cac-8cac-acacacacacac',
  '66666666-6666-4666-8666-666666666661',
  'demo-sentiment',
  '0.0.1',
  'NEUTRAL',
  0.0000000,
  0.5000000
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO ai_research (
  id,
  user_id,
  symbol_id,
  portfolio_id,
  research_type,
  question,
  response,
  provider,
  model_name,
  prompt_version,
  source_references,
  input_data_as_of
)
VALUES (
  'aeaeaeae-aeae-4eae-8eae-aeaeaeaeaeae',
  '11111111-1111-4111-8111-111111111111',
  '66666666-6666-4666-8666-666666666661',
  '55555555-5555-4555-8555-555555555555',
  'INSTRUMENT_SUMMARY',
  'Summarize the synthetic demo instrument.',
  'This is fictional seed text, not investment research or advice.',
  'synthetic-demo',
  'demo-model',
  'demo-prompt-v1',
  '[]'::jsonb,
  now()
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO audit_logs (
  actor_user_id,
  action,
  entity_type,
  entity_id,
  outcome,
  request_id,
  metadata
)
SELECT
  '11111111-1111-4111-8111-111111111111',
  'DEMO_SEED_CREATED',
  'account',
  '22222222-2222-4222-8222-222222222222',
  'SUCCESS',
  'demo-seed-request',
  '{"environment":"synthetic-local-demo"}'::jsonb
WHERE NOT EXISTS (
  SELECT 1
  FROM audit_logs
  WHERE request_id = 'demo-seed-request'
    AND action = 'DEMO_SEED_CREATED'
);

COMMIT;
