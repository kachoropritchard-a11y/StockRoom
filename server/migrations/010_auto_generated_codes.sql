-- Auto-generated codes for departments and categories
ALTER TABLE departments ADD COLUMN code TEXT;
ALTER TABLE categories ADD COLUMN code TEXT;

-- Backfill codes for existing departments and categories
UPDATE departments SET code = 'DPT-' || printf('%03d', id) WHERE code IS NULL;
UPDATE categories SET code = 'CAT-' || printf('%03d', id) WHERE code IS NULL;
