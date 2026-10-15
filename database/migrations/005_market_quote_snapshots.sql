BEGIN;

ALTER TABLE market_quotes
  ADD COLUMN open_price numeric(20, 8),
  ADD COLUMN high_price numeric(20, 8),
  ADD COLUMN low_price numeric(20, 8),
  ADD COLUMN previous_close numeric(20, 8),
  ADD COLUMN change_amount numeric(20, 8),
  ADD COLUMN change_percent numeric(12, 8),
  ADD COLUMN volume bigint NOT NULL DEFAULT 0;

UPDATE market_quotes
SET open_price = price,
    high_price = price,
    low_price = price,
    previous_close = price,
    change_amount = 0,
    change_percent = 0;

ALTER TABLE market_quotes
  ALTER COLUMN open_price SET NOT NULL,
  ALTER COLUMN high_price SET NOT NULL,
  ALTER COLUMN low_price SET NOT NULL,
  ALTER COLUMN previous_close SET NOT NULL,
  ALTER COLUMN change_amount SET NOT NULL,
  ALTER COLUMN change_percent SET NOT NULL,
  ADD CONSTRAINT market_quotes_open_positive CHECK (open_price > 0),
  ADD CONSTRAINT market_quotes_high_valid CHECK (high_price >= GREATEST(open_price, low_price, price)),
  ADD CONSTRAINT market_quotes_low_valid CHECK (low_price > 0 AND low_price <= LEAST(open_price, high_price, price)),
  ADD CONSTRAINT market_quotes_previous_close_positive CHECK (previous_close > 0),
  ADD CONSTRAINT market_quotes_volume_nonnegative CHECK (volume >= 0),
  ADD CONSTRAINT market_quotes_change_consistent CHECK (
    abs(change_amount - (price - previous_close)) < 0.00000001
  ),
  ADD CONSTRAINT market_quotes_change_percent_consistent CHECK (
    abs(change_percent - (change_amount / previous_close * 100)) < 0.00000001
  );

COMMIT;
