BEGIN;
CREATE TABLE notification_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  installation_id uuid NOT NULL,
  expo_push_token text NOT NULL UNIQUE,
  platform text NOT NULL CHECK (platform IN ('ios', 'android')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_devices_user_installation_uq UNIQUE (user_id, installation_id)
);
CREATE INDEX notification_devices_user_session_idx ON notification_devices (user_id, session_id);
COMMIT;
