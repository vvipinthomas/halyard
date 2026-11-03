-- Multi-factor authentication (TOTP + recovery codes)
ALTER TABLE users ADD COLUMN mfa_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN mfa_secret_ct TEXT;
ALTER TABLE users ADD COLUMN mfa_secret_iv TEXT;
ALTER TABLE users ADD COLUMN mfa_pending_ct TEXT;
ALTER TABLE users ADD COLUMN mfa_pending_iv TEXT;
ALTER TABLE users ADD COLUMN mfa_last_counter INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS mfa_recovery (
  user_id TEXT NOT NULL REFERENCES users(id), code_hash TEXT NOT NULL, used_at INTEGER,
  PRIMARY KEY (user_id, code_hash)
);
CREATE TABLE IF NOT EXISTS mfa_challenges (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0
);
