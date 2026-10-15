BEGIN;

INSERT INTO symbols (
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
  ('AAPL', 'NASDAQ', 'Apple Inc.', 'EQUITY', 'USD', 'US', true, 'synthetic-simulator', 'AAPL'),
  ('MSFT', 'NASDAQ', 'Microsoft Corporation', 'EQUITY', 'USD', 'US', true, 'synthetic-simulator', 'MSFT'),
  ('NVDA', 'NASDAQ', 'NVIDIA Corporation', 'EQUITY', 'USD', 'US', true, 'synthetic-simulator', 'NVDA'),
  ('AMZN', 'NASDAQ', 'Amazon.com, Inc.', 'EQUITY', 'USD', 'US', true, 'synthetic-simulator', 'AMZN'),
  ('GOOGL', 'NASDAQ', 'Alphabet Inc. Class A', 'EQUITY', 'USD', 'US', true, 'synthetic-simulator', 'GOOGL'),
  ('META', 'NASDAQ', 'Meta Platforms, Inc.', 'EQUITY', 'USD', 'US', true, 'synthetic-simulator', 'META'),
  ('TSLA', 'NASDAQ', 'Tesla, Inc.', 'EQUITY', 'USD', 'US', true, 'synthetic-simulator', 'TSLA'),
  ('SPY', 'NYSE_ARCA', 'SPDR S&P 500 ETF Trust', 'ETF', 'USD', 'US', true, 'synthetic-simulator', 'SPY')
ON CONFLICT (exchange_code, symbol) DO NOTHING;

INSERT INTO market_quotes (symbol_id, price, currency, quote_status, source, observed_at)
SELECT s.id, initial.price, 'USD', 'SIMULATED', 'synthetic-simulator-seed', now()
FROM (VALUES
  ('AAPL', 227.50000000::numeric),
  ('MSFT', 505.00000000::numeric),
  ('NVDA', 177.00000000::numeric),
  ('AMZN', 225.00000000::numeric),
  ('GOOGL', 175.00000000::numeric),
  ('META', 735.00000000::numeric),
  ('TSLA', 325.00000000::numeric),
  ('SPY', 645.00000000::numeric)
) AS initial(symbol, price)
JOIN symbols s ON s.symbol = initial.symbol
  AND s.exchange_code = CASE WHEN initial.symbol = 'SPY' THEN 'NYSE_ARCA' ELSE 'NASDAQ' END
  AND s.data_provider = 'synthetic-simulator'
WHERE NOT EXISTS (
  SELECT 1 FROM market_quotes q
  WHERE q.symbol_id = s.id AND q.source = 'synthetic-simulator-seed'
);

COMMIT;
