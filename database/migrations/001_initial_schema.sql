BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_status AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'DELETED');
CREATE TYPE account_type AS ENUM ('PAPER');
CREATE TYPE order_side AS ENUM ('BUY', 'SELL');
CREATE TYPE order_status AS ENUM (
  'PENDING',
  'FILLED',
  'PARTIALLY_FILLED',
  'CANCELLED',
  'REJECTED'
);
CREATE TYPE quote_status AS ENUM ('REALTIME', 'DELAYED', 'SIMULATED', 'STALE');
CREATE TYPE alert_condition AS ENUM ('ABOVE', 'BELOW');
CREATE TYPE alert_status AS ENUM ('ACTIVE', 'TRIGGERED', 'PAUSED', 'CANCELLED');
CREATE TYPE notification_channel AS ENUM ('IN_APP', 'EMAIL', 'PUSH');
CREATE TYPE notification_status AS ENUM ('PENDING', 'SENT', 'FAILED', 'READ');
CREATE TYPE sentiment_label AS ENUM ('POSITIVE', 'NEUTRAL', 'NEGATIVE');
CREATE TYPE transaction_type AS ENUM (
  'VIRTUAL_FUNDING',
  'BUY',
  'SELL',
  'FEE',
  'ADJUSTMENT'
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  password_hash text NOT NULL,
  status user_status NOT NULL DEFAULT 'PENDING',
  email_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT users_email_not_blank CHECK (length(btrim(email)) > 3),
  CONSTRAINT users_email_deleted_consistent CHECK (
    (status = 'DELETED' AND deleted_at IS NOT NULL)
    OR (status <> 'DELETED' AND deleted_at IS NULL)
  )
);

CREATE UNIQUE INDEX users_email_lower_uq ON users (lower(email));
CREATE INDEX users_status_created_idx ON users (status, created_at DESC);

CREATE TABLE user_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name text,
  locale text NOT NULL DEFAULT 'en',
  time_zone text NOT NULL DEFAULT 'UTC',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_profiles_display_name_length CHECK (
    display_name IS NULL OR length(display_name) BETWEEN 1 AND 100
  )
);

CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  account_type account_type NOT NULL DEFAULT 'PAPER',
  name text NOT NULL DEFAULT 'Paper Trading',
  base_currency varchar(3) NOT NULL DEFAULT 'USD',
  initial_virtual_capital numeric(20, 4) NOT NULL DEFAULT 100000.0000,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accounts_base_currency_format CHECK (base_currency ~ '^[A-Z]{3}$'),
  CONSTRAINT accounts_initial_capital_positive CHECK (initial_virtual_capital > 0),
  CONSTRAINT accounts_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT accounts_id_user_uq UNIQUE (id, user_id)
);

CREATE INDEX accounts_user_created_idx ON accounts (user_id, created_at DESC);

CREATE TABLE wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  currency varchar(3) NOT NULL,
  balance numeric(20, 4) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wallets_account_currency_uq UNIQUE (account_id, currency),
  CONSTRAINT wallets_account_id_id_uq UNIQUE (account_id, id),
  CONSTRAINT wallets_id_currency_uq UNIQUE (id, currency),
  CONSTRAINT wallets_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT wallets_balance_nonnegative CHECK (balance >= 0)
);

CREATE TABLE symbols (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  exchange_code text NOT NULL,
  company_name text NOT NULL,
  asset_type text NOT NULL DEFAULT 'EQUITY',
  quote_currency varchar(3) NOT NULL,
  country_code varchar(2),
  is_active boolean NOT NULL DEFAULT true,
  data_provider text,
  provider_symbol text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT symbols_exchange_symbol_uq UNIQUE (exchange_code, symbol),
  CONSTRAINT symbols_symbol_not_blank CHECK (length(btrim(symbol)) > 0),
  CONSTRAINT symbols_exchange_not_blank CHECK (length(btrim(exchange_code)) > 0),
  CONSTRAINT symbols_currency_format CHECK (quote_currency ~ '^[A-Z]{3}$'),
  CONSTRAINT symbols_country_format CHECK (
    country_code IS NULL OR country_code ~ '^[A-Z]{2}$'
  )
);

