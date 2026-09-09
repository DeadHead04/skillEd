ALTER TABLE users ADD COLUMN password_change_required boolean NOT NULL DEFAULT false;

CREATE TABLE account_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  kind text NOT NULL CHECK (kind IN ('invitation','password_reset')),
  label text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'operator' CHECK (role IN ('administrator','operator')),
  target_user_id uuid REFERENCES users(id),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz,
  CHECK ((kind = 'password_reset') = (target_user_id IS NOT NULL))
);
CREATE INDEX account_tokens_target_idx ON account_tokens(target_user_id) WHERE target_user_id IS NOT NULL;
CREATE INDEX account_tokens_created_idx ON account_tokens(created_at DESC);
