/**
 * Stock engine: the ONLY code that writes to the stock ledger.
 *
 * Rules enforced here (and nowhere else):
 *  - every posting runs in one IMMEDIATE transaction (all lines post, or none do);
 *  - duplicate requests are detected by (organisation, idempotency key) + request hash;
 *  - stock cannot go negative unless the organisation explicitly allows it;
 *  - posted rows are never edited: corrections are reversal documents;
 *  - "balance" has a single definition: the `stock_balances` view over the ledger (see getBalance).
 */
import { createHash } from 'node:crypto';
import type { Db } from '../db.ts';
import type { AuthUser, Role } from '../app.ts';
import { AppError } from '../errors.ts';

export type DocType = 'receipt' | 'issue' | 'transfer' | 'adjustment' | 'count' | 'write_off' | 'reversal';
export type PostableType = Exclude<DocType, 'reversal'>;

/** Which roles may post which document types. Reversals are restricted to executives. */
export const DOC_PERMISSIONS: Record<DocType, Role[]> = {
  receipt: ['inventory_manager', 'executive_manager'],
  issue: ['inventory_manager', 'executive_manager'],
  transfer: ['inventory_manager', 'executive_manager'],
  count: ['inventory_manager', 'executive_manager'],
  write_off: ['inventory_manager', 'executive_manager'],
  adjustment: ['inventory_manager', 'executive_manager'],
  reversal: ['executive_manager'],
};

export type GranularPermission = 'can_approve_po' | 'can_fulfill_requisitions' | 'can_write_off_stock' | 'can_export_reports';

export const GRANULAR_PERMISSIONS: { key: GranularPermission; label: string; description: string }[] = [
  { key: 'can_approve_po', label: 'Approve Purchase Orders', description: 'Allow Inventory Managers to approve Purchase Orders below the executive threshold.' },
  { key: 'can_fulfill_requisitions', label: 'Fulfill Requisitions & Transfers', description: 'Allow Inventory Managers to fulfill pending department requisitions and internal transfers.' },
  { key: 'can_write_off_stock', label: 'Post Stock Write-Offs', description: 'Allow Inventory Managers to write off damaged or expired stock.' },
  { key: 'can_export_reports', label: 'Export Inventory Reports', description: 'Allow Inventory Managers to download CSV/JSON inventory reports.' },
];

export function hasPermission(db: Db, actor: AuthUser, permission: GranularPermission): boolean {
  if (actor.role === 'executive_manager') return true;
  const row = db
    .prepare('SELECT allowed FROM role_permissions WHERE organisation_id = ? AND role = ? AND permission = ?')
    .get(actor.organisationId, actor.role, permission) as { allowed: number } | undefined;
  return row ? row.allowed === 1 : true;
}