CREATE INDEX symbols_active_name_idx ON symbols (company_name, symbol) WHERE is_active;
CREATE UNIQUE INDEX symbols_provider_symbol_uq ON symbols (data_provider, provider_symbol)
  WHERE provider_symbol IS NOT NULL;

CREATE TABLE market_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol_id uuid NOT NULL REFERENCES symbols(id) ON DELETE RESTRICT,
  price numeric(20, 8) NOT NULL,
  currency varchar(3) NOT NULL,
  quote_status quote_status NOT NULL,
  source text NOT NULL,
  observed_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT market_quotes_price_positive CHECK (price > 0),
  CONSTRAINT market_quotes_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT market_quotes_source_not_blank CHECK (length(btrim(source)) > 0)
);

CREATE INDEX market_quotes_symbol_observed_idx
  ON market_quotes (symbol_id, observed_at DESC);
CREATE INDEX market_quotes_received_idx ON market_quotes (received_at DESC);

CREATE TABLE portfolios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  name text NOT NULL DEFAULT 'Main Portfolio',
  base_currency varchar(3) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT portfolios_account_name_uq UNIQUE (account_id, name),
  CONSTRAINT portfolios_account_id_id_uq UNIQUE (account_id, id),
  CONSTRAINT portfolios_currency_format CHECK (base_currency ~ '^[A-Z]{3}$'),
  CONSTRAINT portfolios_name_not_blank CHECK (length(btrim(name)) > 0)
);

CREATE INDEX portfolios_account_idx ON portfolios (account_id);

CREATE TABLE watchlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT watchlists_user_name_uq UNIQUE (user_id, name),
  CONSTRAINT watchlists_name_length CHECK (length(btrim(name)) BETWEEN 1 AND 80)
);

CREATE INDEX watchlists_user_updated_idx ON watchlists (user_id, updated_at DESC);

CREATE TABLE watchlist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  watchlist_id uuid NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
  symbol_id uuid NOT NULL REFERENCES symbols(id) ON DELETE RESTRICT,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT watchlist_items_watchlist_symbol_uq UNIQUE (watchlist_id, symbol_id),
  CONSTRAINT watchlist_items_sort_nonnegative CHECK (sort_order >= 0)
);

CREATE INDEX watchlist_items_symbol_idx ON watchlist_items (symbol_id);
CREATE INDEX watchlist_items_order_idx ON watchlist_items (watchlist_id, sort_order);

CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  portfolio_id uuid NOT NULL,
  symbol_id uuid NOT NULL REFERENCES symbols(id) ON DELETE RESTRICT,
  side order_side NOT NULL,
  status order_status NOT NULL DEFAULT 'PENDING',
  quantity numeric(20, 8) NOT NULL,
  filled_quantity numeric(20, 8) NOT NULL DEFAULT 0,
  average_fill_price numeric(20, 8),
  idempotency_key text NOT NULL,
  rejection_reason text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT orders_account_portfolio_fk
    FOREIGN KEY (account_id, portfolio_id)
    REFERENCES portfolios (account_id, id) ON DELETE RESTRICT,
  CONSTRAINT orders_account_idempotency_uq UNIQUE (account_id, idempotency_key),
  CONSTRAINT orders_id_account_uq UNIQUE (id, account_id),
  CONSTRAINT orders_id_symbol_side_uq UNIQUE (id, symbol_id, side),
  CONSTRAINT orders_quantity_positive CHECK (quantity > 0),
  CONSTRAINT orders_filled_quantity_range CHECK (
    filled_quantity >= 0 AND filled_quantity <= quantity
  ),
  CONSTRAINT orders_average_price_valid CHECK (
    average_fill_price IS NULL OR average_fill_price > 0
  ),
  CONSTRAINT orders_status_fill_consistent CHECK (
    (status = 'FILLED' AND filled_quantity = quantity AND average_fill_price IS NOT NULL)
    OR (
      status = 'PARTIALLY_FILLED'
      AND filled_quantity > 0
      AND filled_quantity < quantity
      AND average_fill_price IS NOT NULL
    )
    OR (
      status IN ('PENDING', 'REJECTED')
      AND filled_quantity = 0
      AND average_fill_price IS NULL
    )
    OR (
      status = 'CANCELLED'
      AND (
        filled_quantity < quantity
        AND (
          (filled_quantity = 0 AND average_fill_price IS NULL)
          OR (filled_quantity > 0 AND average_fill_price IS NOT NULL)
        )
      )
    )
  ),
  CONSTRAINT orders_idempotency_key_not_blank CHECK (length(btrim(idempotency_key)) > 0)
);

