BEGIN;
ALTER TABLE price_alerts ALTER COLUMN condition TYPE text USING condition::text;
ALTER TABLE price_alerts ALTER COLUMN target_price DROP NOT NULL;
ALTER TABLE price_alerts ADD COLUMN target_change_percent numeric(12,8);
ALTER TABLE price_alerts ADD COLUMN channels notification_channel[] NOT NULL DEFAULT ARRAY['IN_APP']::notification_channel[];
ALTER TABLE price_alerts ADD CONSTRAINT price_alerts_condition_valid CHECK (condition IN ('ABOVE','BELOW','CHANGE_PERCENT'));
ALTER TABLE price_alerts ADD CONSTRAINT price_alerts_threshold_valid CHECK (
  (condition IN ('ABOVE','BELOW') AND target_price > 0 AND target_change_percent IS NULL AND target_price IS NOT NULL)
  OR (condition = 'CHANGE_PERCENT' AND target_price IS NULL AND target_change_percent > 0 AND target_change_percent <= 1000 AND target_change_percent IS NOT NULL)
);
ALTER TABLE price_alerts ADD CONSTRAINT price_alerts_channels_valid CHECK (cardinality(channels) BETWEEN 1 AND 3 AND 'IN_APP' = ANY(channels));
CREATE INDEX price_alerts_price_match_idx ON price_alerts (symbol_id, currency, condition, target_price) WHERE status = 'ACTIVE' AND condition IN ('ABOVE','BELOW');
CREATE INDEX price_alerts_change_match_idx ON price_alerts (symbol_id, currency, target_change_percent) WHERE status = 'ACTIVE' AND condition = 'CHANGE_PERCENT';

CREATE TABLE notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  target_key text NOT NULL,
  device_id uuid REFERENCES notification_devices(id) ON DELETE SET NULL,
  state text NOT NULL DEFAULT 'READY' CHECK (state IN ('READY','PROCESSING','ACCEPTED','SENT','FAILED')),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  lease_token uuid,
  provider_ticket text,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (notification_id, target_key)
);
CREATE INDEX notification_outbox_ready_idx ON notification_outbox (available_at,id) WHERE state IN ('READY','ACCEPTED');
CREATE INDEX notification_outbox_lease_idx ON notification_outbox (lease_until) WHERE state = 'PROCESSING';
COMMIT;