export function recordAudit(
  db: Db,
  actor: AuthUser,
  action: string,
  targetType: string,
  targetId?: string | number | null,
  details?: Record<string, unknown> | null,
): void {
  db.prepare(
    `INSERT INTO audit_logs (organisation_id, actor_id, actor_email, actor_role, action, target_type, target_id, details_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    actor.organisationId,
    actor.id,
    actor.email,
    actor.role,
    action,
    targetType,
    targetId !== undefined && targetId !== null ? String(targetId) : null,
    details ? JSON.stringify(details) : null,
  );
}

function getOrgGovernance(db: Db, orgId: number) {
  return db
    .prepare('SELECT enforce_separation_of_duties, po_approval_threshold_cents FROM organisations WHERE id = ?')
    .get(orgId) as { enforce_separation_of_duties: number; po_approval_threshold_cents: number };
}

export interface LineInput {
  productId: number;
  warehouseId: number; // source warehouse for transfers
  unitId: number;
  /** In milli-units of `unitId`. Positive for most types; signed non-zero for adjustments; counted quantity (>= 0) for counts. */
  quantityMilli: number;
  toWarehouseId?: number; // transfers only
  /** Optional unit cost in cents for the entered unit (on receipts). Defaults to the product's base unit cost. */
  unitCostCents?: number | null;
  /** Optional unit selling price in cents for the entered unit (on issues/sales). Defaults to the product's retail selling price. */
  unitSellingPriceCents?: number | null;
  /** Payment tender type for counter issues/sales (e.g. USD_CASH, ZIG_CASH, ZAR_CASH, ECOCASH_USD, INNBUCKS, ONEMONEY_ZIG, CREDIT). */
  tenderType?: string | null;
  batchNumber?: string | null;
  expiryDate?: string | null;
}

export interface PostInput {
  type: PostableType;
  lines: LineInput[];
  supplierId?: number | null;
  departmentId?: number | null;
  reference?: string | null;
  reason?: string | null;
  idempotencyKey: string;
}

export interface PostResult {
  documentId: number;
  replayed: boolean;
}

// ---------- quantity & currency helpers ----------

/** Converts a decimal quantity (max 3 decimal places) to integer milli-units. */
export function toMilli(n: number): number {
  const m = Math.round(n * 1000);
  if (Math.abs(n * 1000 - m) > 1e-6) throw new AppError(400, 'too_many_decimals');
  if (!Number.isSafeInteger(m)) throw new AppError(400, 'quantity_out_of_range');
  return m;
}
export const fromMilli = (m: number) => m / 1000;

/** Converts a decimal currency amount (max 2 decimal places) to integer cents. */
export function toCents(n: number): number {
  const c = Math.round(n * 100);
  if (Math.abs(n * 100 - c) > 1e-6) throw new AppError(400, 'invalid_currency_precision');
  if (!Number.isSafeInteger(c) || c < 0) throw new AppError(400, 'invalid_unit_cost');
  return c;
}
export const fromCents = (c: number) => c / 100;

/** entered quantity (milli) x factor (milli) -> base milli-units; must be exact. */
function toBase(quantityMilli: number, factorMilli: number): number {
  const product = quantityMilli * factorMilli;
  if (!Number.isSafeInteger(product) || product % 1000 !== 0) throw new AppError(400, 'quantity_not_representable');
  return product / 1000;
}

let txDepth = 0;
export function tx<T>(db: Db, fn: () => T): T {
  const outer = txDepth === 0;
  if (outer) db.exec('BEGIN IMMEDIATE');
  txDepth++;
  try {
    const result = fn();
    txDepth--;
    if (outer) db.exec('COMMIT');
    return result;
  } catch (err) {
    txDepth--;
    if (outer) db.exec('ROLLBACK');
    throw err;
  }
}

// ---------- the single definition of a balance ----------

export function getBalance(db: Db, organisationId: number, productId: number, warehouseId: number): number {
  const row = db
    .prepare('SELECT quantity_milli FROM stock_balances WHERE organisation_id = ? AND product_id = ? AND warehouse_id = ?')
    .get(organisationId, productId, warehouseId) as { quantity_milli: number } | undefined;
  return row?.quantity_milli ?? 0;
}

// ---------- lookups ----------

interface WarehouseRow { id: number; branch_id: number; active: number }

function loadWarehouse(db: Db, orgId: number, id: number): WarehouseRow {
  const w = db
    .prepare('SELECT w.id, w.branch_id, w.active FROM warehouses w JOIN branches b ON b.id = w.branch_id WHERE w.id = ? AND b.organisation_id = ?')
    .get(id, orgId) as WarehouseRow | undefined;
  if (!w) throw new AppError(400, 'warehouse_not_found', { warehouseId: id });
  if (!w.active) throw new AppError(400, 'warehouse_inactive', { warehouseId: id });
  return w;
}

/** Branch-scoped inventory managers may only post against their own branch's warehouses. */
export function canAccessWarehouse(actor: AuthUser, warehouseBranchId: number): boolean {
  return actor.role === 'executive_manager' || actor.branchId === null || actor.branchId === warehouseBranchId;
}

function loadProduct(db: Db, orgId: number, id: number) {
  const p = db
    .prepare('SELECT id, base_unit_id, unit_cost_cents, selling_price_cents, active FROM products WHERE id = ? AND organisation_id = ?')
    .get(id, orgId) as
    | { id: number; base_unit_id: number; unit_cost_cents: number; selling_price_cents: number; active: number }
    | undefined;
  if (!p) throw new AppError(400, 'product_not_found', { productId: id });
  if (!p.active) throw new AppError(400, 'product_inactive', { productId: id });
  return p;
}

/** Packaging/unit conversion: base unit = 1; otherwise the product's declared packaging factor. */
function resolveFactor(db: Db, product: { id: number; base_unit_id: number }, unitId: number): number {
  if (unitId === product.base_unit_id) return 1000;
  const row = db.prepare('SELECT factor_milli FROM product_packagings WHERE product_id = ? AND unit_id = ?').get(product.id, unitId) as
    | { factor_milli: number }
    | undefined;
  if (!row) throw new AppError(400, 'unit_not_defined_for_product', { productId: product.id, unitId });
  return row.factor_milli;
}

// ---------- posting ----------

interface Row {
  warehouseId: number;
  productId: number;
  unitId: number;
  quantityMilli: number;
  factorMilli: number;
  deltaMilli: number;
  unitCostCents: number;
  unitSellingPriceCents: number;
  tenderType: string;
  batchNumber: string | null;
  expiryDate: string | null;
}

const hashOf = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function findReplay(db: Db, orgId: number, key: string, hash: string): PostResult | null {
  const existing = db.prepare('SELECT id, request_hash FROM stock_documents WHERE organisation_id = ? AND idempotency_key = ?').get(orgId, key) as
    | { id: number; request_hash: string }
    | undefined;
  if (!existing) return null;
  if (existing.request_hash !== hash) throw new AppError(409, 'idempotency_key_reuse');
  return { documentId: existing.id, replayed: true };
}

const insertRow = (db: Db, documentId: number, orgId: number, r: Row) =>
  db
    .prepare(
      `INSERT INTO stock_movements (document_id, organisation_id, product_id, warehouse_id, unit_id, quantity_milli, factor_milli, base_delta_milli, unit_cost_cents, unit_selling_price_cents, tender_type, batch_number, expiry_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      documentId,
      orgId,
      r.productId,
      r.warehouseId,
      r.unitId,
      r.quantityMilli,
      r.factorMilli,
      r.deltaMilli,
      r.unitCostCents,
      r.unitSellingPriceCents,
      r.tenderType,
      r.batchNumber,
      r.expiryDate,
    );

/** After posting, no touched product/warehouse may be below zero (unless the organisation allows it). */
function assertNonNegative(db: Db, orgId: number, pairs: Iterable<string>) {
  const org = db.prepare('SELECT allow_negative_stock FROM organisations WHERE id = ?').get(orgId) as { allow_negative_stock: number };
  if (org.allow_negative_stock) return;
  for (const pair of pairs) {
    const [productId, warehouseId] = pair.split(':').map(Number);
    const balance = getBalance(db, orgId, productId, warehouseId);
    if (balance < 0) {
      // The transaction rolls back, so report what was available before this document.
      throw new AppError(409, 'insufficient_stock', { productId, warehouseId, shortfall: fromMilli(-balance) });
    }
  }
}

export function postDocument(db: Db, actor: AuthUser, input: PostInput): PostResult {
  const { type } = input;
  if (!DOC_PERMISSIONS[type].includes(actor.role)) throw new AppError(403, 'forbidden');
  if (type === 'write_off' && !hasPermission(db, actor, 'can_write_off_stock')) throw new AppError(403, 'forbidden_permission');
  if (input.lines.length === 0 || input.lines.length > 200) throw new AppError(400, 'invalid_line_count');
  const reason = input.reason?.trim() || null;
  if ((type === 'adjustment' || type === 'write_off') && !reason) throw new AppError(400, 'reason_required');
  if (input.supplierId && type !== 'receipt') throw new AppError(400, 'supplier_only_on_receipts');
  if (input.departmentId && type !== 'issue' && type !== 'write_off') throw new AppError(400, 'department_not_allowed');

  const orgId = actor.organisationId;
  const hash = hashOf([
    type,
    input.lines.map((l) => [l.productId, l.warehouseId, l.toWarehouseId ?? null, l.unitId, l.quantityMilli, l.unitCostCents ?? null, l.batchNumber ?? null, l.expiryDate ?? null]),
    input.supplierId ?? null,
    input.departmentId ?? null,
    input.reference ?? null,
    reason,
  ]);

  return tx(db, () => {
    const replay = findReplay(db, orgId, input.idempotencyKey, hash);
    if (replay) return replay;

    if (input.supplierId) {
      const s = db.prepare('SELECT active FROM suppliers WHERE id = ? AND organisation_id = ?').get(input.supplierId, orgId) as { active: number } | undefined;
      if (!s) throw new AppError(400, 'supplier_not_found');
      if (!s.active) throw new AppError(400, 'supplier_inactive');
    }
    const department = input.departmentId
      ? (db
          .prepare('SELECT d.branch_id, d.active FROM departments d JOIN branches b ON b.id = d.branch_id WHERE d.id = ? AND b.organisation_id = ?')
          .get(input.departmentId, orgId) as { branch_id: number; active: number } | undefined)
      : undefined;
    if (input.departmentId && !department) throw new AppError(400, 'department_not_found');
    if (department && !department.active) throw new AppError(400, 'department_inactive');

    const rows: Row[] = [];
    const seenCounts = new Set<string>();

    for (const line of input.lines) {
      const product = loadProduct(db, orgId, line.productId);
      const factor = resolveFactor(db, product, line.unitId);
      const from = loadWarehouse(db, orgId, line.warehouseId);
      if (!canAccessWarehouse(actor, from.branch_id)) throw new AppError(403, 'forbidden_warehouse', { warehouseId: line.warehouseId });
      if (department && department.branch_id !== from.branch_id) throw new AppError(400, 'department_branch_mismatch');
      const q = line.quantityMilli;
      const base = (n: number) => toBase(Math.abs(n), factor);
      const batchNumber = line.batchNumber?.trim() || null;
      const expiryDate = line.expiryDate?.trim() || null;
      if (expiryDate && !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) throw new AppError(400, 'invalid_expiry_date');

      // Cost per base unit in cents. On receipts, if unitCostCents (for entered unit) is supplied, convert to base-unit cost and update product cost.
      let baseUnitCostCents = product.unit_cost_cents;
      if (line.unitCostCents !== undefined && line.unitCostCents !== null) {
        if (line.unitCostCents < 0) throw new AppError(400, 'invalid_unit_cost');
        baseUnitCostCents = Math.round((line.unitCostCents * 1000) / factor);
        if (type === 'receipt') {
          db.prepare('UPDATE products SET unit_cost_cents = ? WHERE id = ?').run(baseUnitCostCents, product.id);
        }
      }

      // Selling price per base unit in cents (for issues/sales). Defaults to product's retail selling price, or 130% of cost if unset.
      const defaultSellCents = product.selling_price_cents > 0 ? product.selling_price_cents : Math.round(baseUnitCostCents * 1.3);
      let baseSellingPriceCents = type === 'issue' ? defaultSellCents : 0;
      if (line.unitSellingPriceCents !== undefined && line.unitSellingPriceCents !== null) {
        if (line.unitSellingPriceCents < 0) throw new AppError(400, 'invalid_unit_cost');
        baseSellingPriceCents = Math.round((line.unitSellingPriceCents * 1000) / factor);
      }
      const tenderType = line.tenderType?.trim() || 'USD_CASH';

      const row = (warehouseId: number, deltaMilli: number): Row => ({
        warehouseId,
        productId: line.productId,
        unitId: line.unitId,
        quantityMilli: Math.abs(q),
        factorMilli: factor,
        deltaMilli,
        unitCostCents: baseUnitCostCents,
        unitSellingPriceCents: baseSellingPriceCents,
        tenderType,
        batchNumber,
        expiryDate,
      });

      switch (type) {
        case 'receipt':
          if (q <= 0) throw new AppError(400, 'quantity_must_be_positive');
          rows.push(row(line.warehouseId, base(q)));
          break;
        case 'issue':
        case 'write_off':
          if (q <= 0) throw new AppError(400, 'quantity_must_be_positive');
          rows.push(row(line.warehouseId, -base(q)));
          break;
        case 'adjustment':
          if (q === 0) throw new AppError(400, 'quantity_must_be_nonzero');
          rows.push(row(line.warehouseId, q > 0 ? base(q) : -base(q)));
          break;
        case 'transfer': {
          if (q <= 0) throw new AppError(400, 'quantity_must_be_positive');
          if (!line.toWarehouseId || line.toWarehouseId === line.warehouseId) throw new AppError(400, 'invalid_destination');
          loadWarehouse(db, orgId, line.toWarehouseId);
          rows.push(row(line.warehouseId, -base(q)), row(line.toWarehouseId, base(q)));
          break;
        }
        case 'count': {
          if (q < 0) throw new AppError(400, 'quantity_must_not_be_negative');
          const key = `${line.productId}:${line.warehouseId}`;
          if (seenCounts.has(key)) throw new AppError(400, 'duplicate_count_line');
          seenCounts.add(key);
          // The recorded movement is the variance between the counted quantity and the ledger balance.
          rows.push({ ...row(line.warehouseId, 0), deltaMilli: base(q) - getBalance(db, orgId, line.productId, line.warehouseId) });
          break;
        }
      }
    }

    const doc = db
      .prepare(
        `INSERT INTO stock_documents (organisation_id, type, reference, reason, supplier_id, department_id, idempotency_key, request_hash, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(orgId, type, input.reference?.trim() || null, reason, input.supplierId ?? null, input.departmentId ?? null, input.idempotencyKey, hash, actor.id);
    const documentId = Number(doc.lastInsertRowid);
    for (const r of rows) insertRow(db, documentId, orgId, r);
    assertNonNegative(db, orgId, new Set(rows.filter((r) => r.deltaMilli < 0).map((r) => `${r.productId}:${r.warehouseId}`)));
    if (type === 'adjustment' || type === 'write_off' || type === 'count') {
      recordAudit(db, actor, `document.${type}`, 'stock_document', documentId, {
        reference: input.reference?.trim() || null,
        reason,
        lineCount: rows.length,
      });
    }
    return { documentId, replayed: false };
  });
}

/** Corrects a posted document by posting its exact opposite as a new, linked reversal document. */
export function reverseDocument(db: Db, actor: AuthUser, originalId: number, reasonText: string, idempotencyKey: string): PostResult {
  if (!DOC_PERMISSIONS.reversal.includes(actor.role)) throw new AppError(403, 'forbidden');
  const reason = reasonText.trim();
  if (!reason) throw new AppError(400, 'reason_required');
  const orgId = actor.organisationId;
  const hash = hashOf(['reversal', originalId, reason]);

  return tx(db, () => {
    const replay = findReplay(db, orgId, idempotencyKey, hash);
    if (replay) return replay;
    const original = db.prepare('SELECT id, type FROM stock_documents WHERE id = ? AND organisation_id = ?').get(originalId, orgId) as { id: number; type: DocType } | undefined;
    if (!original) throw new AppError(404, 'document_not_found');
    if (original.type === 'reversal') throw new AppError(409, 'cannot_reverse_a_reversal');
    if (db.prepare('SELECT 1 FROM stock_documents WHERE reverses_document_id = ?').get(originalId)) throw new AppError(409, 'already_reversed');

    const doc = db
      .prepare(
        `INSERT INTO stock_documents (organisation_id, type, reason, reverses_document_id, idempotency_key, request_hash, created_by)
         VALUES (?, 'reversal', ?, ?, ?, ?, ?)`,
      )
      .run(orgId, reason, originalId, idempotencyKey, hash, actor.id);
    const documentId = Number(doc.lastInsertRowid);
    db.prepare(
      `INSERT INTO stock_movements (document_id, organisation_id, product_id, warehouse_id, unit_id, quantity_milli, factor_milli, base_delta_milli, unit_cost_cents, unit_selling_price_cents, tender_type, batch_number, expiry_date)
       SELECT ?, organisation_id, product_id, warehouse_id, unit_id, quantity_milli, factor_milli, -base_delta_milli, unit_cost_cents, unit_selling_price_cents, tender_type, batch_number, expiry_date
         FROM stock_movements WHERE document_id = ?`,
    ).run(documentId, originalId);
    const touched = db.prepare('SELECT DISTINCT product_id, warehouse_id FROM stock_movements WHERE document_id = ?').all(documentId) as { product_id: number; warehouse_id: number }[];
    assertNonNegative(db, orgId, touched.map((t) => `${t.product_id}:${t.warehouse_id}`));
    recordAudit(db, actor, 'document.reverse', 'stock_document', originalId, { reversalDocumentId: documentId, reason });
    return { documentId, replayed: false };
  });
}

// ---------- count-sheet approval workflow ----------

export interface CountSheetInput {
  warehouseId: number;
  reference?: string | null;
  notes?: string | null;
  lines: { productId: number; unitId: number; countedQuantity: number }[];
}

export function createCountSheet(db: Db, actor: AuthUser, input: CountSheetInput): number {
  const orgId = actor.organisationId;
  return tx(db, () => {
    const wh = loadWarehouse(db, orgId, input.warehouseId);
    if (!canAccessWarehouse(actor, wh.branch_id)) throw new AppError(403, 'forbidden_warehouse');
    const seen = new Set<number>();
    const sheetRes = db
      .prepare('INSERT INTO count_sheets (organisation_id, warehouse_id, reference, notes, created_by) VALUES (?, ?, ?, ?, ?)')
      .run(orgId, input.warehouseId, input.reference?.trim() || null, input.notes?.trim() || null, actor.id);
    const sheetId = Number(sheetRes.lastInsertRowid);
    const insertLine = db.prepare('INSERT INTO count_sheet_lines (count_sheet_id, product_id, unit_id, counted_milli) VALUES (?, ?, ?, ?)');
    for (const l of input.lines) {
      if (seen.has(l.productId)) throw new AppError(400, 'duplicate_count_line');
      seen.add(l.productId);
      const product = loadProduct(db, orgId, l.productId);
      resolveFactor(db, product, l.unitId);
      const countedMilli = toMilli(l.countedQuantity);
      if (countedMilli < 0) throw new AppError(400, 'quantity_must_not_be_negative');
      insertLine.run(sheetId, l.productId, l.unitId, countedMilli);
    }
    return sheetId;
  });
}

export function getCountSheet(db: Db, orgId: number, sheetId: number) {
  const sheet = db
    .prepare(
      `SELECT cs.id, cs.warehouse_id AS warehouseId, w.name AS warehouseName, cs.reference, cs.notes, cs.status,
              cs.posted_document_id AS postedDocumentId, cs.created_by AS createdBy, cs.approved_by AS approvedBy,
              cs.decided_by AS decidedBy, cs.decision_reason AS decisionReason,
              cs.created_at AS createdAt, cs.approved_at AS approvedAt, cs.decided_at AS decidedAt
         FROM count_sheets cs JOIN warehouses w ON w.id = cs.warehouse_id
        WHERE cs.id = ? AND cs.organisation_id = ?`,
    )
    .get(sheetId, orgId) as
    | {
        id: number;
        warehouseId: number;
        warehouseName: string;
        reference: string | null;
        notes: string | null;
        status: string;
        postedDocumentId: number | null;
        createdBy: number;
        approvedBy: number | null;
        decidedBy: number | null;
        decisionReason: string | null;
        createdAt: string;
        approvedAt: string | null;
        decidedAt: string | null;
      }
    | undefined;
  if (!sheet) return null;
  const rawLines = db
    .prepare(
      `SELECT l.id, l.product_id AS productId, p.sku, p.name AS productName, p.base_unit_id AS baseUnitId,
              l.unit_id AS unitId, u.code AS unit, l.counted_milli
         FROM count_sheet_lines l JOIN products p ON p.id = l.product_id JOIN units_of_measure u ON u.id = l.unit_id
        WHERE l.count_sheet_id = ? ORDER BY p.name`,
    )
    .all(sheetId) as { id: number; productId: number; sku: string; productName: string; baseUnitId: number; unitId: number; unit: string; counted_milli: number }[];
  const lines = rawLines.map((l) => {
    const factorMilli = resolveFactor(db, { id: l.productId, base_unit_id: l.baseUnitId }, l.unitId);
    const countedBaseMilli = toBase(l.counted_milli, factorMilli);
    const currentBaseMilli = getBalance(db, orgId, l.productId, sheet.warehouseId);
    return {
      id: l.id,
      productId: l.productId,
      sku: l.sku,
      productName: l.productName,
      unitId: l.unitId,
      unit: l.unit,
      countedQuantity: fromMilli(l.counted_milli),
      countedBaseQuantity: fromMilli(countedBaseMilli),
      expectedBaseQuantity: fromMilli(currentBaseMilli),
      varianceBaseQuantity: fromMilli(countedBaseMilli - currentBaseMilli),
    };
  });
  return { ...sheet, lines };
}

/** Approves a draft count sheet by posting an authoritative 'count' document via postDocument. */
export function approveCountSheet(db: Db, actor: AuthUser, sheetId: number, idempotencyKey: string, reason?: string | null): PostResult {
  if (actor.role !== 'executive_manager') throw new AppError(403, 'forbidden');
  const orgId = actor.organisationId;
  const decisionReason = reason?.trim() || 'Approved stocktake reconciliation';
  return tx(db, () => {
    const sheet = db
      .prepare('SELECT id, warehouse_id, reference, status, posted_document_id, created_by FROM count_sheets WHERE id = ? AND organisation_id = ?')
      .get(sheetId, orgId) as { id: number; warehouse_id: number; reference: string | null; status: string; posted_document_id: number | null; created_by: number } | undefined;
    if (!sheet) throw new AppError(404, 'count_sheet_not_found');
    if (sheet.status === 'approved' && sheet.posted_document_id) {
      return { documentId: sheet.posted_document_id, replayed: true };
    }
    if (sheet.status !== 'draft') throw new AppError(409, 'count_sheet_not_draft');
    const gov = getOrgGovernance(db, orgId);
    if (gov.enforce_separation_of_duties && sheet.created_by === actor.id) {
      throw new AppError(403, 'separation_of_duties_violation');
    }
    const lines = db
      .prepare('SELECT product_id, unit_id, counted_milli FROM count_sheet_lines WHERE count_sheet_id = ? ORDER BY id')
      .all(sheetId) as { product_id: number; unit_id: number; counted_milli: number }[];
    const posted = postDocument(db, actor, {
      type: 'count',
      reference: sheet.reference ?? `CS-${sheet.id}`,
      reason: decisionReason,
      idempotencyKey,
      lines: lines.map((l) => ({
        productId: l.product_id,
        warehouseId: sheet.warehouse_id,
        unitId: l.unit_id,
        quantityMilli: l.counted_milli,
      })),
    });
    db.prepare(
      "UPDATE count_sheets SET status = 'approved', posted_document_id = ?, approved_by = ?, approved_at = datetime('now'), decided_by = ?, decided_at = datetime('now'), decision_reason = ? WHERE id = ?",
    ).run(posted.documentId, actor.id, actor.id, decisionReason, sheetId);
    recordAudit(db, actor, 'count_sheet.approve', 'count_sheet', sheetId, {
      decision: 'approved',
      reason: decisionReason,
      documentId: posted.documentId,
    });
    return posted;
  });
}

export function cancelCountSheet(db: Db, actor: AuthUser, sheetId: number, reason?: string | null): void {
  const orgId = actor.organisationId;
  const decisionReason = reason?.trim() || 'Cancelled draft count sheet';
  const sheet = db.prepare('SELECT id, warehouse_id, status FROM count_sheets WHERE id = ? AND organisation_id = ?').get(sheetId, orgId) as
    | { id: number; warehouse_id: number; status: string }
    | undefined;
  if (!sheet) throw new AppError(404, 'count_sheet_not_found');
  const wh = loadWarehouse(db, orgId, sheet.warehouse_id);
  if (!canAccessWarehouse(actor, wh.branch_id)) throw new AppError(403, 'forbidden_warehouse');
  if (sheet.status !== 'draft') throw new AppError(409, 'count_sheet_not_draft');
  db.prepare(
    "UPDATE count_sheets SET status = 'cancelled', decided_by = ?, decided_at = datetime('now'), decision_reason = ? WHERE id = ?",
  ).run(actor.id, decisionReason, sheetId);
  recordAudit(db, actor, 'count_sheet.cancel', 'count_sheet', sheetId, { decision: 'cancelled', reason: decisionReason });
}

// ---------- purchase orders & partial deliveries ----------

export interface PurchaseOrderInput {
  supplierId: number;
  warehouseId: number;
  reference: string;
  notes?: string | null;
   approveImmediately?: boolean;
  lines: { productId: number; unitId: number; orderedQuantity: number; unitCost: number }[];
}

export function createPurchaseOrder(db: Db, actor: AuthUser, input: PurchaseOrderInput): number {
  const orgId = actor.organisationId;
  return tx(db, () => {
    const sup = db.prepare('SELECT active FROM suppliers WHERE id = ? AND organisation_id = ?').get(input.supplierId, orgId) as { active: number } | undefined;
    if (!sup) throw new AppError(400, 'supplier_not_found');
    if (!sup.active) throw new AppError(400, 'supplier_inactive');
    const wh = loadWarehouse(db, orgId, input.warehouseId);
    if (!canAccessWarehouse(actor, wh.branch_id)) throw new AppError(403, 'forbidden_warehouse');

    const gov = getOrgGovernance(db, orgId);
    if (input.approveImmediately) {
      if (!hasPermission(db, actor, 'can_approve_po')) throw new AppError(403, 'forbidden_permission');
      if (gov.enforce_separation_of_duties) throw new AppError(403, 'separation_of_duties_violation');
    }

    let totalCents = 0;
    const seen = new Set<number>();
    const preparedLines: { productId: number; unitId: number; orderedMilli: number; unitCostCents: number }[] = [];
    for (const l of input.lines) {
      if (seen.has(l.productId)) throw new AppError(400, 'duplicate_po_line');
      seen.add(l.productId);
      const product = loadProduct(db, orgId, l.productId);
      resolveFactor(db, product, l.unitId);
      const orderedMilli = toMilli(l.orderedQuantity);
      if (orderedMilli <= 0) throw new AppError(400, 'quantity_must_be_positive');
      const unitCostCents = toCents(l.unitCost);
      totalCents += Math.round((orderedMilli / 1000) * unitCostCents);
      preparedLines.push({ productId: l.productId, unitId: l.unitId, orderedMilli, unitCostCents });
    }

    if (input.approveImmediately && gov.po_approval_threshold_cents > 0 && totalCents > gov.po_approval_threshold_cents && actor.role !== 'executive_manager') {
      throw new AppError(403, 'executive_approval_required');
    }

    const status = input.approveImmediately ? 'approved' : 'draft';
    const poRes = db
      .prepare(
        `INSERT INTO purchase_orders (organisation_id, supplier_id, warehouse_id, reference, notes, status, created_by, approved_by, approved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'approved' THEN datetime('now') ELSE NULL END)`,
      )
      .run(orgId, input.supplierId, input.warehouseId, input.reference.trim(), input.notes?.trim() || null, status, actor.id, input.approveImmediately ? actor.id : null, status);
    const poId = Number(poRes.lastInsertRowid);
    const insertLine = db.prepare(
      'INSERT INTO purchase_order_lines (purchase_order_id, product_id, unit_id, ordered_milli, unit_cost_cents) VALUES (?, ?, ?, ?, ?)',
    );
    for (const l of preparedLines) {
      insertLine.run(poId, l.productId, l.unitId, l.orderedMilli, l.unitCostCents);
    }
    recordAudit(db, actor, 'po.create', 'purchase_order', poId, { reference: input.reference.trim(), status, totalCents });
    return poId;
  });
}

export function approvePurchaseOrder(db: Db, actor: AuthUser, poId: number, reason?: string | null): void {
  const orgId = actor.organisationId;
  if (!hasPermission(db, actor, 'can_approve_po')) throw new AppError(403, 'forbidden_permission');
  const decisionReason = reason?.trim() || 'Approved purchase order';
  const po = db.prepare('SELECT id, warehouse_id, reference, status, created_by FROM purchase_orders WHERE id = ? AND organisation_id = ?').get(poId, orgId) as
    | { id: number; warehouse_id: number; reference: string; status: string; created_by: number }
    | undefined;
  if (!po) throw new AppError(404, 'po_not_found');
  const wh = loadWarehouse(db, orgId, po.warehouse_id);
  if (!canAccessWarehouse(actor, wh.branch_id)) throw new AppError(403, 'forbidden_warehouse');
  if (po.status === 'approved') return;
  if (po.status !== 'draft') throw new AppError(409, 'po_not_draft');

  const gov = getOrgGovernance(db, orgId);
  if (gov.enforce_separation_of_duties && po.created_by === actor.id) {
    throw new AppError(403, 'separation_of_duties_violation');
  }
  const totalRow = db
    .prepare('SELECT COALESCE(SUM((ordered_milli / 1000.0) * unit_cost_cents), 0) AS total_cents FROM purchase_order_lines WHERE purchase_order_id = ?')
    .get(poId) as { total_cents: number };
  if (gov.po_approval_threshold_cents > 0 && totalRow.total_cents > gov.po_approval_threshold_cents && actor.role !== 'executive_manager') {
    throw new AppError(403, 'executive_approval_required');
  }

  db.prepare(
    "UPDATE purchase_orders SET status = 'approved', approved_by = ?, approved_at = datetime('now'), decided_by = ?, decided_at = datetime('now'), decision_reason = ? WHERE id = ?",
  ).run(actor.id, actor.id, decisionReason, poId);
  recordAudit(db, actor, 'po.approve', 'purchase_order', poId, { decision: 'approved', reason: decisionReason, reference: po.reference });
}

export function cancelPurchaseOrder(db: Db, actor: AuthUser, poId: number, reason?: string | null): void {
  const orgId = actor.organisationId;
  const decisionReason = reason?.trim() || 'Cancelled purchase order';
  const po = db.prepare('SELECT id, warehouse_id, reference, status FROM purchase_orders WHERE id = ? AND organisation_id = ?').get(poId, orgId) as
    | { id: number; warehouse_id: number; reference: string; status: string }
    | undefined;
  if (!po) throw new AppError(404, 'po_not_found');
  const wh = loadWarehouse(db, orgId, po.warehouse_id);
  if (!canAccessWarehouse(actor, wh.branch_id)) throw new AppError(403, 'forbidden_warehouse');
  if (po.status !== 'draft' && po.status !== 'approved') throw new AppError(409, 'po_cannot_be_cancelled');
  db.prepare(
    "UPDATE purchase_orders SET status = 'cancelled', decided_by = ?, decided_at = datetime('now'), decision_reason = ? WHERE id = ?",
  ).run(actor.id, decisionReason, poId);
  recordAudit(db, actor, 'po.cancel', 'purchase_order', poId, { decision: 'cancelled', reason: decisionReason, reference: po.reference });
}

export interface ReceivePurchaseOrderInput {
  reference?: string | null;
  idempotencyKey: string;
  lines: { productId: number; quantity: number; unitCost?: number | null; batchNumber?: string | null; expiryDate?: string | null }[];
}

export function receivePurchaseOrder(db: Db, actor: AuthUser, poId: number, input: ReceivePurchaseOrderInput): PostResult {
  const orgId = actor.organisationId;
  return tx(db, () => {
    const po = db
      .prepare('SELECT id, supplier_id, warehouse_id, reference, status FROM purchase_orders WHERE id = ? AND organisation_id = ?')
      .get(poId, orgId) as { id: number; supplier_id: number; warehouse_id: number; reference: string; status: string } | undefined;
    if (!po) throw new AppError(404, 'po_not_found');

    // Check if this exact idempotency key was already recorded for this PO
    const existingDoc = db
      .prepare(
        `SELECT r.document_id FROM purchase_order_receipts r JOIN stock_documents d ON d.id = r.document_id
          WHERE r.purchase_order_id = ? AND d.organisation_id = ? AND d.idempotency_key = ?`,
      )
      .get(poId, orgId, input.idempotencyKey) as { document_id: number } | undefined;
    if (existingDoc) return { documentId: existingDoc.document_id, replayed: true };

    if (po.status !== 'approved' && po.status !== 'partial') {
      throw new AppError(409, 'po_not_receivable', { status: po.status });
    }

    const poLines = db
      .prepare('SELECT id, product_id, unit_id, ordered_milli, received_milli, unit_cost_cents FROM purchase_order_lines WHERE purchase_order_id = ?')
      .all(poId) as { id: number; product_id: number; unit_id: number; ordered_milli: number; received_milli: number; unit_cost_cents: number }[];
    const byProduct = new Map(poLines.map((l) => [l.product_id, l]));

    const postLines: LineInput[] = [];
    const updates: { lineId: number; addMilli: number }[] = [];
    const seen = new Set<number>();

    for (const l of input.lines) {
      if (seen.has(l.productId)) throw new AppError(400, 'duplicate_po_line');
      seen.add(l.productId);
      const poLine = byProduct.get(l.productId);
      if (!poLine) throw new AppError(400, 'product_not_on_po', { productId: l.productId });
      const deliveryMilli = toMilli(l.quantity);
      if (deliveryMilli <= 0) throw new AppError(400, 'quantity_must_be_positive');
      const remainingMilli = poLine.ordered_milli - poLine.received_milli;
      if (deliveryMilli > remainingMilli) {
        throw new AppError(409, 'over_delivery', {
          productId: l.productId,
          remaining: fromMilli(remainingMilli),
          attempted: l.quantity,
        });
      }
      const unitCostCents = l.unitCost !== undefined && l.unitCost !== null ? toCents(l.unitCost) : poLine.unit_cost_cents;
      postLines.push({
        productId: l.productId,
        warehouseId: po.warehouse_id,
        unitId: poLine.unit_id,
        quantityMilli: deliveryMilli,
        unitCostCents,
        batchNumber: l.batchNumber ?? null,
        expiryDate: l.expiryDate ?? null,
      });
      updates.push({ lineId: poLine.id, addMilli: deliveryMilli });
    }

    const posted = postDocument(db, actor, {
      type: 'receipt',
      supplierId: po.supplier_id,
      reference: input.reference?.trim() || `${po.reference}-RCV`,
      idempotencyKey: input.idempotencyKey,
      lines: postLines,
    });

    const updStmt = db.prepare('UPDATE purchase_order_lines SET received_milli = received_milli + ? WHERE id = ?');
    for (const u of updates) updStmt.run(u.addMilli, u.lineId);

    db.prepare('INSERT INTO purchase_order_receipts (purchase_order_id, document_id) VALUES (?, ?)').run(poId, posted.documentId);

    const pending = db
      .prepare('SELECT 1 FROM purchase_order_lines WHERE purchase_order_id = ? AND received_milli < ordered_milli')
      .get(poId);
    db.prepare('UPDATE purchase_orders SET status = ? WHERE id = ?').run(pending ? 'partial' : 'received', poId);

    return posted;
  });
}

export function getPurchaseOrder(db: Db, orgId: number, poId: number) {
  const po = db
    .prepare(
      `SELECT po.id, po.supplier_id AS supplierId, s.name AS supplierName,
              po.warehouse_id AS warehouseId, w.name AS warehouseName,
              po.reference, po.notes, po.status, po.created_by AS createdBy,
              po.approved_by AS approvedBy, po.decided_by AS decidedBy,
              po.decision_reason AS decisionReason,
              po.created_at AS createdAt, po.approved_at AS approvedAt, po.decided_at AS decidedAt
         FROM purchase_orders po
         JOIN suppliers s ON s.id = po.supplier_id
         JOIN warehouses w ON w.id = po.warehouse_id
        WHERE po.id = ? AND po.organisation_id = ?`,
    )
    .get(poId, orgId) as
    | {
        id: number;
        supplierId: number;
        supplierName: string;
        warehouseId: number;
        warehouseName: string;
        reference: string;
        notes: string | null;
        status: string;
        createdBy: number;
        approvedBy: number | null;
        decidedBy: number | null;
        decisionReason: string | null;
        createdAt: string;
        approvedAt: string | null;
        decidedAt: string | null;
      }
    | undefined;
  if (!po) return null;

  const lines = (db
    .prepare(
      `SELECT l.id, l.product_id AS productId, p.sku, p.name AS productName,
              l.unit_id AS unitId, u.code AS unit, l.ordered_milli, l.received_milli, l.unit_cost_cents
         FROM purchase_order_lines l
         JOIN products p ON p.id = l.product_id
         JOIN units_of_measure u ON u.id = l.unit_id
        WHERE l.purchase_order_id = ? ORDER BY l.id`,
    )
    .all(poId) as {
    id: number;
    productId: number;
    sku: string;
    productName: string;
    unitId: number;
    unit: string;
    ordered_milli: number;
    received_milli: number;
    unit_cost_cents: number;
  }[]).map((l) => {
    const orderedQuantity = fromMilli(l.ordered_milli);
    const receivedQuantity = fromMilli(l.received_milli);
    const remainingQuantity = fromMilli(l.ordered_milli - l.received_milli);
    const unitCost = fromCents(l.unit_cost_cents);
    return {
      id: l.id,
      productId: l.productId,
      sku: l.sku,
      productName: l.productName,
      unitId: l.unitId,
      unit: l.unit,
      orderedQuantity,
      receivedQuantity,
      remainingQuantity,
      unitCost,
      lineTotal: Math.round(orderedQuantity * unitCost * 100) / 100,
    };
  });

  const receipts = db
    .prepare(
      `SELECT r.document_id AS documentId, d.reference, r.created_at AS createdAt
         FROM purchase_order_receipts r JOIN stock_documents d ON d.id = r.document_id
        WHERE r.purchase_order_id = ? ORDER BY r.id DESC`,
    )
    .all(poId);

  const totalValue = Math.round(lines.reduce((acc, l) => acc + l.lineTotal, 0) * 100) / 100;
  return { ...po, totalValue, lines, receipts };
}

// ---------- department requisitions & internal transfer requests ----------

export interface RequisitionInput {
  kind: 'department_issue' | 'warehouse_transfer';
  warehouseId: number;
  departmentId?: number | null;
  toWarehouseId?: number | null;
  reference?: string | null;
  notes?: string | null;
  lines: { productId: number; unitId: number; requestedQuantity: number }[];
}

export function createRequisition(db: Db, actor: AuthUser, input: RequisitionInput): number {
  const orgId = actor.organisationId;
  return tx(db, () => {
    const fromWh = loadWarehouse(db, orgId, input.warehouseId);
    if (!canAccessWarehouse(actor, fromWh.branch_id)) throw new AppError(403, 'forbidden_warehouse');

    if (input.kind === 'department_issue') {
      if (!input.departmentId || input.toWarehouseId) throw new AppError(400, 'invalid_requisition_target');
      const dept = db
        .prepare('SELECT d.branch_id, d.active FROM departments d JOIN branches b ON b.id = d.branch_id WHERE d.id = ? AND b.organisation_id = ?')
        .get(input.departmentId, orgId) as { branch_id: number; active: number } | undefined;
      if (!dept) throw new AppError(400, 'department_not_found');
      if (!dept.active) throw new AppError(400, 'department_inactive');
      if (dept.branch_id !== fromWh.branch_id) throw new AppError(400, 'department_branch_mismatch');
    } else {
      if (!input.toWarehouseId || input.departmentId || input.toWarehouseId === input.warehouseId) {
        throw new AppError(400, 'invalid_requisition_target');
      }
      loadWarehouse(db, orgId, input.toWarehouseId);
    }

    const reqRes = db
      .prepare(
        `INSERT INTO requisitions (organisation_id, kind, warehouse_id, department_id, to_warehouse_id, reference, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        orgId,
        input.kind,
        input.warehouseId,
        input.kind === 'department_issue' ? input.departmentId! : null,
        input.kind === 'warehouse_transfer' ? input.toWarehouseId! : null,
        input.reference?.trim() || null,
        input.notes?.trim() || null,
        actor.id,
      );
    const reqId = Number(reqRes.lastInsertRowid);
    const seen = new Set<number>();
    const insertLine = db.prepare('INSERT INTO requisition_lines (requisition_id, product_id, unit_id, requested_milli) VALUES (?, ?, ?, ?)');
    for (const l of input.lines) {
      if (seen.has(l.productId)) throw new AppError(400, 'duplicate_requisition_line');
      seen.add(l.productId);
      const product = loadProduct(db, orgId, l.productId);
      resolveFactor(db, product, l.unitId);
      const requestedMilli = toMilli(l.requestedQuantity);
      if (requestedMilli <= 0) throw new AppError(400, 'quantity_must_be_positive');
      insertLine.run(reqId, l.productId, l.unitId, requestedMilli);
    }
    return reqId;
  });
}

export function fulfillRequisition(db: Db, actor: AuthUser, reqId: number, idempotencyKey: string, reason?: string | null): PostResult {
  const orgId = actor.organisationId;
  if (!hasPermission(db, actor, 'can_fulfill_requisitions')) throw new AppError(403, 'forbidden_permission');
  const decisionReason = reason?.trim() || 'Fulfilled requisition';
  return tx(db, () => {
    const req = db
      .prepare(
        'SELECT id, kind, warehouse_id, department_id, to_warehouse_id, reference, status, posted_document_id, created_by FROM requisitions WHERE id = ? AND organisation_id = ?',
      )
      .get(reqId, orgId) as
      | {
          id: number;
          kind: 'department_issue' | 'warehouse_transfer';
          warehouse_id: number;
          department_id: number | null;
          to_warehouse_id: number | null;
          reference: string | null;
          status: string;
          posted_document_id: number | null;
          created_by: number;
        }
      | undefined;
    if (!req) throw new AppError(404, 'requisition_not_found');
    if (req.status === 'fulfilled' && req.posted_document_id) {
      return { documentId: req.posted_document_id, replayed: true };
    }
    if (req.status !== 'pending') throw new AppError(409, 'requisition_not_pending');
    const gov = getOrgGovernance(db, orgId);
    if (gov.enforce_separation_of_duties && req.created_by === actor.id) {
      throw new AppError(403, 'separation_of_duties_violation');
    }

    const lines = db
      .prepare('SELECT product_id, unit_id, requested_milli FROM requisition_lines WHERE requisition_id = ? ORDER BY id')
      .all(reqId) as { product_id: number; unit_id: number; requested_milli: number }[];

    const posted = postDocument(db, actor, {
      type: req.kind === 'department_issue' ? 'issue' : 'transfer',
      departmentId: req.kind === 'department_issue' ? req.department_id : null,
      reference: req.reference ?? `REQ-${req.id}`,
      reason: decisionReason,
      idempotencyKey,
      lines: lines.map((l) => ({
        productId: l.product_id,
        warehouseId: req.warehouse_id,
        toWarehouseId: req.kind === 'warehouse_transfer' ? req.to_warehouse_id! : undefined,
        unitId: l.unit_id,
        quantityMilli: l.requested_milli,
      })),
    });

    db.prepare(
      "UPDATE requisitions SET status = 'fulfilled', posted_document_id = ?, fulfilled_by = ?, fulfilled_at = datetime('now'), decision_reason = ? WHERE id = ?",
    ).run(posted.documentId, actor.id, decisionReason, reqId);
    recordAudit(db, actor, 'requisition.fulfill', 'requisition', reqId, {
      decision: 'fulfilled',
      reason: decisionReason,
      documentId: posted.documentId,
      kind: req.kind,
    });

    return posted;
  });
}

export function rejectRequisition(db: Db, actor: AuthUser, reqId: number, reason?: string | null): void {
  const orgId = actor.organisationId;
  const decisionReason = reason?.trim() || 'Rejected requisition';
  const req = db
    .prepare('SELECT id, warehouse_id, notes, status FROM requisitions WHERE id = ? AND organisation_id = ?')
    .get(reqId, orgId) as { id: number; warehouse_id: number; notes: string | null; status: string } | undefined;
  if (!req) throw new AppError(404, 'requisition_not_found');
  const wh = loadWarehouse(db, orgId, req.warehouse_id);
  if (!canAccessWarehouse(actor, wh.branch_id)) throw new AppError(403, 'forbidden_warehouse');
  if (req.status !== 'pending') throw new AppError(409, 'requisition_not_pending');
  const updatedNotes = reason?.trim() ? (req.notes ? `${req.notes} | Rejected: ${reason.trim()}` : `Rejected: ${reason.trim()}`) : req.notes;
  db.prepare(
    "UPDATE requisitions SET status = 'rejected', notes = ?, fulfilled_by = ?, fulfilled_at = datetime('now'), decision_reason = ? WHERE id = ?",
  ).run(updatedNotes, actor.id, decisionReason, reqId);
  recordAudit(db, actor, 'requisition.reject', 'requisition', reqId, { decision: 'rejected', reason: decisionReason });
}

export function getRequisition(db: Db, orgId: number, reqId: number) {
  const req = db
    .prepare(
      `SELECT r.id, r.kind, r.warehouse_id AS warehouseId, w.name AS warehouseName,
              r.department_id AS departmentId, d.name AS departmentName,
              r.to_warehouse_id AS toWarehouseId, tw.name AS toWarehouseName,
              r.reference, r.notes, r.status, r.posted_document_id AS postedDocumentId,
              r.created_by AS createdBy, r.fulfilled_by AS fulfilledBy,
              r.decision_reason AS decisionReason,
              r.created_at AS createdAt, r.fulfilled_at AS fulfilledAt
         FROM requisitions r
         JOIN warehouses w ON w.id = r.warehouse_id
         LEFT JOIN departments d ON d.id = r.department_id
         LEFT JOIN warehouses tw ON tw.id = r.to_warehouse_id
        WHERE r.id = ? AND r.organisation_id = ?`,
    )
    .get(reqId, orgId) as
    | {
        id: number;
        kind: string;
        warehouseId: number;
        warehouseName: string;
        departmentId: number | null;
        departmentName: string | null;
        toWarehouseId: number | null;
        toWarehouseName: string | null;
        reference: string | null;
        notes: string | null;
        status: string;
        postedDocumentId: number | null;
        createdBy: number;
        fulfilledBy: number | null;
        decisionReason: string | null;
        createdAt: string;
        fulfilledAt: string | null;
      }
    | undefined;
  if (!req) return null;

  const lines = (db
    .prepare(
      `SELECT l.id, l.product_id AS productId, p.sku, p.name AS productName, p.base_unit_id AS baseUnitId,
              bu.code AS baseUnit, l.unit_id AS unitId, u.code AS unit, l.requested_milli
         FROM requisition_lines l
         JOIN products p ON p.id = l.product_id
         JOIN units_of_measure u ON u.id = l.unit_id
         JOIN units_of_measure bu ON bu.id = p.base_unit_id
        WHERE l.requisition_id = ? ORDER BY l.id`,
    )
    .all(reqId) as {
    id: number;
    productId: number;
    sku: string;
    productName: string;
    baseUnitId: number;
    baseUnit: string;
    unitId: number;
    unit: string;
    requested_milli: number;
  }[]).map((l) => {
    const factorMilli = resolveFactor(db, { id: l.productId, base_unit_id: l.baseUnitId }, l.unitId);
    const requestedBaseMilli = toBase(l.requested_milli, factorMilli);
    const availableBaseMilli = getBalance(db, orgId, l.productId, req.warehouseId);
    return {
      id: l.id,
      productId: l.productId,
      sku: l.sku,
      productName: l.productName,
      unitId: l.unitId,
      unit: l.unit,
      baseUnit: l.baseUnit,
      requestedQuantity: fromMilli(l.requested_milli),
      requestedBaseQuantity: fromMilli(requestedBaseMilli),
      availableBaseQuantity: fromMilli(availableBaseMilli),
    };
  });

  return { ...req, lines };
}

// ---------- returns (from department to warehouse, or from warehouse to supplier) ----------

export interface ReturnInput {
  returnType: 'from_department' | 'to_supplier';
  warehouseId: number;
  departmentId?: number | null;
  supplierId?: number | null;
  reference?: string | null;
  reason: string;
  idempotencyKey: string;
  lines: { productId: number; unitId: number; quantity: number; batchNumber?: string | null; expiryDate?: string | null }[];
}

export function postReturn(db: Db, actor: AuthUser, input: ReturnInput): PostResult {
  const orgId = actor.organisationId;
  return tx(db, () => {
    const wh = loadWarehouse(db, orgId, input.warehouseId);
    if (!canAccessWarehouse(actor, wh.branch_id)) throw new AppError(403, 'forbidden_warehouse');

    let prefix = '';
    if (input.returnType === 'from_department') {
      if (!input.departmentId) throw new AppError(400, 'department_required_for_return');
      const dept = db
        .prepare('SELECT d.name, d.branch_id, d.active FROM departments d JOIN branches b ON b.id = d.branch_id WHERE d.id = ? AND b.organisation_id = ?')
        .get(input.departmentId, orgId) as { name: string; branch_id: number; active: number } | undefined;
      if (!dept) throw new AppError(400, 'department_not_found');
      if (!dept.active) throw new AppError(400, 'department_inactive');
      if (dept.branch_id !== wh.branch_id) throw new AppError(400, 'department_branch_mismatch');
      prefix = `Return from department (${dept.name}): `;
    } else {
      if (!input.supplierId) throw new AppError(400, 'supplier_required_for_return');
      const sup = db.prepare('SELECT name, active FROM suppliers WHERE id = ? AND organisation_id = ?').get(input.supplierId, orgId) as
        | { name: string; active: number }
        | undefined;
      if (!sup) throw new AppError(400, 'supplier_not_found');
      if (!sup.active) throw new AppError(400, 'supplier_inactive');
      prefix = `Return to supplier (${sup.name}): `;
    }

    const sign = input.returnType === 'from_department' ? 1 : -1;
    return postDocument(db, actor, {
      type: 'adjustment',
      reference: input.reference?.trim() || null,
      reason: `${prefix}${input.reason.trim()}`,
      idempotencyKey: input.idempotencyKey,
      lines: input.lines.map((l) => {
        const qMilli = toMilli(l.quantity);
        if (qMilli <= 0) throw new AppError(400, 'quantity_must_be_positive');
        return {
          productId: l.productId,
          warehouseId: input.warehouseId,
          unitId: l.unitId,
          quantityMilli: sign * qMilli,
          batchNumber: l.batchNumber ?? null,
          expiryDate: l.expiryDate ?? null,
        };
      }),
    });
  });
}

// ---------- reading ----------

export function getDocument(db: Db, orgId: number, id: number) {
  const doc = db
    .prepare(
      `SELECT d.id, d.type, d.reference, d.reason, d.supplier_id AS supplierId, d.department_id AS departmentId,
              d.reverses_document_id AS reversesDocumentId, d.created_by AS createdBy, d.created_at AS createdAt,
              (SELECT r.id FROM stock_documents r WHERE r.reverses_document_id = d.id) AS reversedByDocumentId
         FROM stock_documents d WHERE d.id = ? AND d.organisation_id = ?`,
    )
    .get(id, orgId);
  if (!doc) return null;
  const lines = (db
    .prepare(
      `SELECT id, product_id AS productId, warehouse_id AS warehouseId, unit_id AS unitId,
              quantity_milli, factor_milli, base_delta_milli, unit_cost_cents, unit_selling_price_cents, tender_type AS tenderType, batch_number AS batchNumber, expiry_date AS expiryDate
         FROM stock_movements WHERE document_id = ? ORDER BY id`,
    )
    .all(id) as {
    id: number;
    productId: number;
    warehouseId: number;
    unitId: number;
    quantity_milli: number;
    factor_milli: number;
    base_delta_milli: number;
    unit_cost_cents: number;
    unit_selling_price_cents: number;
    tenderType: string;
    batchNumber: string | null;
    expiryDate: string | null;
  }[]).map((l) => ({
    id: l.id,
    productId: l.productId,
    warehouseId: l.warehouseId,
    unitId: l.unitId,
    quantity: fromMilli(l.quantity_milli),
    factor: fromMilli(l.factor_milli),
    baseChange: fromMilli(l.base_delta_milli),
    unitCost: fromCents(l.unit_cost_cents),
    unitSellingPrice: fromCents(l.unit_selling_price_cents),
    tenderType: l.tenderType,
    batchNumber: l.batchNumber,
    expiryDate: l.expiryDate,
  }));
  return { ...doc, lines };
}

// ---------- verification ----------

export interface LedgerProblem { check: string; detail: string }

/**
 * Audits ledger integrity. Balances themselves are a view over the ledger, so this checks the ledger's own invariants:
 * sign rules per document type, unit-conversion arithmetic, transfers net to zero, reversals exactly cancel their originals,
 * and (unless allowed) no negative balances.
 */
export function verifyLedger(db: Db, organisationId?: number): { ok: boolean; problems: LedgerProblem[] } {
  const problems: LedgerProblem[] = [];
  const scope = organisationId === undefined ? '' : ` AND d.organisation_id = ${Number(organisationId)}`;
  const all = (sql: string) => db.prepare(sql).all() as Record<string, number | string>[];

  for (const r of all(`SELECT m.id FROM stock_movements m JOIN stock_documents d ON d.id = m.document_id
      WHERE ((d.type = 'receipt' AND m.base_delta_milli <= 0) OR (d.type IN ('issue', 'write_off') AND m.base_delta_milli >= 0))${scope}`))
    problems.push({ check: 'sign_rule', detail: `movement ${r.id} has the wrong sign for its document type` });

  // Count rows store the counted quantity while the delta is the variance, so counts (and reversals of counts) are exempt.
  for (const r of all(`SELECT m.id FROM stock_movements m JOIN stock_documents d ON d.id = m.document_id
      LEFT JOIN stock_documents o ON o.id = d.reverses_document_id
      WHERE d.type != 'count' AND COALESCE(o.type, '') != 'count' AND abs(m.base_delta_milli) * 1000 != m.quantity_milli * m.factor_milli${scope}`))
    problems.push({ check: 'conversion', detail: `movement ${r.id} does not match quantity x factor` });

  for (const r of all(`SELECT d.id, m.product_id FROM stock_documents d JOIN stock_movements m ON m.document_id = d.id
      WHERE d.type = 'transfer'${scope} GROUP BY d.id, m.product_id HAVING SUM(m.base_delta_milli) != 0`))
    problems.push({ check: 'transfer_balance', detail: `transfer ${r.id} does not net to zero for product ${r.product_id}` });

  for (const r of all(`SELECT d.id FROM stock_documents d WHERE d.type = 'reversal'${scope} AND
      EXISTS (SELECT 1 FROM stock_movements m WHERE m.document_id IN (d.id, d.reverses_document_id)
              GROUP BY m.product_id, m.warehouse_id HAVING SUM(m.base_delta_milli) != 0)`))
    problems.push({ check: 'reversal', detail: `reversal ${r.id} does not exactly cancel its original` });

  for (const r of all(`SELECT b.product_id, b.warehouse_id, b.quantity_milli FROM stock_balances b JOIN organisations o ON o.id = b.organisation_id
      WHERE b.quantity_milli < 0 AND o.allow_negative_stock = 0${organisationId === undefined ? '' : ` AND b.organisation_id = ${Number(organisationId)}`}`))
    problems.push({ check: 'negative_balance', detail: `product ${r.product_id} at warehouse ${r.warehouse_id} is ${fromMilli(Number(r.quantity_milli))}` });

  return { ok: problems.length === 0, problems };
}

// ---------- backup history, checksum verification & controlled restoration ----------

export interface BackupSummary {
  id: number;
  label: string;
  checksumSha256: string;
  sizeBytes: number;
  status: 'verified' | 'restored';
  createdBy: number;
  createdByName: string | null;
  createdAt: string;
  restoredAt: string | null;
}

export function createSystemBackup(db: Db, actor: AuthUser, label: string): BackupSummary {
  if (actor.role !== 'executive_manager') throw new AppError(403, 'forbidden');
  const orgId = actor.organisationId;
  return tx(db, () => {
    const snapshot = {
      version: 1,
      organisationId: orgId,
      organisation: db.prepare('SELECT id, name, allow_negative_stock, enforce_separation_of_duties, po_approval_threshold_cents, currency_code FROM organisations WHERE id = ?').get(orgId),
      rolePermissions: db.prepare('SELECT role, permission, allowed FROM role_permissions WHERE organisation_id = ? ORDER BY role, permission').all(orgId),
      branches: db.prepare('SELECT id, name, city, active FROM branches WHERE organisation_id = ? ORDER BY id').all(orgId),
      warehouses: db.prepare('SELECT w.id, w.branch_id, w.name, w.active FROM warehouses w JOIN branches b ON b.id = w.branch_id WHERE b.organisation_id = ? ORDER BY w.id').all(orgId),
      departments: db.prepare("SELECT d.id, d.branch_id, d.name, COALESCE(d.code, 'DPT-' || printf('%03d', d.id)) AS code, d.active FROM departments d JOIN branches b ON b.id = d.branch_id WHERE b.organisation_id = ? ORDER BY d.id").all(orgId),
      categories: db.prepare("SELECT id, parent_id, name, COALESCE(code, 'CAT-' || printf('%03d', id)) AS code, active FROM categories WHERE organisation_id = ? ORDER BY id").all(orgId),
      units: db.prepare('SELECT id, code, name FROM units_of_measure WHERE organisation_id = ? ORDER BY id').all(orgId),
      suppliers: db.prepare('SELECT id, name, email, phone, active FROM suppliers WHERE organisation_id = ? ORDER BY id').all(orgId),
      products: db.prepare('SELECT id, sku, name, description, category_id, base_unit_id, unit_cost_cents, reorder_level_milli, active FROM products WHERE organisation_id = ? ORDER BY id').all(orgId),
      packagings: db.prepare('SELECT g.id, g.product_id, g.unit_id, g.factor_milli FROM product_packagings g JOIN products p ON p.id = g.product_id WHERE p.organisation_id = ? ORDER BY g.id').all(orgId),
      documentCount: (db.prepare('SELECT COUNT(*) n FROM stock_documents WHERE organisation_id = ?').get(orgId) as { n: number }).n,
      movementCount: (db.prepare('SELECT COUNT(*) n FROM stock_movements WHERE organisation_id = ?').get(orgId) as { n: number }).n,
      balances: db.prepare('SELECT product_id, warehouse_id, quantity_milli FROM stock_balances WHERE organisation_id = ? ORDER BY product_id, warehouse_id').all(orgId),
    };
    const snapshotJson = JSON.stringify(snapshot);
    const checksum = createHash('sha256').update(snapshotJson).digest('hex');
    const sizeBytes = Buffer.byteLength(snapshotJson, 'utf8');
    const res = db
      .prepare(
        `INSERT INTO system_backups (organisation_id, label, snapshot_json, checksum_sha256, size_bytes, status, created_by)
         VALUES (?, ?, ?, ?, ?, 'verified', ?)`,
      )
      .run(orgId, label.trim(), snapshotJson, checksum, sizeBytes, actor.id);
    const backupId = Number(res.lastInsertRowid);
    recordAudit(db, actor, 'backup.create', 'system_backup', backupId, { label: label.trim(), checksum, sizeBytes });
    return {
      id: backupId,
      label: label.trim(),
      checksumSha256: checksum,
      sizeBytes,
      status: 'verified',
      createdBy: actor.id,
      createdByName: actor.name,
      createdAt: new Date().toISOString(),
      restoredAt: null,
    };
  });
}

export function verifySystemBackup(db: Db, orgId: number, backupId: number) {
  const row = db
    .prepare('SELECT id, label, snapshot_json, checksum_sha256, status, created_at, restored_at FROM system_backups WHERE id = ? AND organisation_id = ?')
    .get(backupId, orgId) as
    | { id: number; label: string; snapshot_json: string; checksum_sha256: string; status: string; created_at: string; restored_at: string | null }
    | undefined;
  if (!row) throw new AppError(404, 'backup_not_found');
  const computed = createHash('sha256').update(row.snapshot_json).digest('hex');
  const checksumMatch = computed === row.checksum_sha256;
  const ledger = verifyLedger(db, orgId);
  return {
    backupId: row.id,
    label: row.label,
    checksumMatch,
    expectedChecksum: row.checksum_sha256,
    computedChecksum: computed,
    ledgerOk: ledger.ok,
    readyForRestore: checksumMatch && ledger.ok,
  };
}

export function restoreSystemBackup(db: Db, actor: AuthUser, backupId: number, confirmationPhrase: string) {
  if (actor.role !== 'executive_manager') throw new AppError(403, 'forbidden');
  if (confirmationPhrase.trim() !== 'CONFIRM-RESTORE') {
    throw new AppError(400, 'invalid_restore_confirmation');
  }
  const orgId = actor.organisationId;
  return tx(db, () => {
    const row = db
      .prepare('SELECT id, label, snapshot_json, checksum_sha256 FROM system_backups WHERE id = ? AND organisation_id = ?')
      .get(backupId, orgId) as { id: number; label: string; snapshot_json: string; checksum_sha256: string } | undefined;
    if (!row) throw new AppError(404, 'backup_not_found');
    const computed = createHash('sha256').update(row.snapshot_json).digest('hex');
    if (computed !== row.checksum_sha256) throw new AppError(409, 'backup_checksum_mismatch');

    const snap = JSON.parse(row.snapshot_json) as {
      organisation?: {
        name: string;
        allow_negative_stock: number;
        enforce_separation_of_duties: number;
        po_approval_threshold_cents: number;
        currency_code: string;
      };
      rolePermissions?: { role: string; permission: string; allowed: number }[];
      branches?: { id: number; name: string; city: string | null; active: number }[];
      warehouses?: { id: number; branch_id: number; name: string; active: number }[];
      departments?: { id: number; branch_id: number; name: string; active: number }[];
      categories?: { id: number; parent_id: number | null; name: string; active: number }[];
      suppliers?: { id: number; name: string; email: string | null; phone: string | null; active: number }[];
      products?: {
        id: number;
        sku: string;
        name: string;
        description: string | null;
        category_id: number | null;
        base_unit_id: number;
        unit_cost_cents: number;
        reorder_level_milli: number;
        active: number;
      }[];
    };

    if (snap.organisation) {
      db.prepare(
        `UPDATE organisations
            SET name = ?, allow_negative_stock = ?, enforce_separation_of_duties = ?,
                po_approval_threshold_cents = ?, currency_code = ?
          WHERE id = ?`,
      ).run(
        snap.organisation.name,
        snap.organisation.allow_negative_stock ?? 0,
        snap.organisation.enforce_separation_of_duties ?? 0,
        snap.organisation.po_approval_threshold_cents ?? 0,
        snap.organisation.currency_code ?? 'USD',
        orgId,
      );
    }

    if (snap.rolePermissions) {
      const upPerm = db.prepare(
        `INSERT INTO role_permissions (organisation_id, role, permission, allowed, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(organisation_id, role, permission) DO UPDATE SET allowed = excluded.allowed, updated_at = datetime('now')`,
      );
      for (const rp of snap.rolePermissions) upPerm.run(orgId, rp.role, rp.permission, rp.allowed);
    }

    for (const b of snap.branches ?? []) {
      db.prepare('UPDATE branches SET name = ?, city = ?, active = ? WHERE id = ? AND organisation_id = ?').run(b.name, b.city, b.active, b.id, orgId);
    }
    for (const w of snap.warehouses ?? []) {
      db.prepare('UPDATE warehouses SET name = ?, active = ? WHERE id = ?').run(w.name, w.active, w.id);
    }
    for (const d of snap.departments ?? []) {
      db.prepare('UPDATE departments SET name = ?, active = ? WHERE id = ?').run(d.name, d.active, d.id);
    }
    for (const c of snap.categories ?? []) {
      db.prepare('UPDATE categories SET name = ?, active = ? WHERE id = ? AND organisation_id = ?').run(c.name, c.active, c.id, orgId);
    }
    for (const s of snap.suppliers ?? []) {
      db.prepare('UPDATE suppliers SET name = ?, email = ?, phone = ?, active = ? WHERE id = ? AND organisation_id = ?').run(s.name, s.email, s.phone, s.active, s.id, orgId);
    }
    for (const p of snap.products ?? []) {
      db.prepare(
        'UPDATE products SET name = ?, description = ?, category_id = ?, unit_cost_cents = ?, reorder_level_milli = ?, active = ? WHERE id = ? AND organisation_id = ?',
      ).run(p.name, p.description, p.category_id, p.unit_cost_cents, p.reorder_level_milli, p.active, p.id, orgId);
    }

    db.prepare("UPDATE system_backups SET status = 'restored', restored_at = datetime('now'), restored_by = ? WHERE id = ?").run(actor.id, backupId);
    recordAudit(db, actor, 'backup.restore', 'system_backup', backupId, { label: row.label, checksum: row.checksum_sha256 });

    return {
      ok: true,
      backupId: row.id,
      label: row.label,
      checksumSha256: row.checksum_sha256,
      restoredAt: new Date().toISOString(),
    };
  });
}