CREATE INDEX orders_account_submitted_idx ON orders (account_id, submitted_at DESC);
CREATE INDEX orders_portfolio_status_submitted_idx
  ON orders (portfolio_id, status, submitted_at DESC);
CREATE INDEX orders_symbol_submitted_idx ON orders (symbol_id, submitted_at DESC);

CREATE TABLE trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  symbol_id uuid NOT NULL REFERENCES symbols(id) ON DELETE RESTRICT,
  side order_side NOT NULL,
  quantity numeric(20, 8) NOT NULL,
  price numeric(20, 8) NOT NULL,
  currency varchar(3) NOT NULL,
  executed_at timestamptz NOT NULL DEFAULT now(),
  execution_reference text,
  CONSTRAINT trades_order_symbol_side_fk
    FOREIGN KEY (order_id, symbol_id, side)
    REFERENCES orders (id, symbol_id, side) ON DELETE RESTRICT,
  CONSTRAINT trades_id_order_uq UNIQUE (id, order_id),
  CONSTRAINT trades_quantity_positive CHECK (quantity > 0),
  CONSTRAINT trades_price_positive CHECK (price > 0),
  CONSTRAINT trades_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT trades_order_reference_uq UNIQUE (order_id, execution_reference)
);

CREATE INDEX trades_order_executed_idx ON trades (order_id, executed_at);
CREATE INDEX trades_symbol_executed_idx ON trades (symbol_id, executed_at DESC);

CREATE TABLE transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  wallet_id uuid NOT NULL,
  order_id uuid,
  trade_id uuid,
  transaction_type transaction_type NOT NULL,
  amount numeric(20, 4) NOT NULL,
  currency varchar(3) NOT NULL,
  idempotency_key text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transactions_wallet_account_fk
    FOREIGN KEY (account_id, wallet_id)
    REFERENCES wallets (account_id, id) ON DELETE RESTRICT,
  CONSTRAINT transactions_wallet_currency_fk
    FOREIGN KEY (wallet_id, currency)
    REFERENCES wallets (id, currency) ON DELETE RESTRICT,
  CONSTRAINT transactions_trade_fk
    FOREIGN KEY (trade_id)
    REFERENCES trades (id) ON DELETE RESTRICT,
  CONSTRAINT transactions_order_account_fk
    FOREIGN KEY (order_id, account_id)
    REFERENCES orders (id, account_id) ON DELETE RESTRICT,
  CONSTRAINT transactions_trade_order_fk
    FOREIGN KEY (trade_id, order_id)
    REFERENCES trades (id, order_id) ON DELETE RESTRICT,
  CONSTRAINT transactions_account_idempotency_uq UNIQUE (account_id, idempotency_key),
  CONSTRAINT transactions_id_amount_nonzero CHECK (amount <> 0),
  CONSTRAINT transactions_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT transactions_amount_type_consistent CHECK (
    (transaction_type IN ('VIRTUAL_FUNDING', 'SELL') AND amount > 0)
    OR (transaction_type IN ('BUY', 'FEE') AND amount < 0)
    OR transaction_type = 'ADJUSTMENT'
  ),
  CONSTRAINT transactions_trade_requires_order CHECK (
    trade_id IS NULL OR order_id IS NOT NULL
  )
);

