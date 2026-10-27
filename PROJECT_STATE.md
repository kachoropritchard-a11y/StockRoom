# PROJECT_STATE

## Architecture
- **Monorepo** (npm workspaces): `server/` (API) and `web/` (PWA frontend). Environment: Node 24, Python 3.12, Git 2.56 (`C:\Program Files\Git\cmd\git.exe`, added to User PATH and initialised in `.git`).
- **Backend:** Node 24 running TypeScript natively (type-stripping, no build step), Fastify, Zod validation, helmet, CORS allow-list, rate-limited login, CSRF header + Origin check.
- **Database:** SQLite via built-in `node:sqlite`, plain `.sql` migrations in `server/migrations` (`001_init.sql` .. `006_executive_governance.sql`), applied by `server/src/migrate.ts`.
- **Authoritative Stock Engine:** `server/src/inventory/engine.ts` is the sole writer to `stock_movements`. `stock_balances` is a SQL view (`SUM(base_delta_milli)` per organisation, product, and warehouse). No duplicate balance calculation logic exists anywhere in the codebase.
- **Auth, Governance & Security:** email/password (`bcryptjs`), opaque session tokens stored SHA-256 hashed in `sessions`, sent as `httpOnly SameSite=Lax` cookie (web) or `Bearer` token (mobile/desktop wrappers). Account lockout after 5 failed attempts, operator CLI password reset (`npm run reset-password`), self-service password reset, configurable **Separation of Duties** (`enforce_separation_of_duties`), **Executive PO Approval Threshold** (`po_approval_threshold_cents`), granular role permissions (`role_permissions`), append-only trigger-protected **Audit Logs** (`audit_logs`), and SHA-256 verified **System Backups & Controlled Restoration** (`system_backups`).
- **Frontend:** Vite, React, TypeScript, `react-router-dom`, Command-Center UI (`STOCKROOM OPERATIONS • LIVE`) with Light & Dark themes, Zimbabwe-inspired deep green (`#0b4f3a`), warm gold (`#c9962b`), teal (`#11a89d`), and indigo (`#4f52e8`) accents, WAI-ARIA `AccessibleTabs` with purpose banners and arrow-key navigation, `QuickTransferModal` (`Alt+T`), `ConfirmDialog` (`Esc` to close), live topbar **Notifications Drawer**, global keyboard shortcuts (`Alt+1..7`, `Alt+K` / `/`), PWA manifest + service worker + generated PNG icons.

## Run & Test
```
npm install
npm run migrate
npm run seed          # seeds demo org, users, Zimbabwean inventory, POs, and requisitions (idempotent)
npm run dev:server    # http://127.0.0.1:4000 (running in background)
npm run dev:web       # http://localhost:5173 (running in background)
npm test              # 35 server tests
npm test -w web       # 5 frontend routing, keyboard accessibility & portal tests
npm run verify-ledger # audits ledger invariants
```

## Completed Stages
- **Stage 1 & 1.1:** Project setup, config validation, SQLite migrations, login/logout, CSRF protection, account lockout, password change/reset, role-based portals (`/executive`, `/inventory`), PWA manifest/icons/SW.
- **Stage 2 & 2.1:** Core inventory schema (`003_inventory.sql`, `004_inventory_gaps.sql`) and ledger engine (`server/src/inventory/engine.ts`): organisations, branches, warehouses, departments, categories, units of measure, product packagings (unit conversions), suppliers, products, costing (`unit_cost_cents`), reorder levels (`reorder_level_milli`), batch/expiry tracking (`batch_number`, `expiry_date`), count sheets (`count_sheets`, `count_sheet_lines`), user management, and append-only `stock_movements` ledger with `Idempotency-Key` protection, `BEGIN IMMEDIATE` transactions, negative-stock prevention, and executive-only reversals.
- **Stage 3 (Inventory Manager Portal & Command-Center UI/Accessibility):**
  1. **Product & Category Management (`Products.tsx`):** Searchable, category-filtered, paginated product catalogue (`limit`/`offset`), inline product editor, packaging conversion builder, unit-of-measure creation, and category active/inactive toggles.
  2. **Warehouses & Departments (`Warehouses.tsx`):** Warehouse stock valuation and SKU summary with one-click stock filtering, department directory with live consumption analytics, and executive warehouse/department creation.
  3. **Supplier & Purchase-Order Management (`Procurement.tsx`, `005_procurement_requisitions_returns.sql`):** Supplier directory; Purchase Order creation, status filtering, approval, cancellation, and partial/full Goods Receipt with over-delivery protection (`409 over_delivery`).
  4. **Requisitions, Transfers, Issues, Returns, Write-Offs & Stocktakes (`Operations.tsx`):** Department requisitions and internal transfers (`requisitions`), direct stock issues, department/supplier stock returns (`postReturn`), signed adjustments, write-offs, and physical stocktakes (`count_sheets`).
  5. **Low-Stock Alerts & Inventory Reports (`Reports.tsx`):** Low-stock reorder queue with one-click **"Restock via PO"**, valuation by category and warehouse, department consumption report, movement summary, and authorised CSV/JSON exports.
