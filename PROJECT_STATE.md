# PROJECT_STATE

## Architecture
- **Monorepo** (npm workspaces): `server/` (API) and `web/` (PWA frontend). Environment: Node 24, Python 3.12, Git 2.56 (`C:\Program Files\Git\cmd\git.exe`, added to User PATH and initialised in `.git`).
- **Backend:** Node 24 running TypeScript natively (type-stripping, no build step), Fastify, Zod validation, helmet, CORS allow-list, rate-limited login, CSRF header + Origin check.
- **Database:** SQLite via built-in `node:sqlite`, plain `.sql` migrations in `server/migrations` (`001_init.sql` .. `005_procurement_requisitions_returns.sql`), applied by `server/src/migrate.ts`.
- **Authoritative Stock Engine:** `server/src/inventory/engine.ts` is the sole writer to `stock_movements`. `stock_balances` is a SQL view (`SUM(base_delta_milli)` per organisation, product, and warehouse). No duplicate balance calculation logic exists anywhere in the codebase.
- **Auth & Security:** email/password (`bcryptjs`), opaque session tokens stored SHA-256 hashed in `sessions`, sent as `httpOnly SameSite=Lax` cookie (web) or `Bearer` token (mobile/desktop wrappers). Account lockout after 5 failed attempts, operator CLI password reset (`npm run reset-password`), and self-service password reset (`POST /api/auth/forgot-password` + `POST /api/auth/reset-password` backed by `password_reset_tokens` and `email_outbox`).
- **Frontend:** Vite, React, TypeScript, `react-router-dom`, Command-Center UI (`STOCKROOM OPERATIONS • LIVE`) with Light & Dark themes, Zimbabwe-inspired deep green (`#0b4f3a`), warm gold (`#c9962b`), teal (`#11a89d`), and indigo (`#4f52e8`) accents, WAI-ARIA `AccessibleTabs` with purpose banners and arrow-key navigation, `QuickTransferModal` (`Alt+T`), `ConfirmDialog` (`Esc` to close), global keyboard shortcuts (`Alt+1..7`, `Alt+K` / `/`), PWA manifest + service worker + generated PNG icons.

## Run & Test
```
npm install
npm run migrate
npm run seed          # seeds demo org, users, Zimbabwean inventory, POs, and requisitions (idempotent)
npm run dev:server    # http://127.0.0.1:4000 (running in background)
npm run dev:web       # http://localhost:5173 (running in background)
npm test              # 33 server tests
npm test -w web       # 4 frontend routing & portal tests
npm run verify-ledger # audits ledger invariants
```

## Completed Stages
- **Stage 1 & 1.1:** Project setup, config validation, SQLite migrations, login/logout, CSRF protection, account lockout, password change/reset, role-based portals (`/executive`, `/inventory`), PWA manifest/icons/SW.
- **Stage 2 & 2.1:** Core inventory schema (`003_inventory.sql`, `004_inventory_gaps.sql`) and ledger engine (`server/src/inventory/engine.ts`): organisations, branches, warehouses, departments, categories, units of measure, product packagings (unit conversions), suppliers, products, costing (`unit_cost_cents`), reorder levels (`reorder_level_milli`), batch/expiry tracking (`batch_number`, `expiry_date`), count sheets (`count_sheets`, `count_sheet_lines`), user management, and append-only `stock_movements` ledger with `Idempotency-Key` protection, `BEGIN IMMEDIATE` transactions, negative-stock prevention, and executive-only reversals.
- **Stage 3 (Complete Inventory Manager Portal & Operational Workflows):**
  1. **Product & Category Management (`Products.tsx`):** Searchable, category-filtered, paginated product catalogue (`limit`/`offset`), inline product editor (name, category, unit cost, reorder level, active toggle), packaging conversion builder, unit-of-measure creation, and interactive category active/inactive toggles.
  2. **Warehouses & Departments (`Warehouses.tsx`):** Warehouse stock valuation and SKU summary with one-click stock filtering, department directory with live consumption analytics (issues, write-offs, units & USD value consumed), and executive warehouse/department creation.
  3. **Supplier & Purchase-Order Management (`Procurement.tsx`, `005_procurement_requisitions_returns.sql`):** Supplier directory with contact details and active/inactive toggles; Purchase Order creation (`draft` or immediately `approved`), status filtering (`draft`, `approved`, `partial`, `received`, `cancelled`), approval, and cancellation with confirmation dialogs.
  4. **Receiving & Partial Deliveries (`Procurement.tsx`, `receivePurchaseOrder`):** Inspect ordered vs received vs remaining quantities per PO line, enter partial or full delivery quantities with batch/lot and expiry date, enforce over-delivery protection (`409 over_delivery`), and post Goods Receipt documents atomically through `postDocument()`.
  5. **Department Requisitions & Internal Transfers (`Operations.tsx`, `requisitions`):** Create `department_issue` or `warehouse_transfer` requisitions, inspect requested vs live available stock in the source warehouse (`getBalance()`), and fulfill (posting an atomic `issue` or `transfer` document via `postDocument()`) or reject with confirmation dialogs.
  6. **Stock Issues & Consumption (`Operations.tsx`):** Direct department stock issues and consumption tracking.
  7. **Write-Offs, Returns & Adjustments (`Operations.tsx`, `postReturn`):** Dedicated Stock Returns (`from_department` returning unused stock into warehouse, or `to_supplier` returning damaged goods to supplier), signed adjustments, and write-offs with mandatory reasons and confirmation dialogs.
  8. **Physical Stocktakes & Reconciliation (`Operations.tsx`):** Draft count sheet creation, live expected-vs-counted variance inspection, executive approval/reconciliation (`POST /api/stock/count-sheets/:id/approve`), and draft cancellation (`POST /api/stock/count-sheets/:id/cancel`).
  9. **Low-Stock Alerts & Inventory Reports (`Reports.tsx`, `GET /api/reports/inventory`):** Low-stock reorder queue with shortfall & estimated restock cost + one-click **"Restock via PO"** prefill link, stock valuation by category and warehouse, department consumption report, movement summary by document type, and **Export Report CSV**.
  - **Verified:** Server tests **33/33 pass**; Web tests **4/4 pass**; production Vite build passes; `npm run verify-ledger` passes (`Ledger OK.`).

## Current Task
Stage 3 complete and web app running live on `http://localhost:5173` (proxying `/api` to `http://127.0.0.1:4000`). Waiting for user review and next stage instructions.

## Known Issues / Notes for Future Stages
- Executive Manager portal can be further expanded in the next stage if executive-specific multi-branch comparative analytics, approval thresholds, or audit-log exports are desired.
- `node:sqlite` is built-in on Node 24; SQL remains portable for PostgreSQL deployment.

## Next Step
Ready for your testing on `http://localhost:5173` and your instructions for the next stage.