CREATE INDEX transactions_account_created_idx ON transactions (account_id, created_at DESC);
CREATE INDEX transactions_wallet_created_idx ON transactions (wallet_id, created_at DESC);
CREATE INDEX transactions_order_idx ON transactions (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX transactions_trade_idx ON transactions (trade_id) WHERE trade_id IS NOT NULL;

CREATE TABLE positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id uuid NOT NULL REFERENCES portfolios(id) ON DELETE RESTRICT,
  symbol_id uuid NOT NULL REFERENCES symbols(id) ON DELETE RESTRICT,
  quantity numeric(20, 8) NOT NULL DEFAULT 0,
  average_cost numeric(20, 8) NOT NULL DEFAULT 0,
  realized_pnl numeric(20, 4) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT positions_portfolio_symbol_uq UNIQUE (portfolio_id, symbol_id),
  CONSTRAINT positions_quantity_nonnegative CHECK (quantity >= 0),
  CONSTRAINT positions_average_cost_nonnegative CHECK (average_cost >= 0),
  CONSTRAINT positions_flat_cost_zero CHECK (quantity > 0 OR average_cost = 0)
);

CREATE INDEX positions_symbol_idx ON positions (symbol_id);
CREATE INDEX positions_portfolio_nonzero_idx ON positions (portfolio_id, symbol_id)
  WHERE quantity > 0;

CREATE TABLE price_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol_id uuid NOT NULL REFERENCES symbols(id) ON DELETE RESTRICT,
  condition alert_condition NOT NULL,
  target_price numeric(20, 8) NOT NULL,
  currency varchar(3) NOT NULL,
  status alert_status NOT NULL DEFAULT 'ACTIVE',
  triggered_price numeric(20, 8),
  triggered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT price_alerts_target_positive CHECK (target_price > 0),
  CONSTRAINT price_alerts_triggered_price_positive CHECK (
    triggered_price IS NULL OR triggered_price > 0
  ),
  CONSTRAINT price_alerts_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT price_alerts_trigger_consistent CHECK (
    (status = 'TRIGGERED' AND triggered_at IS NOT NULL AND triggered_price IS NOT NULL)
    OR (status <> 'TRIGGERED' AND triggered_at IS NULL AND triggered_price IS NULL)
  )
);

CREATE INDEX price_alerts_active_symbol_idx ON price_alerts (symbol_id, target_price)
  WHERE status = 'ACTIVE';
CREATE INDEX price_alerts_user_created_idx ON price_alerts (user_id, created_at DESC);

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel notification_channel NOT NULL,
  status notification_status NOT NULL DEFAULT 'PENDING',
  notification_type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  deduplication_key text,
  sent_at timestamptz,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notifications_deduplication_uq UNIQUE (user_id, deduplication_key),
  CONSTRAINT notifications_type_not_blank CHECK (length(btrim(notification_type)) > 0),
  CONSTRAINT notifications_title_not_blank CHECK (length(btrim(title)) > 0)
);

CREATE INDEX notifications_user_created_idx ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_pending_idx ON notifications (created_at)
  WHERE status = 'PENDING';
CREATE INDEX notifications_payload_gin_idx ON notifications USING gin (payload);

CREATE TABLE news_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  source_article_id text,
  canonical_url text NOT NULL,
  headline text NOT NULL,
  summary text,
  content_hash text,
  published_at timestamptz,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  language_code varchar(12),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT news_articles_url_uq UNIQUE (canonical_url),
  CONSTRAINT news_articles_source_id_uq UNIQUE (source, source_article_id),
  CONSTRAINT news_articles_source_not_blank CHECK (length(btrim(source)) > 0),
  CONSTRAINT news_articles_headline_not_blank CHECK (length(btrim(headline)) > 0)
);

CREATE INDEX news_articles_published_idx ON news_articles (published_at DESC NULLS LAST);
CREATE INDEX news_articles_source_published_idx ON news_articles (source, published_at DESC);

CREATE TABLE news_sentiment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL REFERENCES news_articles(id) ON DELETE CASCADE,
  symbol_id uuid REFERENCES symbols(id) ON DELETE SET NULL,
  model_name text NOT NULL,
  model_version text NOT NULL,
  label sentiment_label NOT NULL,
  score numeric(8, 7) NOT NULL,
  confidence numeric(8, 7) NOT NULL,
  analyzed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT news_sentiment_article_symbol_model_uq
    UNIQUE (article_id, symbol_id, model_name, model_version),
  CONSTRAINT news_sentiment_score_range CHECK (score BETWEEN -1 AND 1),
  CONSTRAINT news_sentiment_confidence_range CHECK (confidence BETWEEN 0 AND 1)
);