- **Stage 4 (Executive Manager Portal & Governance — `006_executive_governance.sql`):**
  1. **100% Database-Backed Executive & Operational Dashboard (`Dashboard.tsx`, `GET /api/dashboard/summary`):** Real SQLite metrics for total stock units (`totalStockUnits`), total stock value (`totalStockValue`), posted receipts (`receiptsCount` / `receiptsUnits`), posted issues (`issuesCount` / `issuesUnits`), internal transfers (`transfersCount` / `transfersUnits`), low-stock alerts (`lowStockCount`), and pending approvals (`pendingApprovals`).
  2. **User, Role & Granular Permission Management (`Organisation.tsx`, `/api/users`, `/api/executive/permissions`):** Create users, assign roles (`executive_manager` / `inventory_manager`) and branch scopes, activate/deactivate accounts, unlock locked users, and toggle granular permissions (`can_approve_po`, `can_fulfill_requisitions`, `can_write_off_stock`, `can_export_reports`) enforced server-side (`hasPermission()`).
  3. **Organisation, Branch & Department Settings (`Organisation.tsx`, `/api/organisation`):** Edit organisation name, currency code, negative-stock policy, **Separation of Duties** toggle (`enforce_separation_of_duties` — blocks self-approval of POs, requisitions, and stocktake sheets with `403 separation_of_duties_violation`), and **Executive PO Approval Threshold** (`po_approval_threshold_cents` — requires `executive_manager` above threshold with `403 executive_approval_required`).
  4. **Approval Queues & Immutable Audit Logs (`/api/executive/approvals`, `/api/executive/audit-logs`):** Unified executive approval queue for draft POs, pending requisitions, and draft count sheets; append-only `audit_logs` table protected by `BEFORE UPDATE` and `BEFORE DELETE` SQLite triggers (`audit_logs_are_immutable`).
  5. **Notifications & System Health (`Shell.tsx`, `/api/notifications`, `/api/executive/system-health`):** Topbar `🔔 Alerts` drawer showing real-time database notifications (low stock, batches expiring within 30 days, pending approvals, locked accounts, backup status) and live system/ledger health diagnostics.
  6. **Backup History, SHA-256 Verification & Controlled Restoration (`/api/executive/backups`):** Create point-in-time JSON snapshots with SHA-256 checksums (`createSystemBackup`), verify snapshot integrity and ledger readiness (`verifySystemBackup`), and execute controlled restoration requiring explicit `CONFIRM-RESTORE` phrase (`restoreSystemBackup`).
  7. **Authorised Report Exports (`Reports.tsx`, `GET /api/reports/export`):** Permission-checked (`can_export_reports`) server-side CSV and JSON exports for `valuation`, `low_stock`, `movements`, and executive-only `audit_logs`, audited in `audit_logs`.
  - **Verified:** Server tests **35/35 pass**; Web tests **5/5 pass**; production Vite build passes; `npm run verify-ledger` passes (`Ledger OK.`).

## Current Task
Stage 4 complete. Both API server (`http://127.0.0.1:4000`) and Web app (`http://localhost:5173`) are running live.

## Known Issues / Notes for Future Stages
- `node:sqlite` is built-in on Node 24; SQL migrations remain portable for PostgreSQL deployment.

## Next Step
Ready for your review on `http://localhost:5173` and any next-stage or deployment instructions.
