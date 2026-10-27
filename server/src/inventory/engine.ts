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

export interface LineInput {
  productId: number;
  warehouseId: number; // source warehouse for transfers
  unitId: number;
  /** In milli-units of `unitId`. Positive for most types; signed non-zero for adjustments; counted quantity (>= 0) for counts. */
  quantityMilli: number;
  toWarehouseId?: number; // transfers only
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

// ---------- quantity helpers ----------

/** Converts a decimal quantity (max 3 decimal places) to integer milli-units. */
export function toMilli(n: number): number {
  const m = Math.round(n * 1000);
  if (Math.abs(n * 1000 - m) > 1e-6) throw new AppError(400, 'too_many_decimals');
  if (!Number.isSafeInteger(m)) throw new AppError(400, 'quantity_out_of_range');
  return m;
}
export const fromMilli = (m: number) => m / 1000;

/** entered quantity (milli) x factor (milli) -> base milli-units; must be exact. */
function toBase(quantityMilli: number, factorMilli: number): number {
  const product = quantityMilli * factorMilli;
  if (!Number.isSafeInteger(product) || product % 1000 !== 0) throw new AppError(400, 'quantity_not_representable');
  return product / 1000;
}

export function tx<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
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
  const p = db.prepare('SELECT id, base_unit_id, active FROM products WHERE id = ? AND organisation_id = ?').get(id, orgId) as
    | { id: number; base_unit_id: number; active: number }
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
      `INSERT INTO stock_movements (document_id, organisation_id, product_id, warehouse_id, unit_id, quantity_milli, factor_milli, base_delta_milli)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(documentId, orgId, r.productId, r.warehouseId, r.unitId, r.quantityMilli, r.factorMilli, r.deltaMilli);

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
  if (input.lines.length === 0 || input.lines.length > 200) throw new AppError(400, 'invalid_line_count');
  const reason = input.reason?.trim() || null;
  if ((type === 'adjustment' || type === 'write_off') && !reason) throw new AppError(400, 'reason_required');
  if (input.supplierId && type !== 'receipt') throw new AppError(400, 'supplier_only_on_receipts');
  if (input.departmentId && type !== 'issue' && type !== 'write_off') throw new AppError(400, 'department_not_allowed');

  const orgId = actor.organisationId;
  const hash = hashOf([type, input.lines.map((l) => [l.productId, l.warehouseId, l.toWarehouseId ?? null, l.unitId, l.quantityMilli]), input.supplierId ?? null, input.departmentId ?? null, input.reference ?? null, reason]);

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
      const row = (warehouseId: number, deltaMilli: number): Row => ({ warehouseId, productId: line.productId, unitId: line.unitId, quantityMilli: Math.abs(q), factorMilli: factor, deltaMilli });

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
      `INSERT INTO stock_movements (document_id, organisation_id, product_id, warehouse_id, unit_id, quantity_milli, factor_milli, base_delta_milli)
       SELECT ?, organisation_id, product_id, warehouse_id, unit_id, quantity_milli, factor_milli, -base_delta_milli
         FROM stock_movements WHERE document_id = ?`,
    ).run(documentId, originalId);
    const touched = db.prepare('SELECT DISTINCT product_id, warehouse_id FROM stock_movements WHERE document_id = ?').all(documentId) as { product_id: number; warehouse_id: number }[];
    assertNonNegative(db, orgId, touched.map((t) => `${t.product_id}:${t.warehouse_id}`));
    return { documentId, replayed: false };
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
              quantity_milli, factor_milli, base_delta_milli
         FROM stock_movements WHERE document_id = ? ORDER BY id`,
    )
    .all(id) as { id: number; productId: number; warehouseId: number; unitId: number; quantity_milli: number; factor_milli: number; base_delta_milli: number }[]).map((l) => ({
    id: l.id,
    productId: l.productId,
    warehouseId: l.warehouseId,
    unitId: l.unitId,
    quantity: fromMilli(l.quantity_milli),
    factor: fromMilli(l.factor_milli),
    baseChange: fromMilli(l.base_delta_milli),
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
