import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { Db } from '../db.ts';
import type { Role } from '../app.ts';
import { AppError } from '../errors.ts';
import {
  GRANULAR_PERMISSIONS,
  approveCountSheet,
  approvePurchaseOrder,
  cancelCountSheet,
  cancelPurchaseOrder,
  createCountSheet,
  createPurchaseOrder,
  createRequisition,
  createSystemBackup,
  fromCents,
  fromMilli,
  fulfillRequisition,
  getCountSheet,
  getDocument,
  getPurchaseOrder,
  getRequisition,
  hasPermission,
  postDocument,
  postReturn,
  receivePurchaseOrder,
  recordAudit,
  rejectRequisition,
  restoreSystemBackup,
  reverseDocument,
  toCents,
  toMilli,
  verifyLedger,
  verifySystemBackup,
  type GranularPermission,
  type PostableType,
} from './engine.ts';

type Guard = (...roles: Role[]) => (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

const id = z.number().int().positive();
const name = z.string().trim().min(1).max(120);
const text = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null);
const qty = z.number().finite().min(-1e9).max(1e9);
const money = z.number().finite().min(0).max(1e9);
const paging = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) });
const idParam = z.object({ id: z.coerce.number().int().positive() });
const flag = (v: boolean | undefined) => (v === undefined ? undefined : v ? 1 : 0);

