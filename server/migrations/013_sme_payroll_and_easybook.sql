-- Migration 013: SME Payroll & EasyBook Balancing
-- Simple, high-efficiency business management for small and medium enterprises.

CREATE TABLE IF NOT EXISTS payroll_employees (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  organisation_id     INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  employee_code       TEXT NOT NULL,
  full_name           TEXT NOT NULL,
  national_id         TEXT,
  job_title           TEXT NOT NULL DEFAULT 'Store Assistant',
  department_name     TEXT NOT NULL DEFAULT 'Storefloor',
  base_salary_cents   INTEGER NOT NULL DEFAULT 0 CHECK (base_salary_cents >= 0),
  currency            TEXT NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'ZiG')),
  ecocash_number      TEXT,
  bank_name           TEXT,
  bank_account        TEXT,
  payment_method      TEXT NOT NULL DEFAULT 'ECOCASH' CHECK (payment_method IN ('ECOCASH', 'CASH', 'BANK')),
  active              INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (organisation_id, employee_code)
);

CREATE TABLE IF NOT EXISTS payroll_runs (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  organisation_id     INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  period_label        TEXT NOT NULL, -- e.g. "November 2026"
  currency            TEXT NOT NULL DEFAULT 'USD',
  total_gross_cents   INTEGER NOT NULL DEFAULT 0,
  total_deductions_cents INTEGER NOT NULL DEFAULT 0,
  total_net_cents     INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'APPROVED', 'PAID')),
  paid_at             TEXT,
  processed_by_name   TEXT NOT NULL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payroll_payslips (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  payroll_run_id      INTEGER NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id         INTEGER NOT NULL REFERENCES payroll_employees(id) ON DELETE CASCADE,
  employee_name       TEXT NOT NULL,
  job_title           TEXT NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'USD',
  base_pay_cents      INTEGER NOT NULL DEFAULT 0,
  allowances_cents    INTEGER NOT NULL DEFAULT 0,
  gross_pay_cents     INTEGER NOT NULL DEFAULT 0,
  deductions_cents    INTEGER NOT NULL DEFAULT 0,
  net_pay_cents       INTEGER NOT NULL DEFAULT 0,
  payment_method      TEXT NOT NULL DEFAULT 'ECOCASH',
  contipay_reference  TEXT,
  payment_status      TEXT NOT NULL DEFAULT 'PENDING' CHECK (payment_status IN ('PENDING', 'PAID', 'FAILED')),
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cashbook_entries (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  organisation_id     INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  entry_date          TEXT NOT NULL DEFAULT (date('now')),
  entry_type          TEXT NOT NULL CHECK (entry_type IN ('INCOME', 'EXPENSE')),
  category            TEXT NOT NULL, -- e.g. 'Daily Cash Sales', 'Rent & Rates', 'Utilities/ZESA', 'Supplier Restock', 'Salaries & Wages', 'Fuel/Transport', 'Miscellaneous'
  description         TEXT NOT NULL,
  payment_method      TEXT NOT NULL DEFAULT 'CASH' CHECK (payment_method IN ('CASH', 'ECOCASH', 'BANK')),
  currency            TEXT NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'ZiG')),
  amount_cents        INTEGER NOT NULL CHECK (amount_cents > 0),
  receipt_voucher_ref TEXT,
  reconciled          INTEGER NOT NULL DEFAULT 1 CHECK (reconciled IN (0, 1)),
  created_by_name     TEXT NOT NULL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
