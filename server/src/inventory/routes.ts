import { createHash } from 'node:crypto';
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
      .prepare('SELECT id, name, allow_negative_stock, enforce_separation_of_duties, po_approval_threshold_cents, currency_code, pos_department_id, initialized_at FROM organisations WHERE id = ?')
      .get(req.user!.organisationId) as {
      id: number;
      name: string;
      allow_negative_stock: number;
      enforce_separation_of_duties: number;
      po_approval_threshold_cents: number;
      currency_code: string;
      pos_department_id: number | null;
      initialized_at: string | null;
    };
    let posDeptName = null;
    if (o.pos_department_id) {
      const d = db.prepare('SELECT name FROM departments WHERE id = ?').get(o.pos_department_id) as { name: string } | undefined;
      posDeptName = d?.name ?? null;
    }
    return {
      id: o.id,
      name: o.name,
      allowNegativeStock: !!o.allow_negative_stock,
      enforceSeparationOfDuties: !!o.enforce_separation_of_duties,
      poApprovalThreshold: fromCents(o.po_approval_threshold_cents ?? 0),
      currencyCode: o.currency_code ?? 'USD',
      posDepartmentId: o.pos_department_id,
      posDepartmentName: posDeptName,
      initializedAt: o.initialized_at,
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
        posDepartmentId: id.nullable().optional(),
      })
      .strict()
      .parse(req.body);
    if (b.posDepartmentId !== undefined && b.posDepartmentId !== null) {
      owned('departments', b.posDepartmentId, req.user!.organisationId, 'department_not_found');
    }
    update(db, 'organisations', req.user!.organisationId, {
      name: b.name,
      allow_negative_stock: flag(b.allowNegativeStock),
      enforce_separation_of_duties: flag(b.enforceSeparationOfDuties),
      po_approval_threshold_cents: b.poApprovalThreshold !== undefined ? toCents(b.poApprovalThreshold) : undefined,
      currency_code: b.currencyCode,
      pos_department_id: b.posDepartmentId,
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

  // ---------- organisation structure (executive manages; everyone signed in can read within their branch scope) ----------
  app.get('/api/branches', { preHandler: anyUser }, async (req) => {
    const u = req.user!;
    if (u.role === 'inventory_manager' && u.branchId !== null) {
      return db.prepare('SELECT id, name, city, active FROM branches WHERE organisation_id = ? AND id = ? ORDER BY name').all(u.organisationId, u.branchId);
    }
    return db.prepare('SELECT id, name, city, active FROM branches WHERE organisation_id = ? ORDER BY name').all(u.organisationId);
  });
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
    app.get(`/api/${table}`, { preHandler: anyUser }, async (req) => {
      const u = req.user!;
      if (u.role === 'inventory_manager' && u.branchId !== null) {
        return db
          .prepare(
            `SELECT t.id, t.branch_id AS branchId, b.name AS branchName, t.name, t.active
               FROM ${table} t JOIN branches b ON b.id = t.branch_id
              WHERE b.organisation_id = ? AND t.branch_id = ? ORDER BY t.name`,
          )
          .all(u.organisationId, u.branchId);
      }
      return db
        .prepare(`SELECT t.id, t.branch_id AS branchId, b.name AS branchName, t.name, t.active FROM ${table} t JOIN branches b ON b.id = t.branch_id WHERE b.organisation_id = ? ORDER BY t.name`)
        .all(u.organisationId);
    });
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
    const q = paging
      .extend({
        q: z.string().trim().max(100).optional(),
        categoryId: z.coerce.number().int().positive().optional(),
        departmentId: z.coerce.number().int().positive().optional(),
      })
      .parse(req.query);
    const where = ['p.organisation_id = ?'];
    const params: (string | number)[] = [req.user!.organisationId];
    if (q.q) { where.push("(p.name LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\')"); const like = `%${q.q.replace(/[\\%_]/g, '\\$&')}%`; params.push(like, like); }
    if (q.categoryId) { where.push('p.category_id = ?'); params.push(q.categoryId); }
    if (q.departmentId) { where.push('p.department_id = ?'); params.push(q.departmentId); }
    const rows = (db
      .prepare(
        `SELECT p.id, p.sku, p.name, p.description, p.category_id AS categoryId, c.name AS categoryName,
                p.department_id AS departmentId, dep.name AS departmentName,
                p.base_unit_id AS baseUnitId, u.code AS baseUnit, p.unit_cost_cents, p.selling_price_cents, p.wholesale_price_cents, p.vat_category AS vatCategory,
                p.reorder_level_milli, p.active,
                COALESCE((SELECT SUM(b.quantity_milli) FROM stock_balances b WHERE b.product_id = p.id AND b.organisation_id = p.organisation_id), 0) AS total_milli
           FROM products p JOIN units_of_measure u ON u.id = p.base_unit_id
                LEFT JOIN categories c ON c.id = p.category_id
                LEFT JOIN departments dep ON dep.id = p.department_id
          WHERE ${where.join(' AND ')} ORDER BY p.name LIMIT ? OFFSET ?`,
      )
      .all(...params, q.limit, q.offset) as ({
        id: number;
        unit_cost_cents: number;
        selling_price_cents: number;
        wholesale_price_cents: number;
        reorder_level_milli: number;
        total_milli: number;
      } & Record<string, unknown>)[]).map(
      ({ unit_cost_cents, selling_price_cents, wholesale_price_cents, reorder_level_milli, total_milli, ...r }) => {
        const packagings = (db
          .prepare('SELECT g.id, g.unit_id AS unitId, u.code AS unit, g.factor_milli FROM product_packagings g JOIN units_of_measure u ON u.id = g.unit_id WHERE g.product_id = ?')
          .all(r.id) as { id: number; unitId: number; unit: string; factor_milli: number }[]).map((g) => ({
          id: g.id,
          unitId: g.unitId,
          unit: g.unit,
          factor: fromMilli(g.factor_milli),
        }));
        const unitCost = fromCents(unit_cost_cents);
        const sellingPrice = selling_price_cents > 0 ? fromCents(selling_price_cents) : Math.round(unitCost * 1.3 * 100) / 100;
        const wholesalePrice = wholesale_price_cents > 0 ? fromCents(wholesale_price_cents) : Math.round(unitCost * 1.15 * 100) / 100;
        return {
          ...r,
          unitCost,
          sellingPrice,
          wholesalePrice,
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
      .prepare(
        `SELECT p.id, p.sku, p.name, p.description, p.category_id AS categoryId, p.department_id AS departmentId, dep.name AS departmentName,
                p.base_unit_id AS baseUnitId, u.code AS baseUnit, p.unit_cost_cents, p.selling_price_cents, p.wholesale_price_cents, p.vat_category AS vatCategory,
                p.reorder_level_milli, p.active
           FROM products p JOIN units_of_measure u ON u.id = p.base_unit_id
                LEFT JOIN departments dep ON dep.id = p.department_id
          WHERE p.id = ? AND p.organisation_id = ?`,
      )
      .get(rowId, req.user!.organisationId) as ({
        unit_cost_cents: number;
        selling_price_cents: number;
        wholesale_price_cents: number;
        reorder_level_milli: number;
      } & Record<string, unknown>) | undefined;
    if (!p) throw new AppError(404, 'not_found');
    const packagings = (db.prepare('SELECT g.id, g.unit_id AS unitId, u.code AS unit, g.factor_milli FROM product_packagings g JOIN units_of_measure u ON u.id = g.unit_id WHERE g.product_id = ?').all(rowId) as { id: number; unitId: number; unit: string; factor_milli: number }[]).map((g) => ({ id: g.id, unitId: g.unitId, unit: g.unit, factor: fromMilli(g.factor_milli) }));
    const { unit_cost_cents, selling_price_cents, wholesale_price_cents, reorder_level_milli, ...rest } = p;
    const unitCost = fromCents(unit_cost_cents);
    return {
      ...rest,
      unitCost,
      sellingPrice: selling_price_cents > 0 ? fromCents(selling_price_cents) : Math.round(unitCost * 1.3 * 100) / 100,
      wholesalePrice: wholesale_price_cents > 0 ? fromCents(wholesale_price_cents) : Math.round(unitCost * 1.15 * 100) / 100,
      reorderLevel: fromMilli(reorder_level_milli),
      packagings,
    };
  });
  app.post('/api/products', { preHandler: staff }, async (req, reply) => {
    const orgId = req.user!.organisationId;
    const b = z
      .object({
        sku: z.string().trim().min(1).max(60),
        name,
        description: text(500),
        categoryId: id.nullish(),
        departmentId: id.nullish(),
        baseUnitId: id,
        unitCost: money.default(0),
        sellingPrice: money.optional(),
        wholesalePrice: money.optional(),
        vatCategory: z.enum(['standard_15', 'zero_rated', 'exempt']).default('standard_15'),
        reorderLevel: z.number().finite().min(0).max(1e9).default(0),
      })
      .strict()
      .parse(req.body);
    owned('units_of_measure', b.baseUnitId, orgId, 'unit_not_found');
    if (b.categoryId) owned('categories', b.categoryId, orgId, 'category_not_found');
    if (b.departmentId) {
      if (!db.prepare('SELECT 1 FROM departments d JOIN branches br ON br.id = d.branch_id WHERE d.id = ? AND br.organisation_id = ?').get(b.departmentId, orgId)) {
        throw new AppError(400, 'department_not_found');
      }
    }
    const unitCostCents = toCents(b.unitCost);
    const sellingPriceCents = b.sellingPrice !== undefined ? toCents(b.sellingPrice) : Math.round(unitCostCents * 1.3);
    const wholesalePriceCents = b.wholesalePrice !== undefined ? toCents(b.wholesalePrice) : Math.round(unitCostCents * 1.15);
    const r = db
      .prepare(
        `INSERT INTO products (organisation_id, sku, name, description, category_id, department_id, base_unit_id, unit_cost_cents, selling_price_cents, wholesale_price_cents, vat_category, reorder_level_milli)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        orgId,
        b.sku,
        b.name,
        b.description,
        b.categoryId ?? null,
        b.departmentId ?? null,
        b.baseUnitId,
        unitCostCents,
        sellingPriceCents,
        wholesalePriceCents,
        b.vatCategory,
        toMilli(b.reorderLevel),
      );
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
        departmentId: id.nullable().optional(),
        unitCost: money.optional(),
        sellingPrice: money.optional(),
        wholesalePrice: money.optional(),
        vatCategory: z.enum(['standard_15', 'zero_rated', 'exempt']).optional(),
        reorderLevel: z.number().finite().min(0).max(1e9).optional(),
        active: z.boolean().optional(),
      })
      .strict()
      .parse(req.body);
    if (b.categoryId) owned('categories', b.categoryId, orgId, 'category_not_found');
    if (b.departmentId) {
      if (!db.prepare('SELECT 1 FROM departments d JOIN branches br ON br.id = d.branch_id WHERE d.id = ? AND br.organisation_id = ?').get(b.departmentId, orgId)) {
        throw new AppError(400, 'department_not_found');
      }
    }
    update(db, 'products', rowId, {
      name: b.name,
      description: b.description,
      category_id: b.categoryId,
      department_id: b.departmentId,
      unit_cost_cents: b.unitCost !== undefined ? toCents(b.unitCost) : undefined,
      selling_price_cents: b.sellingPrice !== undefined ? toCents(b.sellingPrice) : undefined,
      wholesale_price_cents: b.wholesalePrice !== undefined ? toCents(b.wholesalePrice) : undefined,
      vat_category: b.vatCategory,
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
      lines: {
        productId: number;
        warehouseId: number;
        unitId: number;
        quantity: number;
        toWarehouseId?: number;
        unitCost?: number | null;
        unitSellingPrice?: number | null;
        tenderType?: string | null;
        batchNumber?: string | null;
        expiryDate?: string | null;
      }[];
      reason?: string | null;
      reference?: string | null;
      supplierId?: number | null;
      departmentId?: number | null;
    }>
  > = {
    receipt: z.object({ reference: common.reference, supplierId: common.supplierId, lines: lines({ quantity: qty.positive(), unitCost: money.nullish() }) }).strict(),
    issue: z.object({ reference: common.reference, departmentId: common.departmentId, lines: lines({ quantity: qty.positive(), unitSellingPrice: money.nullish(), tenderType: text(40) }) }).strict(),
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
          unitSellingPriceCents: l.unitSellingPrice !== undefined && l.unitSellingPrice !== null ? toCents(l.unitSellingPrice) : null,
          tenderType: l.tenderType ?? null,
          batchNumber: l.batchNumber,
          expiryDate: l.expiryDate,
        })),
      });
      return reply.code(result.replayed ? 200 : 201).send({ replayed: result.replayed, document: getDocument(db, req.user!.organisationId, result.documentId) });
    });
  }

  // Branch-scoped inventory managers only see their own branch's warehouses.
  const scope = (req: FastifyRequest, column: string, params: (string | number)[]) => {
    const u = req.user!;
    if (u.role === 'inventory_manager' && u.branchId !== null) { params.push(u.branchId); return ` AND ${column} = ?`; }
    return '';
  };

  // ---------- count-sheet workflow ----------
  app.get('/api/stock/count-sheets', { preHandler: anyUser }, async (req) => {
    const params: (string | number)[] = [req.user!.organisationId];
    const branchWhere = scope(req, 'w.branch_id', params);
    const rows = db
      .prepare(
        `SELECT cs.id, cs.warehouse_id AS warehouseId, w.name AS warehouseName, cs.reference, cs.notes, cs.status,
                cs.posted_document_id AS postedDocumentId, cs.created_by AS createdBy, cs.approved_by AS approvedBy,
                cs.decided_by AS decidedBy, cs.decision_reason AS decisionReason,
                cs.created_at AS createdAt, cs.approved_at AS approvedAt, cs.decided_at AS decidedAt,
                (SELECT COUNT(*) FROM count_sheet_lines l WHERE l.count_sheet_id = cs.id) AS lineCount
           FROM count_sheets cs JOIN warehouses w ON w.id = cs.warehouse_id
          WHERE cs.organisation_id = ?${branchWhere} ORDER BY cs.id DESC LIMIT 100`,
      )
      .all(...params);
    return { items: rows };
  });
  app.get('/api/stock/count-sheets/:id', { preHandler: anyUser }, async (req) => {
    const { id: sheetId } = idParam.parse(req.params);
    const sheet = getCountSheet(db, req.user!.organisationId, sheetId);
    if (!sheet) throw new AppError(404, 'not_found');
    if (req.user!.role === 'inventory_manager' && req.user!.branchId !== null) {
      const wh = db.prepare('SELECT branch_id FROM warehouses WHERE id = ?').get(sheet.warehouseId) as { branch_id: number } | undefined;
      if (!wh || wh.branch_id !== req.user!.branchId) throw new AppError(403, 'forbidden_warehouse');
    }
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
    const b = z.object({ reason: text(300) }).strict().parse(req.body ?? {});
    const result = approveCountSheet(db, req.user!, sheetId, idemKey(req), b.reason);
    return reply.code(result.replayed ? 200 : 201).send({
      replayed: result.replayed,
      sheet: getCountSheet(db, req.user!.organisationId, sheetId),
      document: getDocument(db, req.user!.organisationId, result.documentId),
    });
  });
  app.post('/api/stock/count-sheets/:id/cancel', { preHandler: staff }, async (req) => {
    const { id: sheetId } = idParam.parse(req.params);
    const b = z.object({ reason: text(300) }).strict().parse(req.body ?? {});
    cancelCountSheet(db, req.user!, sheetId, b.reason);
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
    if (req.user!.role === 'inventory_manager' && req.user!.branchId !== null) {
      where.push('w.branch_id = ?');
      params.push(req.user!.branchId);
    }
    const rows = (db
      .prepare(
        `SELECT po.id, po.supplier_id AS supplierId, s.name AS supplierName,
                po.warehouse_id AS warehouseId, w.name AS warehouseName,
                po.reference, po.notes, po.status, po.created_by AS createdBy, po.approved_by AS approvedBy,
                po.decided_by AS decidedBy, po.decision_reason AS decisionReason,
                po.created_at AS createdAt, po.approved_at AS approvedAt, po.decided_at AS decidedAt,
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
    if (req.user!.role === 'inventory_manager' && req.user!.branchId !== null) {
      const wh = db.prepare('SELECT branch_id FROM warehouses WHERE id = ?').get(po.warehouseId) as { branch_id: number } | undefined;
      if (!wh || wh.branch_id !== req.user!.branchId) throw new AppError(403, 'forbidden_warehouse');
    }
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
    const b = z.object({ reason: text(300) }).strict().parse(req.body ?? {});
    approvePurchaseOrder(db, req.user!, poId, b.reason);
    return getPurchaseOrder(db, req.user!.organisationId, poId);
  });
  app.post('/api/purchase-orders/:id/cancel', { preHandler: staff }, async (req) => {
    const { id: poId } = idParam.parse(req.params);
    const b = z.object({ reason: text(300) }).strict().parse(req.body ?? {});
    cancelPurchaseOrder(db, req.user!, poId, b.reason);
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
    if (req.user!.role === 'inventory_manager' && req.user!.branchId !== null) {
      where.push('w.branch_id = ?');
      params.push(req.user!.branchId);
    }
    const rows = db
      .prepare(
        `SELECT r.id, r.kind, r.warehouse_id AS warehouseId, w.name AS warehouseName,
                r.department_id AS departmentId, d.name AS departmentName,
                r.to_warehouse_id AS toWarehouseId, tw.name AS toWarehouseName,
                r.reference, r.notes, r.status, r.posted_document_id AS postedDocumentId,
                r.created_by AS createdBy, r.fulfilled_by AS fulfilledBy, r.decision_reason AS decisionReason,
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
    if (req.user!.role === 'inventory_manager' && req.user!.branchId !== null) {
      const wh = db.prepare('SELECT branch_id FROM warehouses WHERE id = ?').get(r.warehouseId) as { branch_id: number } | undefined;
      if (!wh || wh.branch_id !== req.user!.branchId) throw new AppError(403, 'forbidden_warehouse');
    }
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
    const b = z.object({ reason: text(300) }).strict().parse(req.body ?? {});
    const result = fulfillRequisition(db, req.user!, reqId, idemKey(req), b.reason);
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
    if (req.user!.role === 'inventory_manager' && req.user!.branchId !== null) {
      const allowed = db
        .prepare('SELECT 1 FROM stock_movements m JOIN warehouses w ON w.id = m.warehouse_id WHERE m.document_id = ? AND w.branch_id = ?')
        .get(docId, req.user!.branchId);
      if (!allowed) throw new AppError(403, 'forbidden_warehouse');
    }
    return doc;
  });

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
                m.unit_cost_cents, m.unit_selling_price_cents, m.tender_type AS tenderType, m.batch_number AS batchNumber, m.expiry_date AS expiryDate
           FROM stock_movements m JOIN stock_documents d ON d.id = m.document_id JOIN products p ON p.id = m.product_id
                JOIN warehouses w ON w.id = m.warehouse_id JOIN units_of_measure u ON u.id = m.unit_id
          WHERE ${where} ORDER BY m.id DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, q.limit, q.offset) as ({
        quantity_milli: number;
        factor_milli: number;
        base_delta_milli: number;
        unit_cost_cents: number;
        unit_selling_price_cents: number;
      } & Record<string, unknown>)[]).map(
      ({ quantity_milli, factor_milli, base_delta_milli, unit_cost_cents, unit_selling_price_cents, ...r }) => ({
        ...r,
        quantity: fromMilli(quantity_milli),
        factor: fromMilli(factor_milli),
        baseChange: fromMilli(base_delta_milli),
        unitCost: fromCents(unit_cost_cents),
        unitSellingPrice: fromCents(unit_selling_price_cents ?? 0),
      }),
    );
    return { items: rows };
  });

  app.get('/api/stock/verify', { preHandler: exec }, async (req) => verifyLedger(db, req.user!.organisationId));

  // ---------- inventory reports & low-stock alerts ----------
  app.get('/api/reports/inventory', { preHandler: anyUser }, async (req) => {
    const orgId = req.user!.organisationId;
    const rq = z
      .object({
        period: z.enum(['today', 'week', 'month', 'all']).default('all'),
        departmentId: z.coerce.number().int().positive().optional(),
      })
      .parse(req.query);

    let cutoffIso: string | null = null;
    if (rq.period === 'today') {
      const d = new Date();
      d.setUTCHours(0, 0, 0, 0);
      cutoffIso = d.toISOString().replace('T', ' ').slice(0, 19);
    } else if (rq.period === 'week') {
      const d = new Date(Date.now() - 7 * 86400_000);
      cutoffIso = d.toISOString().replace('T', ' ').slice(0, 19);
    } else if (rq.period === 'month') {
      const d = new Date(Date.now() - 30 * 86400_000);
      cutoffIso = d.toISOString().replace('T', ' ').slice(0, 19);
    }

    // 1. Low-stock alerts across products (product-level reorder threshold vs total and warehouse stock)
    const lowStockAlerts = (db
      .prepare(
        `SELECT p.id AS productId, p.sku, p.name AS productName, c.name AS categoryName,
                dep.name AS departmentName, u.code AS unit, p.unit_cost_cents, p.selling_price_cents, p.reorder_level_milli,
                COALESCE((SELECT SUM(b.quantity_milli) FROM stock_balances b WHERE b.product_id = p.id AND b.organisation_id = p.organisation_id), 0) AS total_milli
           FROM products p
           JOIN units_of_measure u ON u.id = p.base_unit_id
           LEFT JOIN categories c ON c.id = p.category_id
           LEFT JOIN departments dep ON dep.id = p.department_id
          WHERE p.organisation_id = ? AND p.active = 1 AND p.reorder_level_milli > 0
            AND COALESCE((SELECT SUM(b.quantity_milli) FROM stock_balances b WHERE b.product_id = p.id AND b.organisation_id = p.organisation_id), 0) <= p.reorder_level_milli
          ORDER BY (total_milli - p.reorder_level_milli) ASC, p.name ASC`,
      )
      .all(orgId) as {
      productId: number;
      sku: string;
      productName: string;
      categoryName: string | null;
      departmentName: string | null;
      unit: string;
      unit_cost_cents: number;
      selling_price_cents: number;
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
        departmentName: r.departmentName ?? 'General',
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
    const whScope =
      req.user!.role === 'inventory_manager' && req.user!.branchId !== null ? ' AND w.branch_id = ?' : '';
    const whParams: (number | string)[] =
      req.user!.role === 'inventory_manager' && req.user!.branchId !== null ? [orgId, req.user!.branchId] : [orgId];
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
          WHERE br.organisation_id = ?${whScope}
          GROUP BY w.id, w.name, br.name
          ORDER BY total_cents DESC, w.name ASC`,
      )
      .all(...whParams) as { warehouseId: number; warehouseName: string; branchName: string; skuCount: number; total_milli: number; total_cents: number }[]).map(
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
    const depScope =
      req.user!.role === 'inventory_manager' && req.user!.branchId !== null ? ' AND dep.branch_id = ?' : '';
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
          WHERE br.organisation_id = ?${depScope}
          GROUP BY dep.id, dep.name, br.name
          ORDER BY consumed_cents DESC, dep.name ASC`,
      )
      .all(...whParams) as {
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

    // 6. Owner End-of-Day Stock-Flow & Earnings Reconciliation (Bought -> Sold -> Earned -> Stock at Hand)
    const prodFilter = rq.departmentId ? ' AND p.department_id = ?' : '';
    const prodParams: (number | string)[] = rq.departmentId ? [orgId, rq.departmentId] : [orgId];
    const productsList = db
      .prepare(
        `SELECT p.id, p.sku, p.name, p.unit_cost_cents, p.selling_price_cents, p.vat_category AS vatCategory,
                u.code AS unit, COALESCE(c.name, 'Uncategorised') AS categoryName,
                p.department_id AS departmentId, COALESCE(dep.name, 'General Store') AS departmentName,
                COALESCE((SELECT SUM(b.quantity_milli) FROM stock_balances b WHERE b.product_id = p.id AND b.organisation_id = p.organisation_id), 0) AS closing_milli
           FROM products p
           JOIN units_of_measure u ON u.id = p.base_unit_id
           LEFT JOIN categories c ON c.id = p.category_id
           LEFT JOIN departments dep ON dep.id = p.department_id
          WHERE p.organisation_id = ?${prodFilter}
          ORDER BY p.name ASC`,
      )
      .all(...prodParams) as {
      id: number;
      sku: string;
      name: string;
      unit_cost_cents: number;
      selling_price_cents: number;
      vatCategory: string;
      unit: string;
      categoryName: string;
      departmentId: number | null;
      departmentName: string;
      closing_milli: number;
    }[];

    const periodClause = cutoffIso ? ' AND d.created_at >= ?' : '';
    const movParams: (number | string)[] = cutoffIso ? [orgId, cutoffIso] : [orgId];
    const rawMovements = db
      .prepare(
        `SELECT m.product_id AS productId, d.type, d.department_id AS docDeptId,
                m.base_delta_milli, m.unit_cost_cents, m.unit_selling_price_cents, m.tender_type AS tenderType
           FROM stock_movements m
           JOIN stock_documents d ON d.id = m.document_id
          WHERE d.organisation_id = ?
            AND d.type != 'reversal'
            AND NOT EXISTS (SELECT 1 FROM stock_documents rev WHERE rev.reverses_document_id = d.id)${periodClause}`,
      )
      .all(...movParams) as {
      productId: number;
      type: string;
      docDeptId: number | null;
      base_delta_milli: number;
      unit_cost_cents: number;
      unit_selling_price_cents: number;
      tenderType: string | null;
    }[];

    const byProd = new Map<
      number,
      {
        boughtMilli: number;
        boughtCostCents: number;
        soldMilli: number;
        revenueCents: number;
        cogsCents: number;
        damagedMilli: number;
        damagedCostCents: number;
        adjustedMilli: number;
        netPeriodDeltaMilli: number;
      }
    >();

    const tenderTotalsCents: Record<string, number> = {
      USD_CASH: 0,
      ZIG_CASH: 0,
      ZAR_CASH: 0,
      ECOCASH_USD: 0,
      ECOCASH_ZIG: 0,
      INNBUCKS: 0,
      ONEMONEY_ZIG: 0,
      CREDIT: 0,
    };

    const prodLookup = new Map(productsList.map((p) => [p.id, p]));

    for (const m of rawMovements) {
      const pInfo = prodLookup.get(m.productId);
      if (!pInfo) continue;
      let acc = byProd.get(m.productId);
      if (!acc) {
        acc = {
          boughtMilli: 0,
          boughtCostCents: 0,
          soldMilli: 0,
          revenueCents: 0,
          cogsCents: 0,
          damagedMilli: 0,
          damagedCostCents: 0,
          adjustedMilli: 0,
          netPeriodDeltaMilli: 0,
        };
        byProd.set(m.productId, acc);
      }
      acc.netPeriodDeltaMilli += m.base_delta_milli;
      const absUnits = Math.abs(m.base_delta_milli) / 1000;
      const costPerUnit = m.unit_cost_cents > 0 ? m.unit_cost_cents : pInfo.unit_cost_cents;

      if (m.type === 'receipt') {
        acc.boughtMilli += m.base_delta_milli;
        acc.boughtCostCents += Math.round(absUnits * costPerUnit);
      } else if (m.type === 'issue') {
        acc.soldMilli += Math.abs(m.base_delta_milli);
        const sellPerUnit =
          m.unit_selling_price_cents > 0
            ? m.unit_selling_price_cents
            : pInfo.selling_price_cents > 0
              ? pInfo.selling_price_cents
              : Math.round(costPerUnit * 1.3);
        const lineRevCents = Math.round(absUnits * sellPerUnit);
        const lineCogsCents = Math.round(absUnits * costPerUnit);
        acc.revenueCents += lineRevCents;
        acc.cogsCents += lineCogsCents;
        const tKey = m.tenderType && m.tenderType in tenderTotalsCents ? m.tenderType : 'USD_CASH';
        tenderTotalsCents[tKey] = (tenderTotalsCents[tKey] ?? 0) + lineRevCents;
      } else if (m.type === 'write_off') {
        acc.damagedMilli += Math.abs(m.base_delta_milli);
        acc.damagedCostCents += Math.round(absUnits * costPerUnit);
      } else if (m.type === 'adjustment' || m.type === 'count') {
        acc.adjustedMilli += m.base_delta_milli;
      }
    }

    let totalBoughtUnits = 0;
    let totalBoughtCostCents = 0;
    let totalSoldUnits = 0;
    let totalRevenueCents = 0;
    let totalCogsCents = 0;
    let totalVat15Cents = 0;
    let totalDamagedUnits = 0;
    let totalDamagedCostCents = 0;
    let totalClosingUnits = 0;
    let totalClosingCostValueCents = 0;
    let totalClosingRetailValueCents = 0;

    const deptAggregator = new Map<
      string,
      {
        departmentName: string;
        skuCount: number;
        openingUnits: number;
        boughtUnits: number;
        boughtCost: number;
        soldUnits: number;
        revenue: number;
        cogs: number;
        grossProfit: number;
        damagedUnits: number;
        damagedCost: number;
        closingUnits: number;
        stockAtHandCostValue: number;
        stockAtHandRetailValue: number;
      }
    >();

    const productStockFlow = productsList.map((p) => {
      const stats = byProd.get(p.id) ?? {
        boughtMilli: 0,
        boughtCostCents: 0,
        soldMilli: 0,
        revenueCents: 0,
        cogsCents: 0,
        damagedMilli: 0,
        damagedCostCents: 0,
        adjustedMilli: 0,
        netPeriodDeltaMilli: 0,
      };
      const closingUnits = fromMilli(p.closing_milli);
      const openingMilli = Math.max(0, p.closing_milli - stats.netPeriodDeltaMilli);
      const openingUnits = fromMilli(openingMilli);
      const boughtUnits = fromMilli(stats.boughtMilli);
      const soldUnits = fromMilli(stats.soldMilli);
      const damagedUnits = fromMilli(stats.damagedMilli);
      const unitCost = fromCents(p.unit_cost_cents);
      const sellingPrice = p.selling_price_cents > 0 ? fromCents(p.selling_price_cents) : Math.round(unitCost * 1.3 * 100) / 100;
      const revenue = fromCents(stats.revenueCents);
      const cogs = fromCents(stats.cogsCents);
      const grossProfit = Math.round((revenue - cogs) * 100) / 100;
      const vat15Cents = p.vatCategory === 'standard_15' ? Math.round((stats.revenueCents * 15) / 115) : 0;
      const closingCostCents = Math.round(closingUnits * p.unit_cost_cents);
      const closingRetailCents = Math.round(closingUnits * (p.selling_price_cents > 0 ? p.selling_price_cents : p.unit_cost_cents * 1.3));

      totalBoughtUnits += boughtUnits;
      totalBoughtCostCents += stats.boughtCostCents;
      totalSoldUnits += soldUnits;
      totalRevenueCents += stats.revenueCents;
      totalCogsCents += stats.cogsCents;
      totalVat15Cents += vat15Cents;
      totalDamagedUnits += damagedUnits;
      totalDamagedCostCents += stats.damagedCostCents;
      totalClosingUnits += closingUnits;
      totalClosingCostValueCents += closingCostCents;
      totalClosingRetailValueCents += closingRetailCents;

      const dName = p.departmentName;
      let dRow = deptAggregator.get(dName);
      if (!dRow) {
        dRow = {
          departmentName: dName,
          skuCount: 0,
          openingUnits: 0,
          boughtUnits: 0,
          boughtCost: 0,
          soldUnits: 0,
          revenue: 0,
          cogs: 0,
          grossProfit: 0,
          damagedUnits: 0,
          damagedCost: 0,
          closingUnits: 0,
          stockAtHandCostValue: 0,
          stockAtHandRetailValue: 0,
        };
        deptAggregator.set(dName, dRow);
      }
      dRow.skuCount += 1;
      dRow.openingUnits = Math.round((dRow.openingUnits + openingUnits) * 1000) / 1000;
      dRow.boughtUnits = Math.round((dRow.boughtUnits + boughtUnits) * 1000) / 1000;
      dRow.boughtCost = Math.round((dRow.boughtCost + fromCents(stats.boughtCostCents)) * 100) / 100;
      dRow.soldUnits = Math.round((dRow.soldUnits + soldUnits) * 1000) / 1000;
      dRow.revenue = Math.round((dRow.revenue + revenue) * 100) / 100;
      dRow.cogs = Math.round((dRow.cogs + cogs) * 100) / 100;
      dRow.grossProfit = Math.round((dRow.grossProfit + grossProfit) * 100) / 100;
      dRow.damagedUnits = Math.round((dRow.damagedUnits + damagedUnits) * 1000) / 1000;
      dRow.damagedCost = Math.round((dRow.damagedCost + fromCents(stats.damagedCostCents)) * 100) / 100;
      dRow.closingUnits = Math.round((dRow.closingUnits + closingUnits) * 1000) / 1000;
      dRow.stockAtHandCostValue = Math.round((dRow.stockAtHandCostValue + fromCents(closingCostCents)) * 100) / 100;
      dRow.stockAtHandRetailValue = Math.round((dRow.stockAtHandRetailValue + fromCents(closingRetailCents)) * 100) / 100;

      return {
        productId: p.id,
        sku: p.sku,
        productName: p.name,
        categoryName: p.categoryName,
        departmentId: p.departmentId,
        departmentName: p.departmentName,
        vatCategory: p.vatCategory,
        unit: p.unit,
        unitCost,
        sellingPrice,
        openingUnits,
        boughtUnits,
        boughtCost: fromCents(stats.boughtCostCents),
        soldUnits,
        revenue,
        cogs,
        grossProfit,
        damagedUnits,
        damagedCost: fromCents(stats.damagedCostCents),
        closingUnits,
        stockAtHandCostValue: fromCents(closingCostCents),
        stockAtHandRetailValue: fromCents(closingRetailCents),
      };
    });

    const ownerSummary = {
      period: rq.period,
      totalBoughtUnits: Math.round(totalBoughtUnits * 1000) / 1000,
      totalBoughtCost: fromCents(totalBoughtCostCents),
      totalSoldUnits: Math.round(totalSoldUnits * 1000) / 1000,
      totalRevenue: fromCents(totalRevenueCents),
      totalCogs: fromCents(totalCogsCents),
      grossProfit: fromCents(totalRevenueCents - totalCogsCents),
      netProfitAfterShrinkage: fromCents(totalRevenueCents - totalCogsCents - totalDamagedCostCents),
      vat15Payable: fromCents(totalVat15Cents),
      totalDamagedUnits: Math.round(totalDamagedUnits * 1000) / 1000,
      totalDamagedCost: fromCents(totalDamagedCostCents),
      totalClosingUnits: Math.round(totalClosingUnits * 1000) / 1000,
      stockAtHandCostValue: fromCents(totalClosingCostValueCents),
      stockAtHandRetailValue: fromCents(totalClosingRetailValueCents),
      tenderBreakdown: Object.fromEntries(Object.entries(tenderTotalsCents).map(([k, v]) => [k, fromCents(v)])),
      byDepartment: Array.from(deptAggregator.values()),
      productStockFlow,
    };

    return {
      lowStockAlerts,
      valuationByCategory,
      warehouseStockSummary,
      departmentConsumption,
      movementSummary,
      ownerSummary,
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

    const draftCountSheets = (db
      .prepare(
        `SELECT cs.id, cs.reference, cs.notes, cs.status, cs.created_at AS createdAt,
                w.name AS warehouseName, cs.created_by AS createdById, u.name AS createdByName,
                (SELECT COUNT(*) FROM count_sheet_lines l WHERE l.count_sheet_id = cs.id) AS lineCount
           FROM count_sheets cs
           JOIN warehouses w ON w.id = cs.warehouse_id
           LEFT JOIN users u ON u.id = cs.created_by
          WHERE cs.organisation_id = ? AND cs.status = 'draft'
          ORDER BY cs.id DESC`,
      )
      .all(orgId) as ({ id: number } & Record<string, unknown>)[]).map((cs) => {
      const sheet = getCountSheet(db, orgId, cs.id);
      const varianceCount = sheet ? sheet.lines.filter((l) => l.varianceBaseQuantity !== 0).length : 0;
      return { ...cs, varianceCount };
    });

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
      return {
        system: 'StockRoom ZW',
        reportTitle: `Formal Inventory Report - ${q.section.toUpperCase()}`,
        generatedAt: new Date().toISOString(),
        generatedBy: req.user!.name,
        section: q.section,
        format: 'json',
        rowCount: rows.length,
        items: rows,
      };
    }

    const orgRow = db.prepare('SELECT name FROM organisations WHERE id = ?').get(orgId) as { name: string } | undefined;
    const orgNameStr = orgRow?.name ?? 'StockRoom Enterprise';
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);

    const escapeCsv = (val: unknown) => {
      const s = val === null || val === undefined ? '' : String(val);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const headers = rows.length > 0 ? Object.keys(rows[0]!) : ['section'];
    const formalBanner = [
      `"========================================================================================="`,
      `"ORGANISATION: ${orgNameStr}"`,
      `"REPORT: StockRoom Formal Audit & Ledger Export (${q.section.toUpperCase()})"`,
      `"EXPORTED BY: ${req.user!.name} (${req.user!.role})"`,
      `"GENERATED AT: ${timestamp} CAT"`,
      `"VERIFICATION: AUTHORISED SYSTEM AUDIT TRAIL RECORDED"`,
      `"========================================================================================="`,
      ``,
    ];

    const dataLines = [headers.join(','), ...rows.map((r) => headers.map((h) => escapeCsv(r[h])).join(','))];
    const fullCsv = [...formalBanner, ...dataLines].join('\n');

    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="StockRoom-${q.section}-${new Date().toISOString().slice(0, 10)}.csv"`);
    return reply.send(fullCsv);
  });

  // ---------- Stage 5: Safe File Uploads (Validated Document Attachments) ----------
  const ALLOWED_MIMES = ['application/pdf', 'image/png', 'image/jpeg', 'text/csv'] as const;
  const MAX_UPLOAD_BYTES = 2 * 1024 * 1024; // 2 MB

  function sanitizeFilename(raw: string): string {
    if (raw.includes('\0') || raw.includes('..') || raw.includes('/') || raw.includes('\\')) {
      throw new AppError(400, 'invalid_filename');
    }
    const clean = raw.replace(/[^a-zA-Z0-9._-]/g, '_').trim();
    if (!clean || clean.length > 120) throw new AppError(400, 'invalid_filename');
    if (/\.(exe|bat|cmd|sh|ps1|js|mjs|cjs|html|htm|svg|php|py|dll)$/i.test(clean)) {
      throw new AppError(400, 'forbidden_file_extension');
    }
    return clean;
  }

  function verifyMagicBytes(mime: (typeof ALLOWED_MIMES)[number], buf: Buffer): void {
    if (buf.length === 0) throw new AppError(400, 'empty_file');
    if (buf.length > MAX_UPLOAD_BYTES) throw new AppError(413, 'file_too_large');
    if (mime === 'application/pdf') {
      if (buf.length < 4 || buf.subarray(0, 4).toString('ascii') !== '%PDF') {
        throw new AppError(400, 'file_signature_mismatch');
      }
    } else if (mime === 'image/png') {
      const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      if (buf.length < 8 || !buf.subarray(0, 8).equals(pngMagic)) {
        throw new AppError(400, 'file_signature_mismatch');
      }
    } else if (mime === 'image/jpeg') {
      if (buf.length < 3 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) {
        throw new AppError(400, 'file_signature_mismatch');
      }
    } else if (mime === 'text/csv') {
      // Reject binary files masquerading as CSV
      for (let i = 0; i < Math.min(buf.length, 4096); i++) {
        const b = buf[i]!;
        if (b === 0x00 || (b < 0x09 && b !== 0x0a && b !== 0x0d)) {
          throw new AppError(400, 'file_signature_mismatch');
        }
      }
    }
  }

  function assertTargetOwned(orgId: number, targetType: 'stock_document' | 'purchase_order' | 'requisition' | 'count_sheet', targetId: number) {
    const tableMap = {
      stock_document: 'stock_documents',
      purchase_order: 'purchase_orders',
      requisition: 'requisitions',
      count_sheet: 'count_sheets',
    } as const;
    const row = db.prepare(`SELECT id FROM ${tableMap[targetType]} WHERE id = ? AND organisation_id = ?`).get(targetId, orgId);
    if (!row) throw new AppError(404, 'target_not_found');
  }

  app.post(
    '/api/attachments',
    { preHandler: staff, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const orgId = req.user!.organisationId;
      const b = z
        .object({
          targetType: z.enum(['stock_document', 'purchase_order', 'requisition', 'count_sheet']),
          targetId: id,
          filename: z.string().trim().min(1).max(120),
          mimeType: z.enum(ALLOWED_MIMES),
          contentBase64: z.string().trim().min(4).max(3_000_000),
        })
        .strict()
        .parse(req.body);

      const safeFilename = sanitizeFilename(b.filename);
      assertTargetOwned(orgId, b.targetType, b.targetId);

      // Validate strict base64 encoding
      const normalizedB64 = b.contentBase64.replace(/\s+/g, '');
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalizedB64) || normalizedB64.length % 4 !== 0) {
        throw new AppError(400, 'invalid_base64');
      }
      const buf = Buffer.from(normalizedB64, 'base64');
      verifyMagicBytes(b.mimeType, buf);

      const checksum = createHash('sha256').update(buf).digest('hex');
      const r = db
        .prepare(
          `INSERT INTO document_attachments
            (organisation_id, target_type, target_id, filename, mime_type, size_bytes, checksum_sha256, content_base64, uploaded_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(orgId, b.targetType, b.targetId, safeFilename, b.mimeType, buf.length, checksum, normalizedB64, req.user!.id);

      const attachmentId = Number(r.lastInsertRowid);
      recordAudit(db, req.user!, 'attachment.upload', b.targetType, b.targetId, {
        attachmentId,
        filename: safeFilename,
        mimeType: b.mimeType,
        sizeBytes: buf.length,
        checksumSha256: checksum,
      });

      return reply.code(201).send({
        id: attachmentId,
        targetType: b.targetType,
        targetId: b.targetId,
        filename: safeFilename,
        mimeType: b.mimeType,
        sizeBytes: buf.length,
        checksumSha256: checksum,
      });
    },
  );

  app.get('/api/attachments', { preHandler: anyUser }, async (req) => {
    const q = z
      .object({
        targetType: z.enum(['stock_document', 'purchase_order', 'requisition', 'count_sheet']),
        targetId: z.coerce.number().int().positive(),
      })
      .parse(req.query);
    const orgId = req.user!.organisationId;
    assertTargetOwned(orgId, q.targetType, q.targetId);
    const items = db
      .prepare(
        `SELECT a.id, a.target_type AS targetType, a.target_id AS targetId, a.filename,
                a.mime_type AS mimeType, a.size_bytes AS sizeBytes, a.checksum_sha256 AS checksumSha256,
                a.uploaded_by AS uploadedBy, u.name AS uploadedByName, a.created_at AS createdAt
           FROM document_attachments a
           LEFT JOIN users u ON u.id = a.uploaded_by
          WHERE a.organisation_id = ? AND a.target_type = ? AND a.target_id = ?
          ORDER BY a.id DESC`,
      )
      .all(orgId, q.targetType, q.targetId);
    return { items };
  });

  app.get('/api/attachments/:id/download', { preHandler: anyUser }, async (req, reply) => {
    const { id: attId } = idParam.parse(req.params);
    const row = db
      .prepare(
        `SELECT id, filename, mime_type, size_bytes, checksum_sha256, content_base64
           FROM document_attachments WHERE id = ? AND organisation_id = ?`,
      )
      .get(attId, req.user!.organisationId) as
      | { id: number; filename: string; mime_type: string; size_bytes: number; checksum_sha256: string; content_base64: string }
      | undefined;
    if (!row) throw new AppError(404, 'not_found');
    const buf = Buffer.from(row.content_base64, 'base64');
    reply.header('content-type', row.mime_type);
    reply.header('content-disposition', `attachment; filename="${row.filename}"`);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('content-security-policy', "default-src 'none'");
    return reply.send(buf);
  });

  // ---------- Stage 7: Zimbabwean SME Dual-Department Trading & Operations Endpoints ----------

  function ensureSmeSeedForOrg(orgId: number) {
    // 1. Staff 4-Digit Fast PINs
    const pinCount = (db.prepare('SELECT COUNT(*) n FROM staff_pins WHERE organisation_id = ?').get(orgId) as { n: number }).n;
    if (pinCount === 0) {
      const execU = db.prepare("SELECT id FROM users WHERE organisation_id = ? AND role = 'executive_manager' LIMIT 1").get(orgId) as { id: number } | undefined;
      const invU = db.prepare("SELECT id FROM users WHERE organisation_id = ? AND role = 'inventory_manager' LIMIT 1").get(orgId) as { id: number } | undefined;
      const insPin = db.prepare(
        `INSERT OR IGNORE INTO staff_pins (organisation_id, user_id, staff_name, role_title, pin_code, department_scope, can_view_cost, can_write_off, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      );
      insPin.run(orgId, execU?.id ?? null, 'Tendai Moyo (Owner)', 'Owner / Executive Manager', '1980', 'Groceries & Hardware', 1, 1);
      insPin.run(orgId, invU?.id ?? null, 'Rudo Chikwanda', 'Senior Storekeeper', '2468', 'Groceries & Hardware', 1, 1);
      insPin.run(orgId, invU?.id ?? null, 'Blessing Ndlovu', 'Hardware Yard Dispatch', '1357', 'Hardware & Building', 0, 0);
      insPin.run(orgId, invU?.id ?? null, 'Nyasha Mutasa', 'Grocery Till Cashier #1', '4321', 'Groceries & Staples', 0, 0);
    }

    // 2. Chikwereti (Customer Credit & Farmers Debtors Book)
    const debtCount = (db.prepare('SELECT COUNT(*) n FROM customer_credit_accounts WHERE organisation_id = ?').get(orgId) as { n: number }).n;
    if (debtCount === 0) {
      const insDebt = db.prepare(
        `INSERT INTO customer_credit_accounts (organisation_id, customer_name, phone, department_name, credit_limit_cents, balance_cents, due_date, items_summary, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      insDebt.run(orgId, 'Mai Chipo Tuckshop (Mbare)', '+263 772 319 402', 'Groceries', 25000, 8450, '2026-11-05', '10x Pearlenta 10kg, 2x Cartons Roil Cooking Oil 2L', 'CURRENT');
      insDebt.run(orgId, 'SekuruSibanda Plot 14 (Goromonzi)', '+263 712 884 119', 'Hardware & Agro', 50000, 21500, '2026-11-10', '20x PPC Surebuild Cement 50kg, 2x Brickforce Rolls', 'DUE_SOON');
      insDebt.run(orgId, 'Munashe Builders & Contractors', '+263 774 501 228', 'Hardware & Building', 80000, 34000, '2026-10-20', '30x PPC Cement 50kg, 15x IBR Chromadek Sheets 3.6m', 'OVERDUE');
    }

    // 3. Supplier Balances Owed (Creditors)
    const credCount = (db.prepare('SELECT COUNT(*) n FROM supplier_credit_ledgers WHERE organisation_id = ?').get(orgId) as { n: number }).n;
    if (credCount === 0) {
      const insCred = db.prepare(
        `INSERT INTO supplier_credit_ledgers (organisation_id, supplier_name, invoice_ref, department_name, total_cents, paid_cents, balance_cents, currency_code, due_date, notes, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      insCred.run(orgId, 'National Foods Ltd (Harare Depot)', 'NF-INV-88412', 'Groceries', 185000, 125000, 60000, 'USD', '2026-11-08', '7-day trade credit on Roller Meal & Mahatma Rice', 'PARTIAL');
      insCred.run(orgId, 'PPC Zimbabwe (Msasa Cement Plant)', 'PPC-BYO-44109', 'Hardware & Building', 240000, 180000, 60000, 'USD', '2026-11-12', 'Balance payable upon next 5-tonne delivery', 'PARTIAL');
      insCred.run(orgId, 'Musina Cross-Border Runner (Omalayitsha)', 'MUSINA-RUNNER-19', 'Hardware & Groceries', 92000, 92000, 0, 'USD', '2026-10-26', 'Beitbridge ZIMRA duty & freight cleared in full', 'SETTLED');
    }

    // 4. Paid & Uncollected Stock (Hardware "Collect Later" / Lay-By)
    const layCount = (db.prepare('SELECT COUNT(*) n FROM paid_uncollected_items WHERE organisation_id = ?').get(orgId) as { n: number }).n;
    if (layCount === 0) {
      const insLay = db.prepare(
        `INSERT INTO paid_uncollected_items (organisation_id, receipt_ref, customer_name, customer_phone, product_name, department_name, warehouse_name, ordered_qty, collected_qty, unit, total_paid_cents, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      insLay.run(orgId, 'RCP-HW-1088', 'VaChigumba (Ruwa Stand #412)', '+263 773 910 441', 'PPC Surebuild Cement 50kg Bag', 'Hardware & Building', 'Main Warehouse', 100, 40, 'bag', 125000, 'PARTIAL_COLLECTED');
      insLay.run(orgId, 'RCP-HW-1094', 'Tafadzwa Moyo (Chitungwiza)', '+263 782 119 005', 'IBR Chromadek Roofing Sheet 3.6m', 'Hardware & Building', 'Msasa Reserve Store', 24, 0, 'sheet', 52800, 'AWAITING_COLLECTION');
    }

    // 5. Till Shifts & Multi-Tender Cash-Up
    const shiftCount = (db.prepare('SELECT COUNT(*) n FROM till_shifts WHERE organisation_id = ?').get(orgId) as { n: number }).n;
    if (shiftCount === 0) {
      const insShift = db.prepare(
        `INSERT INTO till_shifts
          (organisation_id, shift_ref, cashier_name, department_name, expected_usd_cents, counted_usd_cents, expected_zig_cents, counted_zig_cents, expected_zar_cents, counted_zar_cents, ecocash_usd_cents, ecocash_zig_cents, innbucks_usd_cents, onemoney_zig_cents, change_vouchers_issued_cents, variance_usd_cents, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      insShift.run(orgId, 'SHIFT-GROC-AM', 'Nyasha Mutasa (Grocery Till #1)', 'Groceries', 42500, 42500, 384000, 384000, 145000, 145000, 11850, 96000, 9400, 22000, 350, 0, 'BALANCED', 'Morning grocery shift balanced to the cent');
      insShift.run(orgId, 'SHIFT-HW-AM', 'Blessing Ndlovu (Hardware Counter)', 'Hardware & Building', 89000, 89000, 120000, 120000, 210000, 210000, 24500, 0, 16000, 0, 150, 0, 'BALANCED', 'Cement & roofing dispatch cash-up verified');
    }

    // 6. USD Small-Change Vouchers
    const vouchCount = (db.prepare('SELECT COUNT(*) n FROM change_vouchers WHERE organisation_id = ?').get(orgId) as { n: number }).n;
    if (vouchCount === 0) {
      const insVouch = db.prepare(
        `INSERT INTO change_vouchers (organisation_id, voucher_code, customer_name, customer_phone, amount_cents, department_name, status, created_by_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      insVouch.run(orgId, 'CHG-9041', 'Gogo Ndlovu', '+263 775 210 990', 50, 'Groceries', 'UNREDEEMED', 'Nyasha Mutasa');
      insVouch.run(orgId, 'CHG-9042', 'Farai Katsande', '+263 719 400 112', 35, 'Groceries', 'UNREDEEMED', 'Nyasha Mutasa');
      insVouch.run(orgId, 'CHG-9038', 'Tinashe Bhebhe', '+263 772 800 311', 75, 'Hardware & Building', 'REDEEMED', 'Blessing Ndlovu');
    }

    // 7. Break-Bulk & Recipe Yield Batches
    const yieldCount = (db.prepare('SELECT COUNT(*) n FROM yield_batches WHERE organisation_id = ?').get(orgId) as { n: number }).n;
    if (yieldCount === 0) {
      const insYield = db.prepare(
        `INSERT INTO yield_batches (organisation_id, batch_ref, kind, department_name, source_name, input_qty, input_unit, output_name, expected_output_qty, actual_output_qty, output_unit, waste_qty, yield_pct, created_by_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      insYield.run(orgId, 'BRK-2026-011', 'BREAK_BULK', 'Groceries', 'Mahatma Long Grain Rice (Carton 12x2kg)', 2, 'carton', 'Mahatma Rice 2kg Shelf Pack', 24, 24, 'each', 0, 100, 'Rudo Chikwanda');
      insYield.run(orgId, 'BRK-2026-012', 'BREAK_BULK', 'Hardware & Building', 'Wire Nails 3-Inch 50kg Bulk Bag', 1, 'bag (50kg)', 'Wire Nails 3-Inch 1kg Counter Pack', 50, 49.5, 'kg', 0.5, 99, 'Blessing Ndlovu');
    }
  }

  // Overview of all SME ledgers in one call
  app.get('/api/sme/overview', { preHandler: anyUser }, async (req) => {
    const orgId = req.user!.organisationId;
    ensureSmeSeedForOrg(orgId);

    const debtors = (db
      .prepare('SELECT * FROM customer_credit_accounts WHERE organisation_id = ? ORDER BY id DESC')
      .all(orgId) as Record<string, unknown>[]).map((r) => ({
      id: r.id,
      customerName: r.customer_name,
      phone: r.phone,
      departmentName: r.department_name,
      creditLimit: fromCents(Number(r.credit_limit_cents ?? 0)),
      balance: fromCents(Number(r.balance_cents ?? 0)),
      dueDate: r.due_date,
      itemsSummary: r.items_summary,
      status: r.status,
      updatedAt: r.updated_at,
    }));

    const creditors = (db
      .prepare('SELECT * FROM supplier_credit_ledgers WHERE organisation_id = ? ORDER BY id DESC')
      .all(orgId) as Record<string, unknown>[]).map((r) => ({
      id: r.id,
      supplierId: r.supplier_id,
      supplierName: r.supplier_name,
      invoiceRef: r.invoice_ref,
      departmentName: r.department_name,
      totalAmount: fromCents(Number(r.total_cents ?? 0)),
      paidAmount: fromCents(Number(r.paid_cents ?? 0)),
      balanceOwed: fromCents(Number(r.balance_cents ?? 0)),
      currencyCode: r.currency_code,
      dueDate: r.due_date,
      notes: r.notes,
      status: r.status,
      updatedAt: r.updated_at,
    }));

    const laybys = (db
      .prepare('SELECT * FROM paid_uncollected_items WHERE organisation_id = ? ORDER BY id DESC')
      .all(orgId) as Record<string, unknown>[]).map((r) => ({
      id: r.id,
      receiptRef: r.receipt_ref,
      customerName: r.customer_name,
      customerPhone: r.customer_phone,
      productId: r.product_id,
      productName: r.product_name,
      departmentName: r.department_name,
      warehouseName: r.warehouse_name,
      orderedQty: Number(r.ordered_qty),
      collectedQty: Number(r.collected_qty),
      remainingQty: Math.max(0, Number(r.ordered_qty) - Number(r.collected_qty)),
      unit: r.unit,
      totalPaid: fromCents(Number(r.total_paid_cents ?? 0)),
      status: r.status,
      createdAt: r.created_at,
    }));

    const tillShifts = (db
      .prepare('SELECT * FROM till_shifts WHERE organisation_id = ? ORDER BY id DESC LIMIT 30')
      .all(orgId) as Record<string, unknown>[]).map((r) => ({
      id: r.id,
      shiftRef: r.shift_ref,
      cashierName: r.cashier_name,
      departmentName: r.department_name,
      expectedUsd: fromCents(Number(r.expected_usd_cents ?? 0)),
      countedUsd: fromCents(Number(r.counted_usd_cents ?? 0)),
      expectedZig: fromCents(Number(r.expected_zig_cents ?? 0)),
      countedZig: fromCents(Number(r.counted_zig_cents ?? 0)),
      expectedZar: fromCents(Number(r.expected_zar_cents ?? 0)),
      countedZar: fromCents(Number(r.counted_zar_cents ?? 0)),
      ecocashUsd: fromCents(Number(r.ecocash_usd_cents ?? 0)),
      ecocashZig: fromCents(Number(r.ecocash_zig_cents ?? 0)),
      innbucksUsd: fromCents(Number(r.innbucks_usd_cents ?? 0)),
      onemoneyZig: fromCents(Number(r.onemoney_zig_cents ?? 0)),
      changeVouchersIssued: fromCents(Number(r.change_vouchers_issued_cents ?? 0)),
      varianceUsd: fromCents(Number(r.variance_usd_cents ?? 0)),
      status: r.status,
      notes: r.notes,
      closedAt: r.closed_at,
    }));

    const changeVouchers = (db
      .prepare('SELECT * FROM change_vouchers WHERE organisation_id = ? ORDER BY id DESC LIMIT 50')
      .all(orgId) as Record<string, unknown>[]).map((r) => ({
      id: r.id,
      voucherCode: r.voucher_code,
      customerName: r.customer_name,
      customerPhone: r.customer_phone,
      amountUsd: fromCents(Number(r.amount_cents ?? 0)),
      departmentName: r.department_name,
      status: r.status,
      createdByName: r.created_by_name,
      createdAt: r.created_at,
      redeemedAt: r.redeemed_at,
    }));

    const yieldBatches = (db
      .prepare('SELECT * FROM yield_batches WHERE organisation_id = ? ORDER BY id DESC LIMIT 50')
      .all(orgId) as Record<string, unknown>[]).map((r) => ({
      id: r.id,
      batchRef: r.batch_ref,
      kind: r.kind,
      departmentName: r.department_name,
      sourceName: r.source_name,
      inputQty: Number(r.input_qty),
      inputUnit: r.input_unit,
      outputName: r.output_name,
      expectedOutputQty: Number(r.expected_output_qty),
      actualOutputQty: Number(r.actual_output_qty),
      outputUnit: r.output_unit,
      wasteQty: Number(r.waste_qty),
      yieldPct: Number(r.yield_pct),
      documentId: r.document_id,
      createdByName: r.created_by_name,
      createdAt: r.created_at,
    }));

    const staffPins = (db
      .prepare('SELECT * FROM staff_pins WHERE organisation_id = ? ORDER BY id ASC')
      .all(orgId) as Record<string, unknown>[]).map((r) => ({
      id: r.id,
      userId: r.user_id,
      staffName: r.staff_name,
      roleTitle: r.role_title,
      pinCode: r.pin_code,
      departmentScope: r.department_scope,
      canViewCost: Boolean(r.can_view_cost),
      canWriteOff: Boolean(r.can_write_off),
      active: Boolean(r.active),
    }));

    return {
      debtors,
      creditors,
      laybys,
      tillShifts,
      changeVouchers,
      yieldBatches,
      staffPins,
    };
  });

  // Counter Sale / Dispatch endpoint: posts an authoritative `issue` document while optionally updating Chikwereti credit or Lay-By collection
  app.post('/api/sme/counter-sale', { preHandler: staff }, async (req, reply) => {
    const orgId = req.user!.organisationId;
    ensureSmeSeedForOrg(orgId);
    const b = z
      .object({
        warehouseId: id,
        departmentId: id.nullish(),
        departmentName: z.string().trim().max(80).default('Groceries'),
        tenderType: z
          .enum(['USD_CASH', 'ZIG_CASH', 'ZAR_CASH', 'ECOCASH_USD', 'ECOCASH_ZIG', 'INNBUCKS', 'ONEMONEY_ZIG', 'CREDIT'])
          .default('USD_CASH'),
        reference: text(80),
        customerName: text(120),
        customerPhone: text(40),
        holdForLaterCollection: z.boolean().optional(),
        changeVoucherAmountUsd: z.number().min(0).max(100).optional(),
        lines: z
          .array(
            z
              .object({
                productId: id,
                unitId: id,
                quantity: qty.positive(),
                unitSellingPrice: money.optional(),
              })
              .strict(),
          )
          .min(1)
          .max(100),
      })
      .strict()
      .parse(req.body);

    const key = idemKey(req);
    const saleRef = b.reference ?? `SALE-${Date.now().toString().slice(-6)}`;

    const posted = postDocument(db, req.user!, {
      type: 'issue',
      departmentId: b.departmentId ?? null,
      reference: saleRef,
      reason: `Counter sale (${b.tenderType})${b.customerName ? ` - ${b.customerName}` : ''}`,
      idempotencyKey: key,
      lines: b.lines.map((l) => ({
        productId: l.productId,
        warehouseId: b.warehouseId,
        unitId: l.unitId,
        quantityMilli: toMilli(l.quantity),
        unitSellingPriceCents: l.unitSellingPrice !== undefined ? toCents(l.unitSellingPrice) : null,
        tenderType: b.tenderType,
      })),
    });

    const doc = getDocument(db, orgId, posted.documentId);
    const totalSaleCents = (doc?.lines ?? []).reduce(
      (sum, l) => sum + Math.round(Math.abs(l.baseChange) * (l.unitSellingPrice || l.unitCost * 1.3) * 100),
      0,
    );

    // If sold on CREDIT (Chikwereti), record or update customer credit account
    if (b.tenderType === 'CREDIT' && !posted.replayed) {
      const custName = b.customerName || 'Walk-In Credit Customer';
      const custPhone = b.customerPhone || '+263 770 000 000';
      const summary = `${saleRef} (${b.lines.length} item(s))`;
      const existing = db
        .prepare('SELECT id, balance_cents, items_summary FROM customer_credit_accounts WHERE organisation_id = ? AND customer_name = ? LIMIT 1')
        .get(orgId, custName) as { id: number; balance_cents: number; items_summary: string } | undefined;
      if (existing) {
        db.prepare(
          "UPDATE customer_credit_accounts SET balance_cents = balance_cents + ?, items_summary = ?, status = 'CURRENT', updated_at = datetime('now') WHERE id = ?",
        ).run(totalSaleCents, `${existing.items_summary}; ${summary}`.slice(0, 280), existing.id);
      } else {
        const due = new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10);
        db.prepare(
          `INSERT INTO customer_credit_accounts (organisation_id, customer_name, phone, department_name, credit_limit_cents, balance_cents, due_date, items_summary, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'CURRENT')`,
        ).run(orgId, custName, custPhone, b.departmentName, Math.max(50000, totalSaleCents * 2), totalSaleCents, due, summary);
      }
    }

    // If Hardware "Hold for Later Collection" is checked, create a Paid & Uncollected reservation entry
    if (b.holdForLaterCollection && !posted.replayed) {
      const whRow = db.prepare('SELECT name FROM warehouses WHERE id = ?').get(b.warehouseId) as { name: string } | undefined;
      for (const l of b.lines) {
        const pRow = db
          .prepare('SELECT p.name, p.selling_price_cents, u.code AS unit FROM products p JOIN units_of_measure u ON u.id = p.base_unit_id WHERE p.id = ?')
          .get(l.productId) as { name: string; selling_price_cents: number; unit: string } | undefined;
        const unitSellCents = l.unitSellingPrice !== undefined ? toCents(l.unitSellingPrice) : (pRow?.selling_price_cents ?? 1000);
        db.prepare(
          `INSERT INTO paid_uncollected_items
            (organisation_id, receipt_ref, customer_name, customer_phone, product_id, product_name, department_name, warehouse_name, ordered_qty, collected_qty, unit, total_paid_cents, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'AWAITING_COLLECTION')`,
        ).run(
          orgId,
          saleRef,
          b.customerName || 'Hardware Yard Customer',
          b.customerPhone || '+263 770 000 000',
          l.productId,
          pRow?.name ?? `Product #${l.productId}`,
          b.departmentName,
          whRow?.name ?? 'Main Warehouse',
          l.quantity,
          pRow?.unit ?? 'each',
          Math.round(l.quantity * unitSellCents),
        );
      }
    }

    // If a USD small-change voucher was issued with this sale
    let issuedVoucherCode: string | null = null;
    if (b.changeVoucherAmountUsd && b.changeVoucherAmountUsd > 0 && !posted.replayed) {
      issuedVoucherCode = `CHG-${Math.floor(1000 + Math.random() * 9000)}`;
      db.prepare(
        `INSERT OR IGNORE INTO change_vouchers (organisation_id, voucher_code, customer_name, customer_phone, amount_cents, department_name, status, created_by_name)
         VALUES (?, ?, ?, ?, ?, ?, 'UNREDEEMED', ?)`,
      ).run(
        orgId,
        issuedVoucherCode,
        b.customerName || 'Walk-In Customer',
        b.customerPhone || null,
        toCents(b.changeVoucherAmountUsd),
        b.departmentName,
        req.user!.name,
      );
    }

    // Generate ZIMRA Fiscalization record for this sale
    let fiscalReceipt: Record<string, unknown> | null = null;
    if (!posted.replayed && posted.documentId) {
      const fiscalReceiptNo = `FR-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;
      const orgRow = db.prepare('SELECT id, name FROM organisations WHERE id = ?').get(orgId) as { id: number; name: string } | undefined;
      const deviceId = 'ESD-ZW-88421';
      const tinNumber = '1002948201';
      const vatNumber = '10029482';
      const totalCents = totalSaleCents;
      const tax15Cents = Math.round((totalCents * 15) / 115);
      const subtotalCents = totalCents - tax15Cents;
      const verificationUrl = `https://fdms.zimra.co.zw/verify?tin=${tinNumber}&rcpt=${fiscalReceiptNo}&amt=${fromCents(totalCents)}`;
      const qrPayload = `ZIMRA*${tinNumber}*${vatNumber}*${deviceId}*${fiscalReceiptNo}*${fromCents(totalCents)}*${fromCents(tax15Cents)}*${new Date().toISOString()}`;

      db.prepare(
        `INSERT INTO fiscal_receipts
          (organisation_id, document_id, receipt_number, fiscal_day, device_id, vat_number, tin_number, qr_code_payload, verification_url, tax_15_cents, tax_0_cents, subtotal_cents, total_cents, currency_code, cashier_name, department_name)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'USD', ?, ?)`
      ).run(
        orgId,
        posted.documentId,
        fiscalReceiptNo,
        deviceId,
        vatNumber,
        tinNumber,
        qrPayload,
        verificationUrl,
        tax15Cents,
        subtotalCents,
        totalCents,
        req.user!.name,
        b.departmentName,
      );

      fiscalReceipt = {
        receiptNumber: fiscalReceiptNo,
        deviceId,
        tinNumber,
        vatNumber,
        verificationUrl,
        qrCodePayload: qrPayload,
        totalUsd: fromCents(totalCents),
        tax15Usd: fromCents(tax15Cents),
        subtotalUsd: fromCents(subtotalCents),
        fiscalTime: new Date().toISOString(),
      };
    }

    return reply.code(posted.replayed ? 200 : 201).send({
      replayed: posted.replayed,
      document: doc,
      totalSaleUsd: fromCents(totalSaleCents),
      issuedVoucherCode,
      fiscalReceipt,
    });
  });

  // Chikwereti (Customer Credit) CRUD
  app.post('/api/sme/debtors', { preHandler: staff }, async (req, reply) => {
    const orgId = req.user!.organisationId;
    const b = z
      .object({
        customerName: name,
        phone: z.string().trim().min(3).max(40),
        departmentName: z.string().trim().min(2).max(60).default('Groceries'),
        creditLimit: money.default(200),
        balance: money.default(0),
        dueDate: z.string().trim().min(8).max(20),
        itemsSummary: z.string().trim().max(300).default('Counter credit account'),
      })
      .strict()
      .parse(req.body);
    const res = db
      .prepare(
        `INSERT INTO customer_credit_accounts (organisation_id, customer_name, phone, department_name, credit_limit_cents, balance_cents, due_date, items_summary, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'CURRENT')`,
      )
      .run(orgId, b.customerName, b.phone, b.departmentName, toCents(b.creditLimit), toCents(b.balance), b.dueDate, b.itemsSummary);
    return reply.code(201).send({ id: Number(res.lastInsertRowid) });
  });

  app.post('/api/sme/debtors/:id/repay', { preHandler: staff }, async (req) => {
    const { id: rowId } = idParam.parse(req.params);
    const orgId = req.user!.organisationId;
    const b = z.object({ amount: money.positive() }).strict().parse(req.body);
    const row = db
      .prepare('SELECT id, balance_cents FROM customer_credit_accounts WHERE id = ? AND organisation_id = ?')
      .get(rowId, orgId) as { id: number; balance_cents: number } | undefined;
    if (!row) throw new AppError(404, 'not_found');
    const nextBalance = Math.max(0, row.balance_cents - toCents(b.amount));
    const nextStatus = nextBalance === 0 ? 'CLEARED' : 'CURRENT';
    db.prepare("UPDATE customer_credit_accounts SET balance_cents = ?, status = ?, updated_at = datetime('now') WHERE id = ?").run(nextBalance, nextStatus, rowId);
    return { ok: true, balance: fromCents(nextBalance), status: nextStatus };
  });

  // Supplier Balances Owed (Creditors) CRUD
  app.post('/api/sme/creditors', { preHandler: staff }, async (req, reply) => {
    const orgId = req.user!.organisationId;
    const b = z
      .object({
        supplierName: name,
        invoiceRef: z.string().trim().min(1).max(60),
        departmentName: z.string().trim().max(60).default('Groceries & Hardware'),
        totalAmount: money.positive(),
        paidAmount: money.default(0),
        currencyCode: z.string().trim().max(8).default('USD'),
        dueDate: z.string().trim().min(8).max(20),
        notes: text(200),
      })
      .strict()
      .parse(req.body);
    const totalCents = toCents(b.totalAmount);
    const paidCents = Math.min(totalCents, toCents(b.paidAmount));
    const balCents = Math.max(0, totalCents - paidCents);
    const status = balCents === 0 ? 'SETTLED' : paidCents > 0 ? 'PARTIAL' : 'OWED';
    const res = db
      .prepare(
        `INSERT INTO supplier_credit_ledgers (organisation_id, supplier_name, invoice_ref, department_name, total_cents, paid_cents, balance_cents, currency_code, due_date, notes, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(orgId, b.supplierName, b.invoiceRef, b.departmentName, totalCents, paidCents, balCents, b.currencyCode, b.dueDate, b.notes, status);
    return reply.code(201).send({ id: Number(res.lastInsertRowid) });
  });

  app.post('/api/sme/creditors/:id/pay', { preHandler: staff }, async (req) => {
    const { id: rowId } = idParam.parse(req.params);
    const orgId = req.user!.organisationId;
    const b = z.object({ amount: money.positive() }).strict().parse(req.body);
    const row = db
      .prepare('SELECT id, total_cents, paid_cents, balance_cents FROM supplier_credit_ledgers WHERE id = ? AND organisation_id = ?')
      .get(rowId, orgId) as { id: number; total_cents: number; paid_cents: number; balance_cents: number } | undefined;
    if (!row) throw new AppError(404, 'not_found');
    const addCents = toCents(b.amount);
    const nextPaid = Math.min(row.total_cents, row.paid_cents + addCents);
    const nextBal = Math.max(0, row.total_cents - nextPaid);
    const nextStatus = nextBal === 0 ? 'SETTLED' : 'PARTIAL';
    db.prepare("UPDATE supplier_credit_ledgers SET paid_cents = ?, balance_cents = ?, status = ?, updated_at = datetime('now') WHERE id = ?").run(
      nextPaid,
      nextBal,
      nextStatus,
      rowId,
    );
    return { ok: true, paidAmount: fromCents(nextPaid), balanceOwed: fromCents(nextBal), status: nextStatus };
  });

  // Paid & Uncollected Stock (Hardware "Collect Later" / Lay-By)
  app.post('/api/sme/layby', { preHandler: staff }, async (req, reply) => {
    const orgId = req.user!.organisationId;
    const b = z
      .object({
        receiptRef: z.string().trim().min(1).max(60),
        customerName: name,
        customerPhone: z.string().trim().min(3).max(40),
        productName: z.string().trim().min(1).max(120),
        departmentName: z.string().trim().max(60).default('Hardware & Building'),
        warehouseName: z.string().trim().max(80).default('Main Warehouse'),
        orderedQty: qty.positive(),
        collectedQty: qty.min(0).default(0),
        unit: z.string().trim().min(1).max(20).default('bag'),
        totalPaid: money.default(0),
      })
      .strict()
      .parse(req.body);
    const status = b.collectedQty >= b.orderedQty ? 'COMPLETED' : b.collectedQty > 0 ? 'PARTIAL_COLLECTED' : 'AWAITING_COLLECTION';
    const res = db
      .prepare(
        `INSERT INTO paid_uncollected_items
          (organisation_id, receipt_ref, customer_name, customer_phone, product_name, department_name, warehouse_name, ordered_qty, collected_qty, unit, total_paid_cents, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        orgId,
        b.receiptRef,
        b.customerName,
        b.customerPhone,
        b.productName,
        b.departmentName,
        b.warehouseName,
        b.orderedQty,
        b.collectedQty,
        b.unit,
        toCents(b.totalPaid),
        status,
      );
    return reply.code(201).send({ id: Number(res.lastInsertRowid) });
  });

  app.post('/api/sme/layby/:id/collect', { preHandler: staff }, async (req) => {
    const { id: rowId } = idParam.parse(req.params);
    const orgId = req.user!.organisationId;
    const b = z.object({ collectQty: qty.positive() }).strict().parse(req.body);
    const row = db
      .prepare('SELECT id, ordered_qty, collected_qty FROM paid_uncollected_items WHERE id = ? AND organisation_id = ?')
      .get(rowId, orgId) as { id: number; ordered_qty: number; collected_qty: number } | undefined;
    if (!row) throw new AppError(404, 'not_found');
    const nextCollected = Math.min(row.ordered_qty, row.collected_qty + b.collectQty);
    const nextStatus = nextCollected >= row.ordered_qty ? 'COMPLETED' : 'PARTIAL_COLLECTED';
    db.prepare("UPDATE paid_uncollected_items SET collected_qty = ?, status = ?, updated_at = datetime('now') WHERE id = ?").run(
      nextCollected,
      nextStatus,
      rowId,
    );
    return {
      ok: true,
      collectedQty: nextCollected,
      remainingQty: Math.max(0, row.ordered_qty - nextCollected),
      status: nextStatus,
    };
  });

  // Multi-Tender Till Shifts & Cash-Up
  app.post('/api/sme/till-shifts', { preHandler: staff }, async (req, reply) => {
    const orgId = req.user!.organisationId;
    const b = z
      .object({
        shiftRef: z.string().trim().min(1).max(60),
        cashierName: name,
        departmentName: z.string().trim().max(60).default('General Store & Yard'),
        expectedUsd: money.default(0),
        countedUsd: money.default(0),
        expectedZig: money.default(0),
        countedZig: money.default(0),
        expectedZar: money.default(0),
        countedZar: money.default(0),
        ecocashUsd: money.default(0),
        ecocashZig: money.default(0),
        innbucksUsd: money.default(0),
        onemoneyZig: money.default(0),
        changeVouchersIssued: money.default(0),
        notes: text(200),
      })
      .strict()
      .parse(req.body);
    const expUsdCents = toCents(b.expectedUsd);
    const cntUsdCents = toCents(b.countedUsd);
    const varCents = cntUsdCents - expUsdCents;
    const status = varCents === 0 ? 'BALANCED' : varCents < 0 ? 'SHORTAGE' : 'SURPLUS';
    const res = db
      .prepare(
        `INSERT INTO till_shifts
          (organisation_id, shift_ref, cashier_name, department_name, expected_usd_cents, counted_usd_cents, expected_zig_cents, counted_zig_cents, expected_zar_cents, counted_zar_cents, ecocash_usd_cents, ecocash_zig_cents, innbucks_usd_cents, onemoney_zig_cents, change_vouchers_issued_cents, variance_usd_cents, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        orgId,
        b.shiftRef,
        b.cashierName,
        b.departmentName,
        expUsdCents,
        cntUsdCents,
        toCents(b.expectedZig),
        toCents(b.countedZig),
        toCents(b.expectedZar),
        toCents(b.countedZar),
        toCents(b.ecocashUsd),
        toCents(b.ecocashZig),
        toCents(b.innbucksUsd),
        toCents(b.onemoneyZig),
        toCents(b.changeVouchersIssued),
        varCents,
        status,
        b.notes,
      );
    return reply.code(201).send({ id: Number(res.lastInsertRowid), status, varianceUsd: fromCents(varCents) });
  });

  // USD Small-Change Vouchers
  app.post('/api/sme/change-vouchers', { preHandler: staff }, async (req, reply) => {
    const orgId = req.user!.organisationId;
    const b = z
      .object({
        customerName: z.string().trim().min(1).max(80).default('Walk-In Customer'),
        customerPhone: text(40),
        amountUsd: z.number().positive().max(100),
        departmentName: z.string().trim().max(60).default('Groceries'),
      })
      .strict()
      .parse(req.body);
    const code = `CHG-${Math.floor(1000 + Math.random() * 9000)}`;
    const res = db
      .prepare(
        `INSERT INTO change_vouchers (organisation_id, voucher_code, customer_name, customer_phone, amount_cents, department_name, status, created_by_name)
         VALUES (?, ?, ?, ?, ?, ?, 'UNREDEEMED', ?)`,
      )
      .run(orgId, code, b.customerName, b.customerPhone, toCents(b.amountUsd), b.departmentName, req.user!.name);
    return reply.code(201).send({ id: Number(res.lastInsertRowid), voucherCode: code });
  });

  app.post('/api/sme/change-vouchers/:id/redeem', { preHandler: staff }, async (req) => {
    const { id: rowId } = idParam.parse(req.params);
    const orgId = req.user!.organisationId;
    const row = db
      .prepare('SELECT id FROM change_vouchers WHERE id = ? AND organisation_id = ?')
      .get(rowId, orgId) as { id: number } | undefined;
    if (!row) throw new AppError(404, 'not_found');
    db.prepare("UPDATE change_vouchers SET status = 'REDEEMED', redeemed_at = datetime('now') WHERE id = ?").run(rowId);
    return { ok: true };
  });

  // Break-Bulk & Recipe Yield Batches (with optional real stock adjustment posting)
  app.post('/api/sme/yield-batches', { preHandler: staff }, async (req, reply) => {
    const orgId = req.user!.organisationId;
    const b = z
      .object({
        kind: z.enum(['BREAK_BULK', 'RECIPE_YIELD']).default('BREAK_BULK'),
        departmentName: z.string().trim().max(60).default('Groceries'),
        sourceName: z.string().trim().min(1).max(120),
        inputQty: qty.positive(),
        inputUnit: z.string().trim().min(1).max(30),
        outputName: z.string().trim().min(1).max(120),
        expectedOutputQty: qty.positive(),
        actualOutputQty: qty.positive(),
        outputUnit: z.string().trim().min(1).max(30),
        productId: id.nullish(),
        warehouseId: id.nullish(),
        unitId: id.nullish(),
        deltaBaseQty: qty.optional(),
      })
      .strict()
      .parse(req.body);

    let docId: number | null = null;
    if (b.productId && b.warehouseId && b.unitId && b.deltaBaseQty && b.deltaBaseQty !== 0) {
      const posted = postDocument(db, req.user!, {
        type: 'adjustment',
        reference: `YLD-${Date.now().toString().slice(-5)}`,
        reason: `${b.kind === 'BREAK_BULK' ? 'Break-Bulk' : 'Yield Transformation'}: ${b.sourceName} -> ${b.outputName}`,
        idempotencyKey: `yield-${orgId}-${Date.now()}-${Math.random()}`,
        lines: [
          {
            productId: b.productId,
            warehouseId: b.warehouseId,
            unitId: b.unitId,
            quantityMilli: toMilli(b.deltaBaseQty),
          },
        ],
      });
      docId = posted.documentId;
    }

    const wasteQty = Math.max(0, Math.round((b.expectedOutputQty - b.actualOutputQty) * 100) / 100);
    const yieldPct = Math.round((b.actualOutputQty / b.expectedOutputQty) * 1000) / 10;
    const batchRef = `${b.kind === 'BREAK_BULK' ? 'BRK' : 'YLD'}-${Date.now().toString().slice(-5)}`;
    const res = db
      .prepare(
        `INSERT INTO yield_batches
          (organisation_id, batch_ref, kind, department_name, source_name, input_qty, input_unit, output_name, expected_output_qty, actual_output_qty, output_unit, waste_qty, yield_pct, document_id, created_by_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        orgId,
        batchRef,
        b.kind,
        b.departmentName,
        b.sourceName,
        b.inputQty,
        b.inputUnit,
        b.outputName,
        b.expectedOutputQty,
        b.actualOutputQty,
        b.outputUnit,
        wasteQty,
        yieldPct,
        docId,
        req.user!.name,
      );
    return reply.code(201).send({ id: Number(res.lastInsertRowid), batchRef, documentId: docId, yieldPct });
  });

  // Staff 4-Digit Fast PIN Directory
  app.post('/api/sme/staff-pins', { preHandler: staff }, async (req, reply) => {
    const orgId = req.user!.organisationId;
    const b = z
      .object({
        staffName: name,
        roleTitle: z.string().trim().min(2).max(60).default('Storefloor Counter Staff'),
        pinCode: z.string().trim().regex(/^\d{4}$/, 'PIN must be 4 digits'),
        departmentScope: z.string().trim().max(60).default('Groceries & Hardware'),
        canViewCost: z.boolean().default(false),
        canWriteOff: z.boolean().default(false),
      })
      .strict()
      .parse(req.body);
    const execU = db.prepare('SELECT id FROM users WHERE organisation_id = ? ORDER BY id DESC LIMIT 1').get(orgId) as { id: number } | undefined;
    const res = db
      .prepare(
        `INSERT INTO staff_pins (organisation_id, user_id, staff_name, role_title, pin_code, department_scope, can_view_cost, can_write_off, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      )
      .run(orgId, execU?.id ?? req.user!.id, b.staffName, b.roleTitle, b.pinCode, b.departmentScope, b.canViewCost ? 1 : 0, b.canWriteOff ? 1 : 0);
    return reply.code(201).send({ id: Number(res.lastInsertRowid) });
  });

  app.patch('/api/sme/staff-pins/:id', { preHandler: staff }, async (req) => {
    const { id: rowId } = idParam.parse(req.params);
    const orgId = req.user!.organisationId;
    const b = z
      .object({
        active: z.boolean().optional(),
        canViewCost: z.boolean().optional(),
        canWriteOff: z.boolean().optional(),
        pinCode: z.string().trim().regex(/^\d{4}$/).optional(),
      })
      .strict()
      .parse(req.body);
    if (!db.prepare('SELECT 1 FROM staff_pins WHERE id = ? AND organisation_id = ?').get(rowId, orgId)) throw new AppError(404, 'not_found');
    update(db, 'staff_pins', rowId, {
      active: flag(b.active),
      can_view_cost: flag(b.canViewCost),
      can_write_off: flag(b.canWriteOff),
      pin_code: b.pinCode,
    });
    return { ok: true };
  });

  // ---------- Stage 8: System Reset, Quick Setup & POS Fast Catalog ----------

  // Reset entire database to empty scratch state (leaves only structure & executive user)
  app.post('/api/system/reset', { preHandler: exec }, async (req) => {
    const orgId = req.user!.organisationId;
    db.exec('PRAGMA foreign_keys = OFF;');
    try {
      // Clear transactional tables
      db.prepare('DELETE FROM document_attachments WHERE organisation_id = ?').run(orgId);
      db.prepare('DELETE FROM fiscal_receipts WHERE organisation_id = ?').run(orgId);
      db.prepare('DELETE FROM change_vouchers WHERE organisation_id = ?').run(orgId);
      db.prepare('DELETE FROM till_shifts WHERE organisation_id = ?').run(orgId);
      db.prepare('DELETE FROM paid_uncollected_items WHERE organisation_id = ?').run(orgId);
      db.prepare('DELETE FROM customer_credit_accounts WHERE organisation_id = ?').run(orgId);
      db.prepare('DELETE FROM supplier_credit_ledgers WHERE organisation_id = ?').run(orgId);
      db.prepare('DELETE FROM yield_batches WHERE organisation_id = ?').run(orgId);
      db.prepare('DELETE FROM stock_movements WHERE organisation_id = ?').run(orgId);
      db.prepare('DELETE FROM stock_documents WHERE organisation_id = ?').run(orgId);
      db.prepare('DELETE FROM purchase_order_receipts').run();
      db.prepare('DELETE FROM purchase_order_lines').run();
      db.prepare('DELETE FROM purchase_orders WHERE organisation_id = ?').run(orgId);
      db.prepare('DELETE FROM requisitions WHERE organisation_id = ?').run(orgId);
      db.prepare('DELETE FROM count_sheet_lines').run();
      db.prepare('DELETE FROM count_sheets WHERE organisation_id = ?').run(orgId);
      db.prepare('DELETE FROM product_packagings').run();
      db.prepare('DELETE FROM products WHERE organisation_id = ?').run(orgId);
      db.prepare('DELETE FROM suppliers WHERE organisation_id = ?').run(orgId);
      db.prepare('DELETE FROM categories WHERE organisation_id = ?').run(orgId);
      db.prepare('DELETE FROM departments WHERE branch_id IN (SELECT id FROM branches WHERE organisation_id = ?)').run(orgId);
      db.prepare('DELETE FROM warehouses WHERE branch_id IN (SELECT id FROM branches WHERE organisation_id = ?)').run(orgId);
      db.prepare('DELETE FROM branches WHERE organisation_id = ?').run(orgId);
      db.prepare('DELETE FROM staff_pins WHERE organisation_id = ?').run(orgId);
      db.prepare('DELETE FROM system_backups WHERE organisation_id = ?').run(orgId);
      db.prepare('DELETE FROM role_permissions WHERE organisation_id = ?').run(orgId);
      db.prepare('DELETE FROM audit_logs WHERE organisation_id = ?').run(orgId);

      // Re-create default clean branch, main warehouse, and starter units if needed
      const branchRes = db.prepare('INSERT INTO branches (organisation_id, name, city) VALUES (?, ?, ?)').run(orgId, 'Main Branch', 'Harare');
      const branchId = Number(branchRes.lastInsertRowid);
      db.prepare('INSERT INTO warehouses (branch_id, name) VALUES (?, ?)').run(branchId, 'Main Store & Yard');
      const deptRes = db.prepare('INSERT INTO departments (branch_id, name) VALUES (?, ?)').run(branchId, 'General Storefloor');
      const defaultDeptId = Number(deptRes.lastInsertRowid);

      db.prepare("UPDATE organisations SET pos_department_id = ?, initialized_at = NULL WHERE id = ?").run(defaultDeptId, orgId);

      recordAudit(db, req.user!, 'system.reset', 'organisation', orgId, { resetToScratch: true });
    } finally {
      db.exec('PRAGMA foreign_keys = ON;');
    }
    return { ok: true, message: 'All demo products, orders, sales, and movements have been cleared. Ready to initialize from scratch.' };
  });

  // Fast Setup Wizard: Initialize organisation name, initial departments, warehouses, and seed starter stock or template products
  app.post('/api/system/initialize', { preHandler: exec }, async (req) => {
    const orgId = req.user!.organisationId;
    const b = z
      .object({
        organisationName: z.string().trim().min(2).max(120),
        currencyCode: z.enum(['USD', 'ZiG', 'ZAR']).default('USD'),
        branchName: z.string().trim().min(2).max(80).default('Main Branch'),
        city: z.string().trim().max(60).default('Harare'),
        departments: z.array(z.string().trim().min(1).max(60)).min(1),
        posDepartmentName: z.string().trim().min(1).max(60),
        starterProducts: z
          .array(
            z.object({
              sku: z.string().trim().min(1).max(40),
              name: z.string().trim().min(1).max(120),
              department: z.string().trim().min(1).max(60),
              unitCost: money.default(1),
              sellingPrice: money.default(1.5),
              vatCategory: z.enum(['standard_15', 'zero_rated', 'exempt']).default('standard_15'),
              initialStock: qty.min(0).default(0),
            })
          )
          .optional(),
      })
      .strict()
      .parse(req.body);

    db.prepare("UPDATE organisations SET name = ?, currency_code = ?, initialized_at = datetime('now') WHERE id = ?").run(
      b.organisationName,
      b.currencyCode,
      orgId
    );

    // Ensure branch exists
    let branchRow = db.prepare('SELECT id FROM branches WHERE organisation_id = ? AND name = ?').get(orgId, b.branchName) as { id: number } | undefined;
    if (!branchRow) {
      const br = db.prepare('INSERT INTO branches (organisation_id, name, city) VALUES (?, ?, ?)').run(orgId, b.branchName, b.city);
      branchRow = { id: Number(br.lastInsertRowid) };
    }
    const branchId = branchRow.id;

    // Ensure warehouse exists
    let whRow = db.prepare('SELECT id FROM warehouses WHERE branch_id = ? AND name = ?').get(branchId, 'Main Store & Yard') as { id: number } | undefined;
    if (!whRow) {
      const wh = db.prepare('INSERT INTO warehouses (branch_id, name) VALUES (?, ?)').run(branchId, 'Main Store & Yard');
      whRow = { id: Number(wh.lastInsertRowid) };
    }
    const warehouseId = whRow.id;

    // Ensure units of measure exist
    const addUnit = db.prepare('INSERT OR IGNORE INTO units_of_measure (organisation_id, code, name) VALUES (?, ?, ?)');
    for (const [code, label] of [['each', 'Each'], ['kg', 'Kilogram'], ['l', 'Litre'], ['box', 'Box'], ['carton', 'Carton']]) {
      addUnit.run(orgId, code, label);
    }
    const eachUnitRow = db.prepare("SELECT id FROM units_of_measure WHERE organisation_id = ? AND code = 'each'").get(orgId) as { id: number };
    const eachUnitId = eachUnitRow?.id ?? 1;

    // Insert departments
    let posDeptId: number | null = null;
    for (const deptName of b.departments) {
      let dRow = db.prepare('SELECT id FROM departments WHERE branch_id = ? AND name = ?').get(branchId, deptName) as { id: number } | undefined;
      if (!dRow) {
        const dRes = db.prepare('INSERT INTO departments (branch_id, name) VALUES (?, ?)').run(branchId, deptName);
        dRow = { id: Number(dRes.lastInsertRowid) };
      }
      if (deptName === b.posDepartmentName || !posDeptId) {
        posDeptId = dRow.id;
      }
    }

    if (posDeptId) {
      db.prepare('UPDATE organisations SET pos_department_id = ? WHERE id = ?').run(posDeptId, orgId);
    }

    // Insert starter products if provided
    if (b.starterProducts && b.starterProducts.length > 0) {
      for (const p of b.starterProducts) {
        const dRow = db.prepare('SELECT id FROM departments WHERE branch_id = ? AND name = ?').get(branchId, p.department) as { id: number } | undefined;
        const deptId = dRow?.id ?? posDeptId;
        const pRes = db
          .prepare(
            `INSERT OR IGNORE INTO products
              (organisation_id, sku, name, base_unit_id, unit_cost_cents, selling_price_cents, wholesale_price_cents, vat_category, department_id, active)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
          )
          .run(
            orgId,
            p.sku,
            p.name,
            eachUnitId,
            toCents(p.unitCost),
            toCents(p.sellingPrice),
            toCents(p.sellingPrice * 0.9),
            p.vatCategory,
            deptId
          );

        const prodId = Number(pRes.lastInsertRowid);
        if (prodId > 0 && p.initialStock > 0) {
          postDocument(db, req.user!, {
            type: 'receipt',
            reference: 'INIT-STOCK-001',
            reason: 'Opening stock count during system initialization',
            idempotencyKey: `init-stock-${prodId}-${Date.now()}`,
            lines: [
              {
                productId: prodId,
                warehouseId,
                unitId: eachUnitId,
                quantityMilli: toMilli(p.initialStock),
                unitCostCents: toCents(p.unitCost),
              },
            ],
          });
        }
      }
    }

    recordAudit(db, req.user!, 'system.initialize', 'organisation', orgId, {
      name: b.organisationName,
      currency: b.currencyCode,
      departments: b.departments,
      posDepartmentName: b.posDepartmentName,
    });

    return { ok: true, posDepartmentId: posDeptId };
  });

  // Fast POS Catalog endpoint: returns active products for the executive-assigned POS department with real-time stock
  app.get('/api/pos/catalog', { preHandler: staff }, async (req) => {
    const orgId = req.user!.organisationId;
    const orgRow = db.prepare('SELECT pos_department_id, currency_code FROM organisations WHERE id = ?').get(orgId) as {
      pos_department_id: number | null;
      currency_code: string;
    } | undefined;

    const posDeptId = orgRow?.pos_department_id ?? null;
    let deptName = 'All Departments';
    if (posDeptId) {
      const d = db.prepare('SELECT name FROM departments WHERE id = ?').get(posDeptId) as { name: string } | undefined;
      if (d) deptName = d.name;
    }

    // Select products filtered by pos_department_id if set, along with current stock balance
    const whereDept = posDeptId ? 'AND (p.department_id = ? OR p.department_id IS NULL)' : '';
    const params = posDeptId ? [orgId, posDeptId] : [orgId];

    const rows = db
      .prepare(
        `SELECT p.id, p.sku, p.name, p.unit_cost_cents, p.selling_price_cents, p.wholesale_price_cents,
                p.vat_category AS vatCategory, p.department_id AS departmentId,
                d.name AS departmentName, u.id AS unitId, u.code AS unitCode,
                COALESCE((SELECT SUM(b.quantity_milli) FROM stock_balances b WHERE b.product_id = p.id AND b.organisation_id = p.organisation_id), 0) AS stock_milli
           FROM products p
           JOIN units_of_measure u ON u.id = p.base_unit_id
           LEFT JOIN departments d ON d.id = p.department_id
          WHERE p.organisation_id = ? AND p.active = 1 ${whereDept}
          ORDER BY p.name ASC`
      )
      .all(...params) as {
      id: number;
      sku: string;
      name: string;
      unit_cost_cents: number;
      selling_price_cents: number;
      wholesale_price_cents: number;
      vatCategory: string;
      departmentId: number | null;
      departmentName: string | null;
      unitId: number;
      unitCode: string;
      stock_milli: number;
    }[];

    const warehouses = db.prepare('SELECT id, name FROM warehouses WHERE branch_id IN (SELECT id FROM branches WHERE organisation_id = ?) AND active = 1').all(orgId) as { id: number; name: string }[];
    const allDepartments = db.prepare('SELECT id, name FROM departments WHERE branch_id IN (SELECT id FROM branches WHERE organisation_id = ?) AND active = 1').all(orgId) as { id: number; name: string }[];

    return {
      posDepartmentId: posDeptId,
      posDepartmentName: deptName,
      currencyCode: orgRow?.currency_code ?? 'USD',
      defaultWarehouseId: warehouses[0]?.id ?? 1,
      warehouses,
      departments: allDepartments,
      products: rows.map((r) => ({
        id: r.id,
        sku: r.sku,
        name: r.name,
        unitId: r.unitId,
        unitCode: r.unitCode,
        unitCost: fromCents(r.unit_cost_cents),
        sellingPrice: fromCents(r.selling_price_cents || Math.round(r.unit_cost_cents * 1.3)),
        wholesalePrice: fromCents(r.wholesale_price_cents || r.selling_price_cents),
        vatCategory: r.vatCategory,
        departmentId: r.departmentId,
        departmentName: r.departmentName ?? 'General',
        currentStock: fromMilli(r.stock_milli),
      })),
    };
  });
}
