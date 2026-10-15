BEGIN;

CREATE TYPE auth_token_purpose AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');

CREATE TABLE auth_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose auth_token_purpose NOT NULL,
  token_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CONSTRAINT auth_tokens_hash_uq UNIQUE (token_hash),
  CONSTRAINT auth_tokens_expiry_after_creation CHECK (expires_at > created_at)
);

CREATE INDEX auth_tokens_user_purpose_idx
  ON auth_tokens (user_id, purpose, expires_at DESC);
CREATE INDEX auth_tokens_expiry_idx ON auth_tokens (expires_at);

CREATE TABLE refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  CONSTRAINT refresh_tokens_hash_uq UNIQUE (token_hash),
  CONSTRAINT refresh_tokens_expiry_after_creation CHECK (expires_at > created_at)
);

CREATE INDEX refresh_tokens_session_idx ON refresh_tokens (session_id, expires_at DESC);
CREATE INDEX refresh_tokens_expiry_idx ON refresh_tokens (expires_at);

COMMIT;
