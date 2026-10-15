BEGIN;

CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roles_name_format CHECK (name ~ '^[a-z][a-z0-9:_-]{1,63}$')
);

CREATE TABLE user_roles (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assigned_by uuid REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, role_id)
);

CREATE INDEX user_roles_role_user_idx ON user_roles (role_id, user_id);

INSERT INTO roles (name) VALUES ('user'), ('admin')
ON CONFLICT (name) DO NOTHING;

INSERT INTO user_roles (user_id, role_id)
SELECT users.id, roles.id
FROM users CROSS JOIN roles
WHERE roles.name = 'user'
ON CONFLICT DO NOTHING;

CREATE FUNCTION assign_default_user_role() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO user_roles (user_id, role_id)
  SELECT NEW.id, roles.id
  FROM roles
  WHERE roles.name = 'user'
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_assign_default_role
  AFTER INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION assign_default_user_role();

COMMIT;