CREATE INDEX news_sentiment_symbol_analyzed_idx
  ON news_sentiment (symbol_id, analyzed_at DESC);
CREATE INDEX news_sentiment_label_analyzed_idx
  ON news_sentiment (label, analyzed_at DESC);

CREATE TABLE ai_research (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol_id uuid REFERENCES symbols(id) ON DELETE SET NULL,
  portfolio_id uuid REFERENCES portfolios(id) ON DELETE SET NULL,
  research_type text NOT NULL,
  question text,
  response text NOT NULL,
  provider text NOT NULL,
  model_name text NOT NULL,
  prompt_version text NOT NULL,
  source_references jsonb NOT NULL DEFAULT '[]'::jsonb,
  input_data_as_of timestamptz,
  generated_at timestamptz NOT NULL DEFAULT now(),
  retention_until timestamptz,
  CONSTRAINT ai_research_type_not_blank CHECK (length(btrim(research_type)) > 0),
  CONSTRAINT ai_research_response_not_blank CHECK (length(btrim(response)) > 0),
  CONSTRAINT ai_research_retention_valid CHECK (
    retention_until IS NULL OR retention_until > generated_at
  )
);

CREATE INDEX ai_research_user_generated_idx ON ai_research (user_id, generated_at DESC);
CREATE INDEX ai_research_symbol_generated_idx
  ON ai_research (symbol_id, generated_at DESC) WHERE symbol_id IS NOT NULL;
CREATE INDEX ai_research_retention_idx
  ON ai_research (retention_until) WHERE retention_until IS NOT NULL;

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  device_label text,
  ip_address inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CONSTRAINT sessions_token_hash_uq UNIQUE (token_hash),
  CONSTRAINT sessions_expiry_after_creation CHECK (expires_at > created_at)
);

CREATE INDEX sessions_user_active_idx ON sessions (user_id, expires_at)
  WHERE revoked_at IS NULL;
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

CREATE TABLE audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  outcome text NOT NULL,
  request_id text,
  ip_address inet,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_action_not_blank CHECK (length(btrim(action)) > 0),
  CONSTRAINT audit_entity_type_not_blank CHECK (length(btrim(entity_type)) > 0),
  CONSTRAINT audit_outcome_not_blank CHECK (length(btrim(outcome)) > 0)
);

CREATE INDEX audit_logs_actor_time_idx ON audit_logs (actor_user_id, occurred_at DESC);
CREATE INDEX audit_logs_entity_time_idx
  ON audit_logs (entity_type, entity_id, occurred_at DESC);
CREATE INDEX audit_logs_request_idx ON audit_logs (request_id) WHERE request_id IS NOT NULL;
CREATE INDEX audit_logs_metadata_gin_idx ON audit_logs USING gin (metadata);

CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE FUNCTION reject_immutable_record_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Rows in % are append-only; write a compensating record instead.', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER transactions_reject_mutation
  BEFORE UPDATE OR DELETE ON transactions
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_mutation();

CREATE TRIGGER audit_logs_reject_mutation
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_mutation();

CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER user_profiles_set_updated_at BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER accounts_set_updated_at BEFORE UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER symbols_set_updated_at BEFORE UPDATE ON symbols
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER portfolios_set_updated_at BEFORE UPDATE ON portfolios
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER watchlists_set_updated_at BEFORE UPDATE ON watchlists
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER orders_set_updated_at BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER positions_set_updated_at BEFORE UPDATE ON positions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER price_alerts_set_updated_at BEFORE UPDATE ON price_alerts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE accounts IS
  'PAPER accounts only. initial_virtual_capital is simulated, not cash or a deposit.';
COMMENT ON TABLE wallets IS
  'Cached/projection balance; transactions are the auditable virtual-cash ledger.';
COMMENT ON TABLE transactions IS
  'Append-only virtual-cash ledger. Correct mistakes with compensating entries.';
COMMENT ON TABLE market_quotes IS
  'Quote observations retain source and status so simulated data is not confused with live data.';
COMMENT ON TABLE audit_logs IS
  'Security and domain audit record. Restrict write access and do not store credentials or tokens.';

COMMIT;
