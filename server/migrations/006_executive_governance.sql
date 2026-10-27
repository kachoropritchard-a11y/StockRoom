-- Stage 4: Executive governance, separation of duties, role permissions, immutable audit logs, and backup/recovery.

ALTER TABLE organisations ADD COLUMN enforce_separation_of_duties INTEGER NOT NULL DEFAULT 0 CHECK (enforce_separation_of_duties IN (0, 1));
ALTER TABLE organisations ADD COLUMN po_approval_threshold_cents INTEGER NOT NULL DEFAULT 0 CHECK (po_approval_threshold_cents >= 0);
ALTER TABLE organisations ADD COLUMN currency_code TEXT NOT NULL DEFAULT 'USD';

CREATE TABLE role_permissions (
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('executive_manager', 'inventory_manager')),
  permission TEXT NOT NULL,
  allowed INTEGER NOT NULL DEFAULT 1 CHECK (allowed IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (organisation_id, role, permission)
);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
  actor_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  actor_email TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_audit_logs_org_created ON audit_logs(organisation_id, id DESC);

CREATE TRIGGER audit_logs_no_update
BEFORE UPDATE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'audit_logs_are_immutable');
END;

CREATE TRIGGER audit_logs_no_delete
BEFORE DELETE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'audit_logs_are_immutable');
END;

CREATE TABLE system_backups (
  id INTEGER PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
  label TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  checksum_sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  status TEXT NOT NULL DEFAULT 'verified' CHECK (status IN ('verified', 'restored')),
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  restored_at TEXT,
  restored_by INTEGER REFERENCES users(id) ON DELETE RESTRICT
);
