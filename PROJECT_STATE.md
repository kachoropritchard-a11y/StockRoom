# PROJECT_STATE

## Architecture
- **Monorepo** (npm workspaces): `server/` (API) and `web/` (PWA frontend). Environment: Node 24, Python 3.12, Git 2.56 (`C:\Program Files\Git\cmd\git.exe`, added to User PATH and initialised in `.git`).
- **Backend:** Node 24 running TypeScript natively (type-stripping, no build step), Fastify, Zod validation, helmet, CORS allow-list, rate-limited login, CSRF header + Origin check.
- **Database:** SQLite via built-in `node:sqlite`, plain `.sql` migrations in `server/migrations` (`001_init.sql` .. `004_inventory_gaps.sql`), applied by `server/src/migrate.ts`.
- **Authoritative Stock Engine:** `server/src/inventory/engine.ts` is the sole writer to `stock_movements`. `stock_balances` is a SQL view (`SUM(base_delta_milli)` per organisation, product, and warehouse). No duplicate balance calculation logic exists anywhere in the codebase.
- **Auth & Security:** email/password (`bcryptjs`), opaque session tokens stored SHA-256 hashed in `sessions`, sent as `httpOnly SameSite=Lax` cookie (web) or `Bearer` token (mobile/desktop wrappers). Account lockout after 5 failed attempts, operator CLI password reset (`npm run reset-password`), and self-service password reset (`POST /api/auth/forgot-password` + `POST /api/auth/reset-password` backed by `password_reset_tokens` and `email_outbox`).
- **Frontend:** Vite, React, TypeScript, `react-router-dom`, Zimbabwe-inspired design tokens (deep green `#0b4f3a`, warm gold `#c9962b`, charcoal `#22262a`, off-white `#f7f4ec`), responsive desktop & mobile drawer shell, PWA manifest + service worker + generated PNG icons.

## Run & Test
```
npm install
npm run migrate
npm run seed          # seeds demo org, users, and Zimbabwean inventory data (idempotent)
npm run dev:server    # http://127.0.0.1:4000 (running in background)
npm run dev:web       # http://localhost:5173 (running in background)
npm test              # 30 server tests
npm test -w web       # 3 frontend routing tests
npm run verify-ledger # audits ledger invariants
```

## Completed Stages
- **Stage 1 & 1.1:** Project setup, config validation, SQLite migrations, login/logout, CSRF protection, account lockout, password change/reset, role-based portals (`/executive`, `/inventory`), PWA manifest/icons/SW.
- **Stage 2:** Core inventory schema (`003_inventory.sql`) and ledger engine (`server/src/inventory/engine.ts`): organisations, branches, warehouses, departments, categories, units of measure, product packagings (unit conversions), suppliers, products, stock documents, and append-only `stock_movements` ledger with `Idempotency-Key` protection, `BEGIN IMMEDIATE` transactions, negative-stock prevention, and executive-only reversals.
- **Stage 2.1 (Gaps Fixed + Full Interactive Web App):**
  - **Git Issue Fixed:** Located `C:\Program Files\Git\cmd\git.exe`, added to User `PATH`, initialised `.git` repository, and committed baseline + stage changes.
  - **Costing & Valuation (`004_inventory_gaps.sql`):** Added `unit_cost_cents` on `products` and `stock_movements`. Receipts record unit cost per base unit and update the product's latest unit cost; warehouse and organisation stock values are computed directly from `stock_balances × unit_cost_cents`.
  - **Reorder Levels & Low-Stock Alerts:** Added `reorder_level_milli` on `products`; low-stock status is derived live from `stock_balances`.
  - **Batch / Lot & Expiry Tracking:** Added `batch_number` and `expiry_date` (`YYYY-MM-DD`) on `stock_movements` (preserved across transfers and reversals) and expiring-soon count in dashboard summary.
  - **Count-Sheet Approval Workflow:** Added `count_sheets` and `count_sheet_lines`. Staff save draft counts, inspect live variances against `getBalance()`, and executives approve them (`POST /api/stock/count-sheets/:id/approve`), which posts an authoritative `count` document through `postDocument()`.
  - **User Management & Self-Service Password Reset:** Added `GET/POST/PATCH /api/users` (executive-only, with self-demotion protection and session revocation) and `POST /api/auth/forgot-password` + `POST /api/auth/reset-password` using `password_reset_tokens` and `email_outbox`.
  - **Interactive Web Application Wired to Live API:**
    - `Dashboard`: Live stock valuation, active products, low-stock alerts, draft count sheets, warehouse valuation breakdown, and recent ledger movements.
    - `Products & Stock` (`/executive/products`, `/inventory/products`): Searchable catalogue, packaging conversion builder, category/supplier creation, and warehouse stock balances with low-stock badges.
    - `Movements & Counts` (`/executive/operations`, `/inventory/operations`): Post receipts (with supplier, cost, batch/lot, expiry), issues, transfers, adjustments, write-offs, draft/approve count sheets, and executive document reversals on the ledger table.
    - `Org & Users` (`/executive/organisation`): Negative-stock policy toggle, live `Verify Ledger Integrity` audit button, branch/warehouse/department creation, and user role/branch management.
  - **Verified:** Server tests 30/30 pass; Web tests 3/3 pass; TypeScript typecheck and production Vite build pass; `npm run verify-ledger` passes (`Ledger OK.`); headless Chrome screenshots verified all 4 screens live on `http://localhost:5173`.

## Current Task
Stage 2.1 complete and web app running live on `http://localhost:5173` (proxying `/api` to `http://127.0.0.1:4000`). Waiting for user review and next stage instructions.

## Known Issues / Notes for Future Stages
- Advanced reporting/exports (CSV/PDF export, date-range movement analytics charts, department consumption reports) can be added in the next stage.
- Purchase order / receiving workflow (draft PO -> partial/full GRN receipt) can be layered onto `stock_documents` if needed.
- `node:sqlite` is built-in on Node 24; keep SQL portable for optional PostgreSQL deployment later.

## Next Step
Ready for your testing on `http://localhost:5173` and your instructions for the next stage.
