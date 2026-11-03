-- Each audit entry must extend a distinct predecessor: concurrent writers can no longer fork the hash chain.
-- A racing insert fails this constraint and the writer retries against the new head (src/lib/audit.js).
CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_prev_unique ON audit_log(prev_hash);
