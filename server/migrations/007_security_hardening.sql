-- Stage 5: Security & Audit Hardening
-- 1. Approval decision reasons and timestamps on purchase_orders, requisitions, and count_sheets.
-- 2. Validated document attachments (safe file uploads with strict MIME, size, and SHA-256 verification).

ALTER TABLE purchase_orders ADD COLUMN decision_reason TEXT;
ALTER TABLE purchase_orders ADD COLUMN decided_by INTEGER REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE purchase_orders ADD COLUMN decided_at TEXT;

ALTER TABLE requisitions ADD COLUMN decision_reason TEXT;

ALTER TABLE count_sheets ADD COLUMN decision_reason TEXT;
ALTER TABLE count_sheets ADD COLUMN decided_by INTEGER REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE count_sheets ADD COLUMN decided_at TEXT;

CREATE TABLE document_attachments (
  id INTEGER PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
  target_type TEXT NOT NULL CHECK (target_type IN ('stock_document', 'purchase_order', 'requisition', 'count_sheet')),
  target_id INTEGER NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('application/pdf', 'image/png', 'image/jpeg', 'text/csv')),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 2097152),
  checksum_sha256 TEXT NOT NULL,
  content_base64 TEXT NOT NULL,
  uploaded_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_attachments_target ON document_attachments(organisation_id, target_type, target_id);