/** Builds "SET a = ?, b = ?" from defined values only. Column names come from code, never from the client. */
function update(db: Db, table: string, rowId: number, cols: Record<string, unknown>) {
  const entries = Object.entries(cols).filter(([, v]) => v !== undefined);
  if (entries.length === 0) throw new AppError(400, 'nothing_to_update');
  db.prepare(`UPDATE ${table} SET ${entries.map(([c]) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...(entries.map(([, v]) => v) as (string | number | null)[]), rowId);
}

export function registerInventoryRoutes(app: FastifyInstance, db: Db, requireAuth: Guard, bcryptCost = 12) {
  const exec = requireAuth('executive_manager');
  const staff = requireAuth('executive_manager', 'inventory_manager');
  const anyUser = requireAuth();

  const owned = (table: string, rowId: number, orgId: number, code: string) => {
    if (!db.prepare(`SELECT 1 FROM ${table} WHERE id = ? AND organisation_id = ?`).get(rowId, orgId)) throw new AppError(400, code);
  };
  const ownedBranch = (branchId: number, orgId: number) => {
    if (!db.prepare('SELECT 1 FROM branches WHERE id = ? AND organisation_id = ?').get(branchId, orgId)) throw new AppError(400, 'branch_not_found');
  };

  // ---------- organisation ----------
  app.get('/api/organisation', { preHandler: anyUser }, async (req) => {
    const o = db
      .prepare('SELECT id, name, allow_negative_stock, enforce_separation_of_duties, po_approval_threshold_cents, currency_code FROM organisations WHERE id = ?')
      .get(req.user!.organisationId) as {
      id: number;
      name: string;
      allow_negative_stock: number;
      enforce_separation_of_duties: number;
      po_approval_threshold_cents: number;
      currency_code: string;
    };
    return {
      id: o.id,
      name: o.name,
      allowNegativeStock: !!o.allow_negative_stock,
      enforceSeparationOfDuties: !!o.enforce_separation_of_duties,
      poApprovalThreshold: fromCents(o.po_approval_threshold_cents ?? 0),
      currencyCode: o.currency_code ?? 'USD',
    };
  });
  app.patch('/api/organisation', { preHandler: exec }, async (req) => {
    const b = z
      .object({
        name: name.optional(),
        allowNegativeStock: z.boolean().optional(),
        enforceSeparationOfDuties: z.boolean().optional(),
        poApprovalThreshold: money.optional(),
        currencyCode: z.string().trim().min(3).max(8).optional(),
      })
      .strict()
      .parse(req.body);
    update(db, 'organisations', req.user!.organisationId, {
      name: b.name,
      allow_negative_stock: flag(b.allowNegativeStock),
      enforce_separation_of_duties: flag(b.enforceSeparationOfDuties),
      po_approval_threshold_cents: b.poApprovalThreshold !== undefined ? toCents(b.poApprovalThreshold) : undefined,
      currency_code: b.currencyCode,
    });
    recordAudit(db, req.user!, 'org.policy_update', 'organisation', req.user!.organisationId, b);
    return { ok: true };
  });

  // ---------- user management (executive only) ----------
  app.get('/api/users', { preHandler: exec }, async (req) => {
    const rows = db
      .prepare(
        `SELECT u.id, u.email, u.name, u.role, u.branch_id AS branchId, b.name AS branchName, u.active, u.locked_until AS lockedUntil, u.created_at AS createdAt
           FROM users u LEFT JOIN branches b ON b.id = u.branch_id
          WHERE u.organisation_id = ? ORDER BY u.name`,
      )
      .all(req.user!.organisationId) as Record<string, unknown>[];
    return rows.map((r) => ({ ...r, active: !!r.active }));
  });
  app.post('/api/users', { preHandler: exec }, async (req, reply) => {
    const orgId = req.user!.organisationId;
    const b = z
      .object({
        email: z.string().trim().email().max(254),
        name,
        password: z.string().min(10, 'Password must be at least 10 characters').max(200),
        role: z.enum(['executive_manager', 'inventory_manager']),
        branchId: id.nullish(),
      })
      .strict()
      .parse(req.body);
    if (b.branchId) ownedBranch(b.branchId, orgId);
    const hash = await bcrypt.hash(b.password, bcryptCost);
    const r = db
      .prepare('INSERT INTO users (organisation_id, branch_id, email, name, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)')
      .run(orgId, b.branchId ?? null, b.email, b.name, hash, b.role);
    const userId = Number(r.lastInsertRowid);
    recordAudit(db, req.user!, 'user.create', 'user', userId, { email: b.email, name: b.name, role: b.role, branchId: b.branchId ?? null });
    return reply.code(201).send({ id: userId });
  });
  app.patch('/api/users/:id', { preHandler: exec }, async (req) => {
    const { id: rowId } = idParam.parse(req.params);
    const orgId = req.user!.organisationId;
    owned('users', rowId, orgId, 'not_found');
    const b = z
      .object({
        name: name.optional(),
        role: z.enum(['executive_manager', 'inventory_manager']).optional(),
        branchId: id.nullable().optional(),
        active: z.boolean().optional(),
        password: z.string().min(10).max(200).optional(),
        unlock: z.boolean().optional(),
      })
      .strict()
      .parse(req.body);
    if (rowId === req.user!.id && (b.active === false || b.role === 'inventory_manager')) {
      throw new AppError(400, 'cannot_demote_or_deactivate_self');
    }
    if (b.branchId) ownedBranch(b.branchId, orgId);
    const cols: Record<string, unknown> = {
      name: b.name,
      role: b.role,
      branch_id: b.branchId,
      active: flag(b.active),
    };
    if (b.password) cols.password_hash = await bcrypt.hash(b.password, bcryptCost);
    if (b.unlock || b.password) {
      cols.failed_attempts = 0;
      cols.locked_until = null;
    }
    update(db, 'users', rowId, cols);
    if (b.active === false || b.password) {
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(rowId);
    }
    recordAudit(db, req.user!, 'user.update', 'user', rowId, {
      name: b.name,
      role: b.role,
      branchId: b.branchId,
      active: b.active,
      passwordReset: !!b.password,
      unlocked: !!b.unlock,
    });
    return { ok: true };
  });

  // ---------- organisation structure (executive manages; everyone signed in can read) ----------
  app.get('/api/branches', { preHandler: anyUser }, async (req) =>
    db.prepare('SELECT id, name, city, active FROM branches WHERE organisation_id = ? ORDER BY name').all(req.user!.organisationId),
  );
  app.post('/api/branches', { preHandler: exec }, async (req, reply) => {
    const b = z.object({ name, city: text(80) }).strict().parse(req.body);
    const r = db.prepare('INSERT INTO branches (organisation_id, name, city) VALUES (?, ?, ?)').run(req.user!.organisationId, b.name, b.city);
    const branchId = Number(r.lastInsertRowid);
    recordAudit(db, req.user!, 'branch.create', 'branch', branchId, b);
    return reply.code(201).send({ id: branchId });
  });
  app.patch('/api/branches/:id', { preHandler: exec }, async (req) => {
    const { id: rowId } = idParam.parse(req.params);
    ownedBranch(rowId, req.user!.organisationId);
    const b = z.object({ name: name.optional(), city: text(80).optional(), active: z.boolean().optional() }).strict().parse(req.body);
    update(db, 'branches', rowId, { name: b.name, city: b.city, active: flag(b.active) });
    recordAudit(db, req.user!, 'branch.update', 'branch', rowId, b);
    return { ok: true };
  });

  for (const table of ['warehouses', 'departments'] as const) {
    app.get(`/api/${table}`, { preHandler: anyUser }, async (req) =>
      db
        .prepare(`SELECT t.id, t.branch_id AS branchId, b.name AS branchName, t.name, t.active FROM ${table} t JOIN branches b ON b.id = t.branch_id WHERE b.organisation_id = ? ORDER BY t.name`)
        .all(req.user!.organisationId),
    );
    app.post(`/api/${table}`, { preHandler: exec }, async (req, reply) => {
      const b = z.object({ branchId: id, name }).strict().parse(req.body);
      ownedBranch(b.branchId, req.user!.organisationId);
      const r = db.prepare(`INSERT INTO ${table} (branch_id, name) VALUES (?, ?)`).run(b.branchId, b.name);
      const createdId = Number(r.lastInsertRowid);
      recordAudit(db, req.user!, `${table.slice(0, -1)}.create`, table.slice(0, -1), createdId, b);
      return reply.code(201).send({ id: createdId });
    });
    app.patch(`/api/${table}/:id`, { preHandler: exec }, async (req) => {
      const { id: rowId } = idParam.parse(req.params);
      if (!db.prepare(`SELECT 1 FROM ${table} t JOIN branches b ON b.id = t.branch_id WHERE t.id = ? AND b.organisation_id = ?`).get(rowId, req.user!.organisationId)) throw new AppError(404, 'not_found');
      const b = z.object({ name: name.optional(), active: z.boolean().optional() }).strict().parse(req.body);
      update(db, table, rowId, { name: b.name, active: flag(b.active) });
      recordAudit(db, req.user!, `${table.slice(0, -1)}.update`, table.slice(0, -1), rowId, b);
      return { ok: true };
    });
  }

  // ---------- master data (executive and inventory managers) ----------
  app.get('/api/categories', { preHandler: anyUser }, async (req) =>
    db.prepare('SELECT id, parent_id AS parentId, name, active FROM categories WHERE organisation_id = ? ORDER BY name').all(req.user!.organisationId),
  );
  app.post('/api/categories', { preHandler: staff }, async (req, reply) => {
    const b = z.object({ name, parentId: id.nullish() }).strict().parse(req.body);
    if (b.parentId) owned('categories', b.parentId, req.user!.organisationId, 'category_not_found');
    const r = db.prepare('INSERT INTO categories (organisation_id, parent_id, name) VALUES (?, ?, ?)').run(req.user!.organisationId, b.parentId ?? null, b.name);
    return reply.code(201).send({ id: Number(r.lastInsertRowid) });
  });
  app.patch('/api/categories/:id', { preHandler: staff }, async (req) => {
    const { id: rowId } = idParam.parse(req.params);
    owned('categories', rowId, req.user!.organisationId, 'not_found');
    const b = z.object({ name: name.optional(), active: z.boolean().optional() }).strict().parse(req.body);
    update(db, 'categories', rowId, { name: b.name, active: flag(b.active) });
    return { ok: true };
  });

  app.get('/api/units', { preHandler: anyUser }, async (req) =>
    db.prepare('SELECT id, code, name FROM units_of_measure WHERE organisation_id = ? ORDER BY code').all(req.user!.organisationId),
  );
  app.post('/api/units', { preHandler: staff }, async (req, reply) => {
    const b = z.object({ code: z.string().trim().min(1).max(12), name }).strict().parse(req.body);
    const r = db.prepare('INSERT INTO units_of_measure (organisation_id, code, name) VALUES (?, ?, ?)').run(req.user!.organisationId, b.code, b.name);
    return reply.code(201).send({ id: Number(r.lastInsertRowid) });
  });

  app.get('/api/suppliers', { preHandler: anyUser }, async (req) =>
    db.prepare('SELECT id, name, email, phone, active FROM suppliers WHERE organisation_id = ? ORDER BY name').all(req.user!.organisationId),
  );
  app.post('/api/suppliers', { preHandler: staff }, async (req, reply) => {
    const b = z.object({ name, email: z.string().trim().email().max(254).nullish().transform((v) => v || null), phone: text(40) }).strict().parse(req.body);
    const r = db.prepare('INSERT INTO suppliers (organisation_id, name, email, phone) VALUES (?, ?, ?, ?)').run(req.user!.organisationId, b.name, b.email, b.phone);
    return reply.code(201).send({ id: Number(r.lastInsertRowid) });
  });
  app.patch('/api/suppliers/:id', { preHandler: staff }, async (req) => {
    const { id: rowId } = idParam.parse(req.params);
    owned('suppliers', rowId, req.user!.organisationId, 'not_found');
    const b = z.object({ name: name.optional(), email: z.string().trim().email().max(254).nullable().optional(), phone: text(40).optional(), active: z.boolean().optional() }).strict().parse(req.body);
    update(db, 'suppliers', rowId, { name: b.name, email: b.email, phone: b.phone, active: flag(b.active) });
    return { ok: true };
  });

  app.get('/api/products', { preHandler: anyUser }, async (req) => {
    const q = paging.extend({ q: z.string().trim().max(100).optional(), categoryId: z.coerce.number().int().positive().optional() }).parse(req.query);
    const where = ['p.organisation_id = ?'];
    const params: (string | number)[] = [req.user!.organisationId];
    if (q.q) { where.push("(p.name LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\')"); const like = `%${q.q.replace(/[\\%_]/g, '\\$&')}%`; params.push(like, like); }
    if (q.categoryId) { where.push('p.category_id = ?'); params.push(q.categoryId); }
    const rows = (db
      .prepare(
        `SELECT p.id, p.sku, p.name, p.description, p.category_id AS categoryId, c.name AS categoryName,
                p.base_unit_id AS baseUnitId, u.code AS baseUnit, p.unit_cost_cents, p.reorder_level_milli, p.active,
                COALESCE((SELECT SUM(b.quantity_milli) FROM stock_balances b WHERE b.product_id = p.id AND b.organisation_id = p.organisation_id), 0) AS total_milli
           FROM products p JOIN units_of_measure u ON u.id = p.base_unit_id
                LEFT JOIN categories c ON c.id = p.category_id
          WHERE ${where.join(' AND ')} ORDER BY p.name LIMIT ? OFFSET ?`,
      )
      .all(...params, q.limit, q.offset) as ({ id: number; unit_cost_cents: number; reorder_level_milli: number; total_milli: number } & Record<string, unknown>)[]).map(
      ({ unit_cost_cents, reorder_level_milli, total_milli, ...r }) => {
        const packagings = (db
          .prepare('SELECT g.id, g.unit_id AS unitId, u.code AS unit, g.factor_milli FROM product_packagings g JOIN units_of_measure u ON u.id = g.unit_id WHERE g.product_id = ?')
          .all(r.id) as { id: number; unitId: number; unit: string; factor_milli: number }[]).map((g) => ({
          id: g.id,
          unitId: g.unitId,
          unit: g.unit,
          factor: fromMilli(g.factor_milli),
        }));
        return {
          ...r,
          unitCost: fromCents(unit_cost_cents),
          reorderLevel: fromMilli(reorder_level_milli),
          totalStock: fromMilli(total_milli),
          packagings,
        };
      },
    );
    const total = (db.prepare(`SELECT COUNT(*) n FROM products p WHERE ${where.join(' AND ')}`).get(...params) as { n: number }).n;
    return { items: rows, total };
  });
  app.get('/api/products/:id', { preHandler: anyUser }, async (req) => {
    const { id: rowId } = idParam.parse(req.params);
    const p = db
      .prepare('SELECT p.id, p.sku, p.name, p.description, p.category_id AS categoryId, p.base_unit_id AS baseUnitId, u.code AS baseUnit, p.unit_cost_cents, p.reorder_level_milli, p.active FROM products p JOIN units_of_measure u ON u.id = p.base_unit_id WHERE p.id = ? AND p.organisation_id = ?')
      .get(rowId, req.user!.organisationId) as ({ unit_cost_cents: number; reorder_level_milli: number } & Record<string, unknown>) | undefined;
    if (!p) throw new AppError(404, 'not_found');
    const packagings = (db.prepare('SELECT g.id, g.unit_id AS unitId, u.code AS unit, g.factor_milli FROM product_packagings g JOIN units_of_measure u ON u.id = g.unit_id WHERE g.product_id = ?').all(rowId) as { id: number; unitId: number; unit: string; factor_milli: number }[]).map((g) => ({ id: g.id, unitId: g.unitId, unit: g.unit, factor: fromMilli(g.factor_milli) }));
    const { unit_cost_cents, reorder_level_milli, ...rest } = p;
    return { ...rest, unitCost: fromCents(unit_cost_cents), reorderLevel: fromMilli(reorder_level_milli), packagings };
  });
  app.post('/api/products', { preHandler: staff }, async (req, reply) => {
    const orgId = req.user!.organisationId;
    const b = z
      .object({
        sku: z.string().trim().min(1).max(60),
        name,
        description: text(500),
        categoryId: id.nullish(),
        baseUnitId: id,
        unitCost: money.default(0),
        reorderLevel: z.number().finite().min(0).max(1e9).default(0),
      })
      .strict()
      .parse(req.body);
    owned('units_of_measure', b.baseUnitId, orgId, 'unit_not_found');
    if (b.categoryId) owned('categories', b.categoryId, orgId, 'category_not_found');
    const r = db
      .prepare('INSERT INTO products (organisation_id, sku, name, description, category_id, base_unit_id, unit_cost_cents, reorder_level_milli) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(orgId, b.sku, b.name, b.description, b.categoryId ?? null, b.baseUnitId, toCents(b.unitCost), toMilli(b.reorderLevel));
    return reply.code(201).send({ id: Number(r.lastInsertRowid) });
  });
  // The SKU and base unit are fixed once created: posted history is expressed in them.
  app.patch('/api/products/:id', { preHandler: staff }, async (req) => {
    const { id: rowId } = idParam.parse(req.params);
    const orgId = req.user!.organisationId;
    owned('products', rowId, orgId, 'not_found');
    const b = z
      .object({
        name: name.optional(),
        description: text(500).optional(),
        categoryId: id.nullable().optional(),
        unitCost: money.optional(),
        reorderLevel: z.number().finite().min(0).max(1e9).optional(),
        active: z.boolean().optional(),
      })
      .strict()
      .parse(req.body);
    if (b.categoryId) owned('categories', b.categoryId, orgId, 'category_not_found');
    update(db, 'products', rowId, {
      name: b.name,
      description: b.description,
      category_id: b.categoryId,
      unit_cost_cents: b.unitCost !== undefined ? toCents(b.unitCost) : undefined,
      reorder_level_milli: b.reorderLevel !== undefined ? toMilli(b.reorderLevel) : undefined,
      active: flag(b.active),
    });
    return { ok: true };
  });
  app.post('/api/products/:id/packagings', { preHandler: staff }, async (req, reply) => {
    const { id: rowId } = idParam.parse(req.params);
    const orgId = req.user!.organisationId;
    const p = db.prepare('SELECT base_unit_id FROM products WHERE id = ? AND organisation_id = ?').get(rowId, orgId) as { base_unit_id: number } | undefined;
    if (!p) throw new AppError(404, 'not_found');
    const b = z.object({ unitId: id, factor: z.number().positive().max(1e9) }).strict().parse(req.body);
    owned('units_of_measure', b.unitId, orgId, 'unit_not_found');
    if (b.unitId === p.base_unit_id) throw new AppError(400, 'unit_is_base_unit');
    const r = db.prepare('INSERT INTO product_packagings (product_id, unit_id, factor_milli) VALUES (?, ?, ?)').run(rowId, b.unitId, toMilli(b.factor));
    return reply.code(201).send({ id: Number(r.lastInsertRowid) });
  });

  // ---------- stock postings ----------
  const idemKey = (req: FastifyRequest) => {
    const k = req.headers['idempotency-key'];
    if (typeof k !== 'string' || k.length < 8 || k.length > 100) throw new AppError(400, 'idempotency_key_required');
    return k;
  };
  const common = { reference: text(80), supplierId: id.nullish(), departmentId: id.nullish() };
  const batchFields = {
    batchNumber: text(60),
    expiryDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').nullish().transform((v) => v || null),
  };
  const line = { productId: id, warehouseId: id, unitId: id, ...batchFields };
  const lines = <T extends z.ZodRawShape>(extra: T) => z.array(z.object({ ...line, ...extra }).strict()).min(1).max(200);
  const posting: Record<
    PostableType,
    z.ZodType<{
      lines: { productId: number; warehouseId: number; unitId: number; quantity: number; toWarehouseId?: number; unitCost?: number | null; batchNumber?: string | null; expiryDate?: string | null }[];
      reason?: string | null;
      reference?: string | null;
      supplierId?: number | null;
      departmentId?: number | null;
    }>
  > = {
    receipt: z.object({ reference: common.reference, supplierId: common.supplierId, lines: lines({ quantity: qty.positive(), unitCost: money.nullish() }) }).strict(),
    issue: z.object({ reference: common.reference, departmentId: common.departmentId, lines: lines({ quantity: qty.positive() }) }).strict(),
    transfer: z.object({ reference: common.reference, lines: lines({ toWarehouseId: id, quantity: qty.positive() }) }).strict(),
    adjustment: z.object({ reference: common.reference, reason: z.string().trim().min(3).max(300), lines: lines({ quantity: qty, unitCost: money.nullish() }) }).strict(),
    count: z.object({ reference: common.reference, lines: lines({ quantity: qty.min(0) }) }).strict(),
    write_off: z.object({ reference: common.reference, departmentId: common.departmentId, reason: z.string().trim().min(3).max(300), lines: lines({ quantity: qty.positive() }) }).strict(),
  };
  const routes: [string, PostableType][] = [['receipts', 'receipt'], ['issues', 'issue'], ['transfers', 'transfer'], ['adjustments', 'adjustment'], ['counts', 'count'], ['write-offs', 'write_off']];

  for (const [path, type] of routes) {
    app.post(`/api/stock/${path}`, { preHandler: staff }, async (req, reply) => {
      const key = idemKey(req);
      const body = posting[type].parse(req.body);
      const result = postDocument(db, req.user!, {
        type,
        idempotencyKey: key,
        reference: body.reference,
        reason: body.reason,
        supplierId: body.supplierId,
        departmentId: body.departmentId,
        lines: body.lines.map((l) => ({
          productId: l.productId,
          warehouseId: l.warehouseId,
          toWarehouseId: l.toWarehouseId,
          unitId: l.unitId,
          quantityMilli: toMilli(l.quantity),
          unitCostCents: l.unitCost !== undefined && l.unitCost !== null ? toCents(l.unitCost) : null,
          batchNumber: l.batchNumber,
          expiryDate: l.expiryDate,
        })),
      });
      return reply.code(result.replayed ? 200 : 201).send({ replayed: result.replayed, document: getDocument(db, req.user!.organisationId, result.documentId) });
    });
  }

  // ---------- count-sheet workflow ----------
  app.get('/api/stock/count-sheets', { preHandler: anyUser }, async (req) => {
    const rows = db
      .prepare(
        `SELECT cs.id, cs.warehouse_id AS warehouseId, w.name AS warehouseName, cs.reference, cs.notes, cs.status,
                cs.posted_document_id AS postedDocumentId, cs.created_at AS createdAt, cs.approved_at AS approvedAt,
                (SELECT COUNT(*) FROM count_sheet_lines l WHERE l.count_sheet_id = cs.id) AS lineCount
           FROM count_sheets cs JOIN warehouses w ON w.id = cs.warehouse_id
          WHERE cs.organisation_id = ? ORDER BY cs.id DESC LIMIT 100`,
      )
      .all(req.user!.organisationId);
    return { items: rows };
  });
  app.get('/api/stock/count-sheets/:id', { preHandler: anyUser }, async (req) => {
    const { id: sheetId } = idParam.parse(req.params);
    const sheet = getCountSheet(db, req.user!.organisationId, sheetId);
    if (!sheet) throw new AppError(404, 'not_found');
    return sheet;
  });
  app.post('/api/stock/count-sheets', { preHandler: staff }, async (req, reply) => {
    const b = z
      .object({
        warehouseId: id,
        reference: text(80),
        notes: text(300),
        lines: z.array(z.object({ productId: id, unitId: id, countedQuantity: qty.min(0) }).strict()).min(1).max(200),
      })
      .strict()
      .parse(req.body);
    const sheetId = createCountSheet(db, req.user!, b);
    return reply.code(201).send(getCountSheet(db, req.user!.organisationId, sheetId));
  });
  app.post('/api/stock/count-sheets/:id/approve', { preHandler: exec }, async (req, reply) => {
    const { id: sheetId } = idParam.parse(req.params);
    const result = approveCountSheet(db, req.user!, sheetId, idemKey(req));
    return reply.code(result.replayed ? 200 : 201).send({
      replayed: result.replayed,
      sheet: getCountSheet(db, req.user!.organisationId, sheetId),
      document: getDocument(db, req.user!.organisationId, result.documentId),
    });
  });
  app.post('/api/stock/count-sheets/:id/cancel', { preHandler: staff }, async (req) => {
    const { id: sheetId } = idParam.parse(req.params);
    cancelCountSheet(db, req.user!, sheetId);
    return getCountSheet(db, req.user!.organisationId, sheetId);
  });

  // ---------- purchase orders & partial deliveries ----------
  app.get('/api/purchase-orders', { preHandler: anyUser }, async (req) => {
    const q = z
      .object({
        status: z.enum(['draft', 'approved', 'partial', 'received', 'cancelled']).optional(),
        supplierId: z.coerce.number().int().positive().optional(),
        warehouseId: z.coerce.number().int().positive().optional(),
      })
      .parse(req.query);
    const where = ['po.organisation_id = ?'];
    const params: (string | number)[] = [req.user!.organisationId];
    if (q.status) { where.push('po.status = ?'); params.push(q.status); }
    if (q.supplierId) { where.push('po.supplier_id = ?'); params.push(q.supplierId); }
    if (q.warehouseId) { where.push('po.warehouse_id = ?'); params.push(q.warehouseId); }
    const rows = (db
      .prepare(
        `SELECT po.id, po.supplier_id AS supplierId, s.name AS supplierName,
                po.warehouse_id AS warehouseId, w.name AS warehouseName,
                po.reference, po.notes, po.status, po.created_at AS createdAt, po.approved_at AS approvedAt,
                (SELECT COUNT(*) FROM purchase_order_lines l WHERE l.purchase_order_id = po.id) AS lineCount,
                COALESCE((SELECT SUM((l.ordered_milli / 1000.0) * l.unit_cost_cents) FROM purchase_order_lines l WHERE l.purchase_order_id = po.id), 0) AS total_cents
           FROM purchase_orders po
           JOIN suppliers s ON s.id = po.supplier_id
           JOIN warehouses w ON w.id = po.warehouse_id
          WHERE ${where.join(' AND ')} ORDER BY po.id DESC LIMIT 100`,
      )
      .all(...params) as ({ total_cents: number } & Record<string, unknown>)[]).map(({ total_cents, ...r }) => ({
      ...r,
      totalValue: Math.round(total_cents) / 100,
    }));
    return { items: rows };
  });
  app.get('/api/purchase-orders/:id', { preHandler: anyUser }, async (req) => {
    const { id: poId } = idParam.parse(req.params);
    const po = getPurchaseOrder(db, req.user!.organisationId, poId);
    if (!po) throw new AppError(404, 'not_found');
    return po;
  });
  app.post('/api/purchase-orders', { preHandler: staff }, async (req, reply) => {
    const b = z
      .object({
        supplierId: id,
        warehouseId: id,
        reference: z.string().trim().min(1).max(80),
        notes: text(300),
        approveImmediately: z.boolean().optional(),
        lines: z
          .array(
            z
              .object({
                productId: id,
                unitId: id,
                orderedQuantity: qty.positive(),
                unitCost: money.default(0),
              })
              .strict(),
          )
          .min(1)
          .max(200),
      })
      .strict()
      .parse(req.body);
    const poId = createPurchaseOrder(db, req.user!, b);
    return reply.code(201).send(getPurchaseOrder(db, req.user!.organisationId, poId));
  });
  app.post('/api/purchase-orders/:id/approve', { preHandler: staff }, async (req) => {
    const { id: poId } = idParam.parse(req.params);
    approvePurchaseOrder(db, req.user!, poId);
    return getPurchaseOrder(db, req.user!.organisationId, poId);
  });
  app.post('/api/purchase-orders/:id/cancel', { preHandler: staff }, async (req) => {
    const { id: poId } = idParam.parse(req.params);
    cancelPurchaseOrder(db, req.user!, poId);
    return getPurchaseOrder(db, req.user!.organisationId, poId);
  });
  app.post('/api/purchase-orders/:id/receive', { preHandler: staff }, async (req, reply) => {
    const { id: poId } = idParam.parse(req.params);
    const b = z
      .object({
        reference: text(80),
        lines: z
          .array(
            z
              .object({
                productId: id,
                quantity: qty.positive(),
                unitCost: money.nullish(),
                ...batchFields,
              })
              .strict(),
          )
          .min(1)
          .max(200),
      })
      .strict()
      .parse(req.body);
    const result = receivePurchaseOrder(db, req.user!, poId, { ...b, idempotencyKey: idemKey(req) });
    return reply.code(result.replayed ? 200 : 201).send({
      replayed: result.replayed,
      purchaseOrder: getPurchaseOrder(db, req.user!.organisationId, poId),
      document: getDocument(db, req.user!.organisationId, result.documentId),
    });
  });

  // ---------- department requisitions & internal transfer requests ----------
  app.get('/api/requisitions', { preHandler: anyUser }, async (req) => {
    const q = z
      .object({
        status: z.enum(['pending', 'fulfilled', 'rejected']).optional(),
        kind: z.enum(['department_issue', 'warehouse_transfer']).optional(),
      })
      .parse(req.query);
    const where = ['r.organisation_id = ?'];
    const params: (string | number)[] = [req.user!.organisationId];
    if (q.status) { where.push('r.status = ?'); params.push(q.status); }
    if (q.kind) { where.push('r.kind = ?'); params.push(q.kind); }
    const rows = db
      .prepare(
        `SELECT r.id, r.kind, r.warehouse_id AS warehouseId, w.name AS warehouseName,
                r.department_id AS departmentId, d.name AS departmentName,
                r.to_warehouse_id AS toWarehouseId, tw.name AS toWarehouseName,
                r.reference, r.notes, r.status, r.posted_document_id AS postedDocumentId,
                r.created_at AS createdAt, r.fulfilled_at AS fulfilledAt,
                (SELECT COUNT(*) FROM requisition_lines l WHERE l.requisition_id = r.id) AS lineCount
           FROM requisitions r
           JOIN warehouses w ON w.id = r.warehouse_id
           LEFT JOIN departments d ON d.id = r.department_id
           LEFT JOIN warehouses tw ON tw.id = r.to_warehouse_id
          WHERE ${where.join(' AND ')} ORDER BY r.id DESC LIMIT 100`,
      )
      .all(...params);
    return { items: rows };
  });
  app.get('/api/requisitions/:id', { preHandler: anyUser }, async (req) => {
    const { id: reqId } = idParam.parse(req.params);
    const r = getRequisition(db, req.user!.organisationId, reqId);
    if (!r) throw new AppError(404, 'not_found');
    return r;
  });
  app.post('/api/requisitions', { preHandler: staff }, async (req, reply) => {
    const b = z
      .object({
        kind: z.enum(['department_issue', 'warehouse_transfer']),
        warehouseId: id,
        departmentId: id.nullish(),
        toWarehouseId: id.nullish(),
        reference: text(80),
        notes: text(300),
        lines: z.array(z.object({ productId: id, unitId: id, requestedQuantity: qty.positive() }).strict()).min(1).max(200),
      })
      .strict()
      .parse(req.body);
    const reqId = createRequisition(db, req.user!, b);
    return reply.code(201).send(getRequisition(db, req.user!.organisationId, reqId));
  });
  app.post('/api/requisitions/:id/fulfill', { preHandler: staff }, async (req, reply) => {
    const { id: reqId } = idParam.parse(req.params);
    const result = fulfillRequisition(db, req.user!, reqId, idemKey(req));
    return reply.code(result.replayed ? 200 : 201).send({
      replayed: result.replayed,
      requisition: getRequisition(db, req.user!.organisationId, reqId),
      document: getDocument(db, req.user!.organisationId, result.documentId),
    });
  });
  app.post('/api/requisitions/:id/reject', { preHandler: staff }, async (req) => {
    const { id: reqId } = idParam.parse(req.params);
    const b = z.object({ reason: text(300) }).strict().parse(req.body ?? {});
    rejectRequisition(db, req.user!, reqId, b.reason);
    return getRequisition(db, req.user!.organisationId, reqId);
  });

  // ---------- stock returns ----------
  app.post('/api/stock/returns', { preHandler: staff }, async (req, reply) => {
    const b = z
      .object({
        returnType: z.enum(['from_department', 'to_supplier']),
        warehouseId: id,
        departmentId: id.nullish(),
        supplierId: id.nullish(),
        reference: text(80),
        reason: z.string().trim().min(3).max(300),
        lines: z
          .array(
            z
              .object({
                productId: id,
                unitId: id,
                quantity: qty.positive(),
                ...batchFields,
              })
              .strict(),
          )
          .min(1)
          .max(200),
      })
      .strict()
      .parse(req.body);
    const result = postReturn(db, req.user!, { ...b, idempotencyKey: idemKey(req) });
    return reply.code(result.replayed ? 200 : 201).send({
      replayed: result.replayed,
      document: getDocument(db, req.user!.organisationId, result.documentId),
    });
  });

  app.post('/api/stock/documents/:id/reverse', { preHandler: staff }, async (req, reply) => {
    const { id: docId } = idParam.parse(req.params);
    const b = z.object({ reason: z.string().trim().min(3).max(300) }).strict().parse(req.body);
    const result = reverseDocument(db, req.user!, docId, b.reason, idemKey(req));
    return reply.code(result.replayed ? 200 : 201).send({ replayed: result.replayed, document: getDocument(db, req.user!.organisationId, result.documentId) });
  });

  app.get('/api/stock/documents/:id', { preHandler: anyUser }, async (req) => {
    const { id: docId } = idParam.parse(req.params);
    const doc = getDocument(db, req.user!.organisationId, docId);
    if (!doc) throw new AppError(404, 'not_found');
    return doc;
  });

  // Branch-scoped inventory managers only see their own branch's warehouses.
  const scope = (req: FastifyRequest, column: string, params: (string | number)[]) => {
    const u = req.user!;
    if (u.role === 'inventory_manager' && u.branchId !== null) { params.push(u.branchId); return ` AND ${column} = ?`; }
    return '';
  };

  app.get('/api/stock/balances', { preHandler: anyUser }, async (req) => {
    const q = paging.extend({ productId: z.coerce.number().int().positive().optional(), warehouseId: z.coerce.number().int().positive().optional() }).parse(req.query);
    const params: (string | number)[] = [req.user!.organisationId];
    let where = 'b.organisation_id = ?';
    if (q.productId) { where += ' AND b.product_id = ?'; params.push(q.productId); }
    if (q.warehouseId) { where += ' AND b.warehouse_id = ?'; params.push(q.warehouseId); }
    where += scope(req, 'w.branch_id', params);
    const rows = (db
      .prepare(
        `SELECT b.product_id AS productId, p.sku, p.name AS productName, p.unit_cost_cents, p.reorder_level_milli,
                b.warehouse_id AS warehouseId, w.name AS warehouseName, u.code AS unit, b.quantity_milli
           FROM stock_balances b JOIN products p ON p.id = b.product_id JOIN warehouses w ON w.id = b.warehouse_id JOIN units_of_measure u ON u.id = p.base_unit_id
          WHERE ${where} ORDER BY p.name, w.name LIMIT ? OFFSET ?`,
      )
      .all(...params, q.limit, q.offset) as ({ quantity_milli: number; unit_cost_cents: number; reorder_level_milli: number } & Record<string, unknown>)[]).map(
      ({ quantity_milli, unit_cost_cents, reorder_level_milli, ...r }) => {
        const quantity = fromMilli(quantity_milli);
        const unitCost = fromCents(unit_cost_cents);
        const reorderLevel = fromMilli(reorder_level_milli);
        return {
          ...r,
          quantity,
          unitCost,
          stockValue: Math.round(quantity * unitCost * 100) / 100,
          reorderLevel,
          lowStock: reorder_level_milli > 0 && quantity_milli <= reorder_level_milli,
        };
      },
    );
    return { items: rows };
  });

  app.get('/api/stock/movements', { preHandler: anyUser }, async (req) => {
    const q = paging
      .extend({ productId: z.coerce.number().int().positive().optional(), warehouseId: z.coerce.number().int().positive().optional(), type: z.enum(['receipt', 'issue', 'transfer', 'adjustment', 'count', 'write_off', 'reversal']).optional() })
      .parse(req.query);
    const params: (string | number)[] = [req.user!.organisationId];
    let where = 'm.organisation_id = ?';
    if (q.productId) { where += ' AND m.product_id = ?'; params.push(q.productId); }
    if (q.warehouseId) { where += ' AND m.warehouse_id = ?'; params.push(q.warehouseId); }
    if (q.type) { where += ' AND d.type = ?'; params.push(q.type); }
    where += scope(req, 'w.branch_id', params);
    const rows = (db
      .prepare(
        `SELECT m.id, m.document_id AS documentId, d.type, d.reference, d.reason, d.created_at AS createdAt,
                (SELECT r.id FROM stock_documents r WHERE r.reverses_document_id = d.id) AS reversedByDocumentId,
                m.product_id AS productId, p.sku, p.name AS productName, m.warehouse_id AS warehouseId,
                w.name AS warehouseName, u.code AS unit, m.quantity_milli, m.factor_milli, m.base_delta_milli,
                m.unit_cost_cents, m.batch_number AS batchNumber, m.expiry_date AS expiryDate
           FROM stock_movements m JOIN stock_documents d ON d.id = m.document_id JOIN products p ON p.id = m.product_id
                JOIN warehouses w ON w.id = m.warehouse_id JOIN units_of_measure u ON u.id = m.unit_id
          WHERE ${where} ORDER BY m.id DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, q.limit, q.offset) as ({ quantity_milli: number; factor_milli: number; base_delta_milli: number; unit_cost_cents: number } & Record<string, unknown>)[]).map(
      ({ quantity_milli, factor_milli, base_delta_milli, unit_cost_cents, ...r }) => ({
        ...r,
        quantity: fromMilli(quantity_milli),
        factor: fromMilli(factor_milli),
        baseChange: fromMilli(base_delta_milli),
        unitCost: fromCents(unit_cost_cents),
      }),
    );
    return { items: rows };
  });

  app.get('/api/stock/verify', { preHandler: exec }, async (req) => verifyLedger(db, req.user!.organisationId));

  // ---------- inventory reports & low-stock alerts ----------
  app.get('/api/reports/inventory', { preHandler: anyUser }, async (req) => {
    const orgId = req.user!.organisationId;

    // 1. Low-stock alerts across products (product-level reorder threshold vs total and warehouse stock)
    const lowStockAlerts = (db
      .prepare(
        `SELECT p.id AS productId, p.sku, p.name AS productName, c.name AS categoryName,
                u.code AS unit, p.unit_cost_cents, p.reorder_level_milli,
                COALESCE((SELECT SUM(b.quantity_milli) FROM stock_balances b WHERE b.product_id = p.id AND b.organisation_id = p.organisation_id), 0) AS total_milli
           FROM products p
           JOIN units_of_measure u ON u.id = p.base_unit_id
           LEFT JOIN categories c ON c.id = p.category_id
          WHERE p.organisation_id = ? AND p.active = 1 AND p.reorder_level_milli > 0
            AND COALESCE((SELECT SUM(b.quantity_milli) FROM stock_balances b WHERE b.product_id = p.id AND b.organisation_id = p.organisation_id), 0) <= p.reorder_level_milli
          ORDER BY (total_milli - p.reorder_level_milli) ASC, p.name ASC`,
      )
      .all(orgId) as {
      productId: number;
      sku: string;
      productName: string;
      categoryName: string | null;
      unit: string;
      unit_cost_cents: number;
      reorder_level_milli: number;
      total_milli: number;
    }[]).map((r) => {
      const currentStock = fromMilli(r.total_milli);
      const reorderLevel = fromMilli(r.reorder_level_milli);
      const shortfall = Math.max(0, fromMilli(r.reorder_level_milli - r.total_milli));
      const unitCost = fromCents(r.unit_cost_cents);
      return {
        productId: r.productId,
        sku: r.sku,
        productName: r.productName,
        categoryName: r.categoryName ?? 'Uncategorised',
        unit: r.unit,
        currentStock,
        reorderLevel,
        shortfall,
        unitCost,
        estimatedRestockCost: Math.round(Math.max(shortfall, reorderLevel) * unitCost * 100) / 100,
      };
    });

    // 2. Stock valuation by category (from authoritative stock_balances view)
    const valuationByCategory = (db
      .prepare(
        `SELECT COALESCE(c.name, 'Uncategorised') AS categoryName,
                COUNT(DISTINCT p.id) AS productCount,
                COALESCE(SUM(b.quantity_milli), 0) AS total_milli,
                COALESCE(SUM((b.quantity_milli / 1000.0) * p.unit_cost_cents), 0) AS total_cents
           FROM products p
           LEFT JOIN categories c ON c.id = p.category_id
           LEFT JOIN stock_balances b ON b.product_id = p.id AND b.organisation_id = p.organisation_id
          WHERE p.organisation_id = ?
          GROUP BY COALESCE(c.name, 'Uncategorised')
          ORDER BY total_cents DESC, categoryName ASC`,
      )
      .all(orgId) as { categoryName: string; productCount: number; total_milli: number; total_cents: number }[]).map((r) => ({
      categoryName: r.categoryName,
      productCount: r.productCount,
      totalQuantity: fromMilli(r.total_milli),
      totalValue: Math.round(r.total_cents) / 100,
    }));

    // 3. Warehouse stock summary (from authoritative stock_balances view)
    const warehouseStockSummary = (db
      .prepare(
        `SELECT w.id AS warehouseId, w.name AS warehouseName, br.name AS branchName,
                COUNT(DISTINCT CASE WHEN b.quantity_milli > 0 THEN b.product_id END) AS skuCount,
                COALESCE(SUM(b.quantity_milli), 0) AS total_milli,
                COALESCE(SUM((b.quantity_milli / 1000.0) * p.unit_cost_cents), 0) AS total_cents
           FROM warehouses w
           JOIN branches br ON br.id = w.branch_id
           LEFT JOIN stock_balances b ON b.warehouse_id = w.id AND b.organisation_id = br.organisation_id
           LEFT JOIN products p ON p.id = b.product_id
          WHERE br.organisation_id = ?
          GROUP BY w.id, w.name, br.name
          ORDER BY total_cents DESC, w.name ASC`,
      )
      .all(orgId) as { warehouseId: number; warehouseName: string; branchName: string; skuCount: number; total_milli: number; total_cents: number }[]).map(
      (r) => ({
        warehouseId: r.warehouseId,
        warehouseName: r.warehouseName,
        branchName: r.branchName,
        skuCount: r.skuCount,
        totalQuantity: fromMilli(r.total_milli),
        totalValue: Math.round(r.total_cents) / 100,
      }),
    );

    // 4. Department consumption report (from non-reversed issue & write_off documents)
    const departmentConsumption = (db
      .prepare(
        `SELECT dep.id AS departmentId, dep.name AS departmentName, br.name AS branchName,
                COUNT(DISTINCT CASE WHEN d.type = 'issue' THEN d.id END) AS issueCount,
                COUNT(DISTINCT CASE WHEN d.type = 'write_off' THEN d.id END) AS writeOffCount,
                COALESCE(SUM(CASE WHEN d.id IS NOT NULL THEN -m.base_delta_milli ELSE 0 END), 0) AS consumed_milli,
                COALESCE(SUM(CASE WHEN d.id IS NOT NULL THEN (-m.base_delta_milli / 1000.0) * m.unit_cost_cents ELSE 0 END), 0) AS consumed_cents
           FROM departments dep
           JOIN branches br ON br.id = dep.branch_id
           LEFT JOIN stock_documents d ON d.department_id = dep.id
                 AND d.organisation_id = br.organisation_id
                 AND d.type IN ('issue', 'write_off')
                 AND NOT EXISTS (SELECT 1 FROM stock_documents rev WHERE rev.reverses_document_id = d.id)
           LEFT JOIN stock_movements m ON m.document_id = d.id
          WHERE br.organisation_id = ?
          GROUP BY dep.id, dep.name, br.name
          ORDER BY consumed_cents DESC, dep.name ASC`,
      )
      .all(orgId) as {
      departmentId: number;
      departmentName: string;
      branchName: string;
      issueCount: number;
      writeOffCount: number;
      consumed_milli: number;
      consumed_cents: number;
    }[]).map((r) => ({
      departmentId: r.departmentId,
      departmentName: r.departmentName,
      branchName: r.branchName,
      issueCount: r.issueCount,
      writeOffCount: r.writeOffCount,
      consumedQuantity: fromMilli(r.consumed_milli),
      consumedValue: Math.round(r.consumed_cents) / 100,
    }));

    // 5. Movement summary by document type
    const movementSummary = (db
      .prepare(
        `SELECT d.type, COUNT(DISTINCT d.id) AS documentCount, COUNT(m.id) AS lineCount,
                COALESCE(SUM(m.base_delta_milli), 0) AS net_delta_milli
           FROM stock_documents d
           JOIN stock_movements m ON m.document_id = d.id
          WHERE d.organisation_id = ?
          GROUP BY d.type
          ORDER BY documentCount DESC`,
      )
      .all(orgId) as { type: string; documentCount: number; lineCount: number; net_delta_milli: number }[]).map((r) => ({
      type: r.type,
      documentCount: r.documentCount,
      lineCount: r.lineCount,
      netBaseChange: fromMilli(r.net_delta_milli),
    }));

    return {
      lowStockAlerts,
      valuationByCategory,
      warehouseStockSummary,
      departmentConsumption,
      movementSummary,
    };
  });

  // ---------- Stage 4: Executive Governance, Permissions, Approvals, Audit, Notifications, Health, Backups & Exports ----------

  app.get('/api/executive/permissions', { preHandler: exec }, async (req) => {
    const orgId = req.user!.organisationId;
    const rows = db
      .prepare('SELECT permission, allowed, updated_at AS updatedAt FROM role_permissions WHERE organisation_id = ? AND role = ?')
      .all(orgId, 'inventory_manager') as { permission: string; allowed: number; updatedAt: string }[];
    const map = new Map(rows.map((r) => [r.permission, r]));
    return {
      role: 'inventory_manager',
      permissions: GRANULAR_PERMISSIONS.map((p) => ({
        key: p.key,
        label: p.label,
        description: p.description,
        allowed: map.has(p.key) ? map.get(p.key)!.allowed === 1 : true,
        updatedAt: map.get(p.key)?.updatedAt ?? null,
      })),
    };
  });

  app.patch('/api/executive/permissions', { preHandler: exec }, async (req) => {
    const orgId = req.user!.organisationId;
    const b = z
      .object({
        permissions: z
          .object({
            can_approve_po: z.boolean().optional(),
            can_fulfill_requisitions: z.boolean().optional(),
            can_write_off_stock: z.boolean().optional(),
            can_export_reports: z.boolean().optional(),
          })
          .strict(),
      })
      .strict()
      .parse(req.body);
    const stmt = db.prepare(
      `INSERT INTO role_permissions (organisation_id, role, permission, allowed, updated_at)
       VALUES (?, 'inventory_manager', ?, ?, datetime('now'))
       ON CONFLICT(organisation_id, role, permission) DO UPDATE SET allowed = excluded.allowed, updated_at = datetime('now')`,
    );
    for (const [k, v] of Object.entries(b.permissions)) {
      if (v !== undefined) stmt.run(orgId, k as GranularPermission, v ? 1 : 0);
    }
    recordAudit(db, req.user!, 'role_permissions.update', 'role_permissions', 'inventory_manager', b.permissions);
    return { ok: true };
  });

  app.get('/api/executive/approvals', { preHandler: exec }, async (req) => {
    const orgId = req.user!.organisationId;
    const draftPurchaseOrders = (db
      .prepare(
        `SELECT po.id, po.reference, po.notes, po.status, po.created_at AS createdAt,
                s.name AS supplierName, w.name AS warehouseName,
                po.created_by AS createdById, u.name AS createdByName,
                (SELECT COUNT(*) FROM purchase_order_lines l WHERE l.purchase_order_id = po.id) AS lineCount,
                COALESCE((SELECT SUM((l.ordered_milli / 1000.0) * l.unit_cost_cents) FROM purchase_order_lines l WHERE l.purchase_order_id = po.id), 0) AS total_cents
           FROM purchase_orders po
           JOIN suppliers s ON s.id = po.supplier_id
           JOIN warehouses w ON w.id = po.warehouse_id
           LEFT JOIN users u ON u.id = po.created_by
          WHERE po.organisation_id = ? AND po.status = 'draft'
          ORDER BY po.id DESC`,
      )
      .all(orgId) as ({ total_cents: number } & Record<string, unknown>)[]).map(({ total_cents, ...r }) => ({
      ...r,
      totalValue: Math.round(total_cents) / 100,
    }));

    const pendingRequisitions = db
      .prepare(
        `SELECT r.id, r.kind, r.reference, r.notes, r.status, r.created_at AS createdAt,
                w.name AS warehouseName, d.name AS departmentName, tw.name AS toWarehouseName,
                r.created_by AS createdById, u.name AS createdByName,
                (SELECT COUNT(*) FROM requisition_lines l WHERE l.requisition_id = r.id) AS lineCount
           FROM requisitions r
           JOIN warehouses w ON w.id = r.warehouse_id
           LEFT JOIN departments d ON d.id = r.department_id
           LEFT JOIN warehouses tw ON tw.id = r.to_warehouse_id
           LEFT JOIN users u ON u.id = r.created_by
          WHERE r.organisation_id = ? AND r.status = 'pending'
          ORDER BY r.id DESC`,
      )
      .all(orgId);

    const draftCountSheets = db
      .prepare(
        `SELECT cs.id, cs.reference, cs.notes, cs.status, cs.created_at AS createdAt,
                w.name AS warehouseName, cs.created_by AS createdById, u.name AS createdByName,
                (SELECT COUNT(*) FROM count_sheet_lines l WHERE l.count_sheet_id = cs.id) AS lineCount,
                (SELECT COUNT(*) FROM count_sheet_lines l WHERE l.count_sheet_id = cs.id AND l.counted_milli != l.expected_milli) AS varianceCount
           FROM count_sheets cs
           JOIN warehouses w ON w.id = cs.warehouse_id
           LEFT JOIN users u ON u.id = cs.created_by
          WHERE cs.organisation_id = ? AND cs.status = 'draft'
          ORDER BY cs.id DESC`,
      )
      .all(orgId);

    return {
      draftPurchaseOrders,
      pendingRequisitions,
      draftCountSheets,
      totalPending: draftPurchaseOrders.length + pendingRequisitions.length + draftCountSheets.length,
    };
  });

  app.get('/api/executive/audit-logs', { preHandler: exec }, async (req) => {
    const q = paging.extend({ action: z.string().trim().max(80).optional() }).parse(req.query);
    const orgId = req.user!.organisationId;
    const where = ['organisation_id = ?'];
    const params: (string | number)[] = [orgId];
    if (q.action) {
      where.push('action = ?');
      params.push(q.action);
    }
    const items = (db
      .prepare(
        `SELECT id, actor_id AS actorId, actor_email AS actorEmail, actor_role AS actorRole,
                action, target_type AS targetType, target_id AS targetId, details_json, created_at AS createdAt
           FROM audit_logs
          WHERE ${where.join(' AND ')}
          ORDER BY id DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, q.limit, q.offset) as ({ details_json: string | null } & Record<string, unknown>)[]).map(({ details_json, ...r }) => ({
      ...r,
      details: details_json ? JSON.parse(details_json) : null,
    }));
    const total = (db.prepare(`SELECT COUNT(*) n FROM audit_logs WHERE ${where.join(' AND ')}`).get(...params) as { n: number }).n;
    return { items, total };
  });

  app.get('/api/notifications', { preHandler: anyUser }, async (req) => {
    const orgId = req.user!.organisationId;
    const items: {
      id: string;
      severity: 'critical' | 'warning' | 'info';
      category: 'low_stock' | 'expiry' | 'approval' | 'security' | 'backup';
      title: string;
      message: string;
      link: string;
    }[] = [];

    const lowStock = db
      .prepare(
        `SELECT p.id, p.sku, p.name, u.code AS unit, p.reorder_level_milli,
                COALESCE((SELECT SUM(b.quantity_milli) FROM stock_balances b WHERE b.product_id = p.id AND b.organisation_id = p.organisation_id), 0) AS total_milli
           FROM products p JOIN units_of_measure u ON u.id = p.base_unit_id
          WHERE p.organisation_id = ? AND p.active = 1 AND p.reorder_level_milli > 0
            AND COALESCE((SELECT SUM(b.quantity_milli) FROM stock_balances b WHERE b.product_id = p.id AND b.organisation_id = p.organisation_id), 0) <= p.reorder_level_milli
          ORDER BY total_milli ASC LIMIT 10`,
      )
      .all(orgId) as { id: number; sku: string; name: string; unit: string; reorder_level_milli: number; total_milli: number }[];

    for (const p of lowStock) {
      const portalPrefix = req.user!.role === 'executive_manager' ? '/executive' : '/inventory';
      items.push({
        id: `low-stock-${p.id}`,
        severity: p.total_milli <= 0 ? 'critical' : 'warning',
        category: 'low_stock',
        title: p.total_milli <= 0 ? `Out of Stock: ${p.sku}` : `Low Stock Alert: ${p.sku}`,
        message: `${p.name} has ${fromMilli(p.total_milli)} ${p.unit} remaining (reorder threshold: ${fromMilli(p.reorder_level_milli)} ${p.unit}).`,
        link: `${portalPrefix}/reports`,
      });
    }

    const expiringBatches = db
      .prepare(
        `SELECT m.batch_number AS batchNumber, m.expiry_date AS expiryDate, p.sku, p.name AS productName
           FROM stock_movements m
           JOIN products p ON p.id = m.product_id
          WHERE m.organisation_id = ? AND m.expiry_date IS NOT NULL
            AND m.expiry_date <= date('now', '+30 days')
            AND m.base_delta_milli > 0
          GROUP BY m.batch_number, m.expiry_date, p.sku, p.name
          ORDER BY m.expiry_date ASC LIMIT 5`,
      )
      .all(orgId) as { batchNumber: string | null; expiryDate: string; sku: string; productName: string }[];

    for (const b of expiringBatches) {
      const portalPrefix = req.user!.role === 'executive_manager' ? '/executive' : '/inventory';
      items.push({
        id: `expiry-${b.sku}-${b.batchNumber ?? 'batch'}-${b.expiryDate}`,
        severity: 'warning',
        category: 'expiry',
        title: `Batch Expiry Within 30 Days: ${b.sku}`,
        message: `${b.productName} (Batch ${b.batchNumber ?? 'N/A'}) expires on ${b.expiryDate}.`,
        link: `${portalPrefix}/operations`,
      });
    }

    const draftPOs = (db.prepare("SELECT COUNT(*) n FROM purchase_orders WHERE organisation_id = ? AND status = 'draft'").get(orgId) as { n: number }).n;
    const pendingReqs = (db.prepare("SELECT COUNT(*) n FROM requisitions WHERE organisation_id = ? AND status = 'pending'").get(orgId) as { n: number }).n;
    const draftCounts = (db.prepare("SELECT COUNT(*) n FROM count_sheets WHERE organisation_id = ? AND status = 'draft'").get(orgId) as { n: number }).n;
    const totalPending = draftPOs + pendingReqs + draftCounts;

    if (totalPending > 0) {
      items.push({
        id: 'pending-approvals',
        severity: draftCounts > 0 ? 'warning' : 'info',
        category: 'approval',
        title: `${totalPending} Pending Approval${totalPending === 1 ? '' : 's'}`,
        message: `${draftPOs} draft PO(s), ${pendingReqs} requisition(s), and ${draftCounts} stocktake sheet(s) awaiting review.`,
        link: req.user!.role === 'executive_manager' ? '/executive/organisation' : '/inventory/procurement',
      });
    }

    if (req.user!.role === 'executive_manager') {
      const lockedUsers = (db.prepare("SELECT COUNT(*) n FROM users WHERE organisation_id = ? AND locked_until > datetime('now')").get(orgId) as { n: number }).n;
      if (lockedUsers > 0) {
        items.push({
          id: 'locked-users',
          severity: 'critical',
          category: 'security',
          title: `${lockedUsers} Locked User Account${lockedUsers === 1 ? '' : 's'}`,
          message: `${lockedUsers} user account(s) are currently locked due to failed sign-in attempts.`,
          link: '/executive/organisation',
        });
      }

      const backupCount = (db.prepare('SELECT COUNT(*) n FROM system_backups WHERE organisation_id = ?').get(orgId) as { n: number }).n;
      if (backupCount === 0) {
        items.push({
          id: 'no-backup',
          severity: 'info',
          category: 'backup',
          title: 'No Verified System Snapshot Yet',
          message: 'Create a verified SHA-256 recovery snapshot in Executive Governance -> System Health & Backups.',
          link: '/executive/organisation',
        });
      }
    }

    return {
      items,
      unreadCount: items.length,
    };
  });

  app.get('/api/executive/system-health', { preHandler: exec }, async (req) => {
    const orgId = req.user!.organisationId;
    const ledger = verifyLedger(db, orgId);
    const activeSessions = (db.prepare("SELECT COUNT(*) n FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.organisation_id = ? AND s.expires_at > datetime('now')").get(orgId) as { n: number }).n;
    const lockedUsers = (db.prepare("SELECT COUNT(*) n FROM users WHERE organisation_id = ? AND locked_until > datetime('now')").get(orgId) as { n: number }).n;
    const lastBackup = db
      .prepare('SELECT id, label, checksum_sha256 AS checksumSha256, size_bytes AS sizeBytes, status, created_at AS createdAt, restored_at AS restoredAt FROM system_backups WHERE organisation_id = ? ORDER BY id DESC LIMIT 1')
      .get(orgId) as Record<string, unknown> | undefined;

    const tableCounts = {
      users: (db.prepare('SELECT COUNT(*) n FROM users WHERE organisation_id = ?').get(orgId) as { n: number }).n,
      branches: (db.prepare('SELECT COUNT(*) n FROM branches WHERE organisation_id = ?').get(orgId) as { n: number }).n,
      warehouses: (db.prepare('SELECT COUNT(*) n FROM warehouses w JOIN branches b ON b.id = w.branch_id WHERE b.organisation_id = ?').get(orgId) as { n: number }).n,
      departments: (db.prepare('SELECT COUNT(*) n FROM departments d JOIN branches b ON b.id = d.branch_id WHERE b.organisation_id = ?').get(orgId) as { n: number }).n,
      products: (db.prepare('SELECT COUNT(*) n FROM products WHERE organisation_id = ?').get(orgId) as { n: number }).n,
      stockDocuments: (db.prepare('SELECT COUNT(*) n FROM stock_documents WHERE organisation_id = ?').get(orgId) as { n: number }).n,
      stockMovements: (db.prepare('SELECT COUNT(*) n FROM stock_movements WHERE organisation_id = ?').get(orgId) as { n: number }).n,
      purchaseOrders: (db.prepare('SELECT COUNT(*) n FROM purchase_orders WHERE organisation_id = ?').get(orgId) as { n: number }).n,
      requisitions: (db.prepare('SELECT COUNT(*) n FROM requisitions WHERE organisation_id = ?').get(orgId) as { n: number }).n,
      auditLogs: (db.prepare('SELECT COUNT(*) n FROM audit_logs WHERE organisation_id = ?').get(orgId) as { n: number }).n,
      backups: (db.prepare('SELECT COUNT(*) n FROM system_backups WHERE organisation_id = ?').get(orgId) as { n: number }).n,
    };

    return {
      status: ledger.ok ? 'healthy' : 'degraded',
      databaseConnected: true,
      ledgerIntegrity: ledger,
      activeSessions,
      lockedUsers,
      lastBackup: lastBackup ?? null,
      tableCounts,
      uptimeSeconds: Math.round(process.uptime()),
      checkedAt: new Date().toISOString(),
    };
  });

  app.get('/api/executive/backups', { preHandler: exec }, async (req) => {
    const orgId = req.user!.organisationId;
    const items = db
      .prepare(
        `SELECT b.id, b.label, b.checksum_sha256 AS checksumSha256, b.size_bytes AS sizeBytes,
                b.status, b.created_by AS createdBy, u.name AS createdByName,
                b.created_at AS createdAt, b.restored_at AS restoredAt
           FROM system_backups b
           LEFT JOIN users u ON u.id = b.created_by
          WHERE b.organisation_id = ?
          ORDER BY b.id DESC LIMIT 50`,
      )
      .all(orgId);
    return { items };
  });

  app.post('/api/executive/backups', { preHandler: exec }, async (req, reply) => {
    const b = z.object({ label: z.string().trim().min(2).max(120) }).strict().parse(req.body);
    const created = createSystemBackup(db, req.user!, b.label);
    return reply.code(201).send(created);
  });

  app.post('/api/executive/backups/:id/verify', { preHandler: exec }, async (req) => {
    const { id: backupId } = idParam.parse(req.params);
    const res = verifySystemBackup(db, req.user!.organisationId, backupId);
    recordAudit(db, req.user!, 'backup.verify', 'system_backup', backupId, { checksumMatch: res.checksumMatch, readyForRestore: res.readyForRestore });
    return res;
  });

  app.post('/api/executive/backups/:id/restore', { preHandler: exec }, async (req) => {
    const { id: backupId } = idParam.parse(req.params);
    const b = z.object({ confirmationPhrase: z.string().trim().min(1).max(60) }).strict().parse(req.body);
    return restoreSystemBackup(db, req.user!, backupId, b.confirmationPhrase);
  });

  app.get('/api/reports/export', { preHandler: anyUser }, async (req, reply) => {
    const q = z
      .object({
        section: z.enum(['valuation', 'low_stock', 'movements', 'audit_logs']).default('valuation'),
        format: z.enum(['csv', 'json']).default('csv'),
      })
      .parse(req.query);

    if (!hasPermission(db, req.user!, 'can_export_reports')) {
      throw new AppError(403, 'forbidden_permission');
    }
    if (q.section === 'audit_logs' && req.user!.role !== 'executive_manager') {
      throw new AppError(403, 'forbidden');
    }

    const orgId = req.user!.organisationId;
    let rows: Record<string, unknown>[] = [];

    if (q.section === 'valuation') {
      rows = (db
        .prepare(
          `SELECT p.sku AS SKU, p.name AS Product, COALESCE(c.name, 'Uncategorised') AS Category,
                  u.code AS Unit, p.unit_cost_cents, p.reorder_level_milli,
                  COALESCE((SELECT SUM(b.quantity_milli) FROM stock_balances b WHERE b.product_id = p.id AND b.organisation_id = p.organisation_id), 0) AS total_milli
             FROM products p
             JOIN units_of_measure u ON u.id = p.base_unit_id
             LEFT JOIN categories c ON c.id = p.category_id
            WHERE p.organisation_id = ?
            ORDER BY p.name ASC`,
        )
        .all(orgId) as { SKU: string; Product: string; Category: string; Unit: string; unit_cost_cents: number; reorder_level_milli: number; total_milli: number }[]).map((r) => {
        const qtyVal = fromMilli(r.total_milli);
        const unitCost = fromCents(r.unit_cost_cents);
        return {
          SKU: r.SKU,
          Product: r.Product,
          Category: r.Category,
          Unit: r.Unit,
          Quantity: qtyVal,
          UnitCost: unitCost,
          TotalValue: Math.round(qtyVal * unitCost * 100) / 100,
          ReorderLevel: fromMilli(r.reorder_level_milli),
        };
      });
    } else if (q.section === 'low_stock') {
      rows = (db
        .prepare(
          `SELECT p.sku AS SKU, p.name AS Product, COALESCE(c.name, 'Uncategorised') AS Category,
                  u.code AS Unit, p.unit_cost_cents, p.reorder_level_milli,
                  COALESCE((SELECT SUM(b.quantity_milli) FROM stock_balances b WHERE b.product_id = p.id AND b.organisation_id = p.organisation_id), 0) AS total_milli
             FROM products p
             JOIN units_of_measure u ON u.id = p.base_unit_id
             LEFT JOIN categories c ON c.id = p.category_id
            WHERE p.organisation_id = ? AND p.active = 1 AND p.reorder_level_milli > 0
              AND COALESCE((SELECT SUM(b.quantity_milli) FROM stock_balances b WHERE b.product_id = p.id AND b.organisation_id = p.organisation_id), 0) <= p.reorder_level_milli
            ORDER BY total_milli ASC`,
        )
        .all(orgId) as { SKU: string; Product: string; Category: string; Unit: string; unit_cost_cents: number; reorder_level_milli: number; total_milli: number }[]).map((r) => ({
        SKU: r.SKU,
        Product: r.Product,
        Category: r.Category,
        Unit: r.Unit,
        CurrentStock: fromMilli(r.total_milli),
        ReorderLevel: fromMilli(r.reorder_level_milli),
        Shortfall: Math.max(0, fromMilli(r.reorder_level_milli - r.total_milli)),
        UnitCost: fromCents(r.unit_cost_cents),
      }));
    } else if (q.section === 'movements') {
      rows = (db
        .prepare(
          `SELECT m.id AS MovementId, d.id AS DocumentId, d.type AS Type, d.reference AS Reference,
                  p.sku AS SKU, p.name AS Product, w.name AS Warehouse, u.code AS Unit,
                  m.base_delta_milli, m.unit_cost_cents, d.created_at AS CreatedAt
             FROM stock_movements m
             JOIN stock_documents d ON d.id = m.document_id
             JOIN products p ON p.id = m.product_id
             JOIN warehouses w ON w.id = m.warehouse_id
             JOIN units_of_measure u ON u.id = m.unit_id
            WHERE m.organisation_id = ?
            ORDER BY m.id DESC LIMIT 500`,
        )
        .all(orgId) as ({ base_delta_milli: number; unit_cost_cents: number } & Record<string, unknown>)[]).map(({ base_delta_milli, unit_cost_cents, ...r }) => ({
        ...r,
        BaseChange: fromMilli(base_delta_milli),
        UnitCost: fromCents(unit_cost_cents),
      }));
    } else if (q.section === 'audit_logs') {
      rows = db
        .prepare(
          `SELECT id AS AuditId, actor_email AS ActorEmail, actor_role AS ActorRole,
                  action AS Action, target_type AS TargetType, target_id AS TargetId,
                  details_json AS Details, created_at AS CreatedAt
             FROM audit_logs
            WHERE organisation_id = ?
            ORDER BY id DESC LIMIT 500`,
        )
        .all(orgId) as Record<string, unknown>[];
    }

    recordAudit(db, req.user!, 'report.export', 'report', q.section, { format: q.format, rowCount: rows.length });

    if (q.format === 'json') {
      return { section: q.section, format: 'json', generatedAt: new Date().toISOString(), items: rows };
    }

    const headers = rows.length > 0 ? Object.keys(rows[0]!) : ['section'];
    const escapeCsv = (val: unknown) => {
      const s = val === null || val === undefined ? '' : String(val);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csvLines = [headers.join(','), ...rows.map((r) => headers.map((h) => escapeCsv(r[h])).join(','))];
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="stockroom-${q.section}.csv"`);
    return reply.send(csvLines.join('\n'));
  });
}
