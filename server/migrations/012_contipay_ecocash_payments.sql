-- Stage 10: ContiPay EcoCash Payments Integration & Audit Log
CREATE TABLE IF NOT EXISTS contipay_transactions (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  organisation_id     INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  document_id         INTEGER REFERENCES stock_documents(id) ON DELETE SET NULL,
  reference           TEXT NOT NULL,
  provider            TEXT NOT NULL DEFAULT 'ECOCASH',
  phone_number        TEXT NOT NULL,
  amount_cents        INTEGER NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'USD',
  status              TEXT NOT NULL DEFAULT 'COMPLETED',
  auth_code           TEXT NOT NULL,
  gateway_response    TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (organisation_id, reference)
);

ALTER TABLE fiscal_receipts ADD COLUMN contipay_reference TEXT;
