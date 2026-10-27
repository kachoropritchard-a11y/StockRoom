import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db.ts';
import type { Role } from '../app.ts';
import { AppError } from '../errors.ts';
import { fromMilli, getDocument, postDocument, reverseDocument, toMilli, verifyLedger, type PostableType } from './engine.ts';

type Guard = (...roles: Role[]) => (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

const id = z.number().int().positive();
const name = z.string().trim().min(1).max(120);
const text = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null);
const qty = z.number().finite().min(-1e9).max(1e9);
const paging = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) });
const idParam = z.object({ id: z.coerce.number().int().positive() });
const flag = (v: boolean | undefined) => (v === undefined ? undefined : v ? 1 : 0);

/** Builds "SET a = ?, b = ?" from defined values only. Column names come from code, never from the client. */
function update(db: Db, table: string, rowId: number, cols: Record<string, unknown>) {
  const entries = Object.entries(cols).filter(([, v]) => v !== undefined);
  if (entries.length === 0) throw new AppError(400, 'nothing_to_update');
  db.prepare(`UPDATE ${table} SET ${entries.map(([c]) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...(entries.map(([, v]) => v) as (string | number | null)[]), rowId);
}

export function registerInventoryRoutes(app: FastifyInstance, db: Db, requireAuth: Guard) {
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
    const o = db.prepare('SELECT id, name, allow_negative_stock FROM organisations WHERE id = ?').get(req.user!.organisationId) as { id: number; name: string; allow_negative_stock: number };
    return { id: o.id, name: o.name, allowNegativeStock: !!o.allow_negative_stock };
  });
  app.patch('/api/organisation', { preHandler: exec }, async (req) => {
    const b = z.object({ name: name.optional(), allowNegativeStock: z.boolean().optional() }).strict().parse(req.body);
    update(db, 'organisations', req.user!.organisationId, { name: b.name, allow_negative_stock: flag(b.allowNegativeStock) });
    return { ok: true };
  });

  // ---------- organisation structure (executive manages; everyone signed in can read) ----------
  app.get('/api/branches', { preHandler: anyUser }, async (req) =>
    db.prepare('SELECT id, name, city, active FROM branches WHERE organisation_id = ? ORDER BY name').all(req.user!.organisationId),
  );
  app.post('/api/branches', { preHandler: exec }, async (req, reply) => {
    const b = z.object({ name, city: text(80) }).strict().parse(req.body);
    const r = db.prepare('INSERT INTO branches (organisation_id, name, city) VALUES (?, ?, ?)').run(req.user!.organisationId, b.name, b.city);
    return reply.code(201).send({ id: Number(r.lastInsertRowid) });
  });
  app.patch('/api/branches/:id', { preHandler: exec }, async (req) => {
    const { id: rowId } = idParam.parse(req.params);
    ownedBranch(rowId, req.user!.organisationId);
    const b = z.object({ name: name.optional(), city: text(80).optional(), active: z.boolean().optional() }).strict().parse(req.body);
    update(db, 'branches', rowId, { name: b.name, city: b.city, active: flag(b.active) });
    return { ok: true };
  });

  for (const table of ['warehouses', 'departments'] as const) {
    app.get(`/api/${table}`, { preHandler: anyUser }, async (req) =>
      db
        .prepare(`SELECT t.id, t.branch_id AS branchId, t.name, t.active FROM ${table} t JOIN branches b ON b.id = t.branch_id WHERE b.organisation_id = ? ORDER BY t.name`)
        .all(req.user!.organisationId),
    );
    app.post(`/api/${table}`, { preHandler: exec }, async (req, reply) => {
      const b = z.object({ branchId: id, name }).strict().parse(req.body);
      ownedBranch(b.branchId, req.user!.organisationId);
      const r = db.prepare(`INSERT INTO ${table} (branch_id, name) VALUES (?, ?)`).run(b.branchId, b.name);
      return reply.code(201).send({ id: Number(r.lastInsertRowid) });
    });
    app.patch(`/api/${table}/:id`, { preHandler: exec }, async (req) => {
      const { id: rowId } = idParam.parse(req.params);
      if (!db.prepare(`SELECT 1 FROM ${table} t JOIN branches b ON b.id = t.branch_id WHERE t.id = ? AND b.organisation_id = ?`).get(rowId, req.user!.organisationId)) throw new AppError(404, 'not_found');
      const b = z.object({ name: name.optional(), active: z.boolean().optional() }).strict().parse(req.body);
      update(db, table, rowId, { name: b.name, active: flag(b.active) });
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
    const rows = db
      .prepare(
        `SELECT p.id, p.sku, p.name, p.description, p.category_id AS categoryId, p.base_unit_id AS baseUnitId, u.code AS baseUnit, p.active
           FROM products p JOIN units_of_measure u ON u.id = p.base_unit_id WHERE ${where.join(' AND ')} ORDER BY p.name LIMIT ? OFFSET ?`,
      )
      .all(...params, q.limit, q.offset);
    const total = (db.prepare(`SELECT COUNT(*) n FROM products p WHERE ${where.join(' AND ')}`).get(...params) as { n: number }).n;
    return { items: rows, total };
  });
  app.get('/api/products/:id', { preHandler: anyUser }, async (req) => {
    const { id: rowId } = idParam.parse(req.params);
    const p = db
      .prepare('SELECT p.id, p.sku, p.name, p.description, p.category_id AS categoryId, p.base_unit_id AS baseUnitId, u.code AS baseUnit, p.active FROM products p JOIN units_of_measure u ON u.id = p.base_unit_id WHERE p.id = ? AND p.organisation_id = ?')
      .get(rowId, req.user!.organisationId);
    if (!p) throw new AppError(404, 'not_found');
    const packagings = (db.prepare('SELECT g.id, g.unit_id AS unitId, u.code AS unit, g.factor_milli FROM product_packagings g JOIN units_of_measure u ON u.id = g.unit_id WHERE g.product_id = ?').all(rowId) as { id: number; unitId: number; unit: string; factor_milli: number }[]).map((g) => ({ id: g.id, unitId: g.unitId, unit: g.unit, factor: fromMilli(g.factor_milli) }));
    return { ...p, packagings };
  });
  app.post('/api/products', { preHandler: staff }, async (req, reply) => {
    const orgId = req.user!.organisationId;
    const b = z.object({ sku: z.string().trim().min(1).max(60), name, description: text(500), categoryId: id.nullish(), baseUnitId: id }).strict().parse(req.body);
    owned('units_of_measure', b.baseUnitId, orgId, 'unit_not_found');
    if (b.categoryId) owned('categories', b.categoryId, orgId, 'category_not_found');
    const r = db.prepare('INSERT INTO products (organisation_id, sku, name, description, category_id, base_unit_id) VALUES (?, ?, ?, ?, ?, ?)').run(orgId, b.sku, b.name, b.description, b.categoryId ?? null, b.baseUnitId);
    return reply.code(201).send({ id: Number(r.lastInsertRowid) });
  });
  // The SKU and base unit are fixed once created: posted history is expressed in them.
  app.patch('/api/products/:id', { preHandler: staff }, async (req) => {
    const { id: rowId } = idParam.parse(req.params);
    const orgId = req.user!.organisationId;
    owned('products', rowId, orgId, 'not_found');
    const b = z.object({ name: name.optional(), description: text(500).optional(), categoryId: id.nullable().optional(), active: z.boolean().optional() }).strict().parse(req.body);
    if (b.categoryId) owned('categories', b.categoryId, orgId, 'category_not_found');
    update(db, 'products', rowId, { name: b.name, description: b.description, category_id: b.categoryId, active: flag(b.active) });
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
  const line = { productId: id, warehouseId: id, unitId: id };
  const lines = <T extends z.ZodRawShape>(extra: T) => z.array(z.object({ ...line, ...extra }).strict()).min(1).max(200);
  const posting: Record<PostableType, z.ZodType<{ lines: { productId: number; warehouseId: number; unitId: number; quantity: number; toWarehouseId?: number }[]; reason?: string | null; reference?: string | null; supplierId?: number | null; departmentId?: number | null }>> = {
    receipt: z.object({ reference: common.reference, supplierId: common.supplierId, lines: lines({ quantity: qty.positive() }) }).strict(),
    issue: z.object({ reference: common.reference, departmentId: common.departmentId, lines: lines({ quantity: qty.positive() }) }).strict(),
    transfer: z.object({ reference: common.reference, lines: lines({ toWarehouseId: id, quantity: qty.positive() }) }).strict(),
    adjustment: z.object({ reference: common.reference, reason: z.string().trim().min(3).max(300), lines: lines({ quantity: qty }) }).strict(),
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
        lines: body.lines.map((l) => ({ productId: l.productId, warehouseId: l.warehouseId, toWarehouseId: l.toWarehouseId, unitId: l.unitId, quantityMilli: toMilli(l.quantity) })),
      });
      return reply.code(result.replayed ? 200 : 201).send({ replayed: result.replayed, document: getDocument(db, req.user!.organisationId, result.documentId) });
    });
  }

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
        `SELECT b.product_id AS productId, p.sku, p.name AS productName, b.warehouse_id AS warehouseId, w.name AS warehouseName, u.code AS unit, b.quantity_milli
           FROM stock_balances b JOIN products p ON p.id = b.product_id JOIN warehouses w ON w.id = b.warehouse_id JOIN units_of_measure u ON u.id = p.base_unit_id
          WHERE ${where} ORDER BY p.name, w.name LIMIT ? OFFSET ?`,
      )
      .all(...params, q.limit, q.offset) as ({ quantity_milli: number } & Record<string, unknown>)[]).map(({ quantity_milli, ...r }) => ({ ...r, quantity: fromMilli(quantity_milli) }));
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
        `SELECT m.id, m.document_id AS documentId, d.type, d.reference, d.reason, d.created_at AS createdAt, m.product_id AS productId, p.sku, m.warehouse_id AS warehouseId,
                w.name AS warehouseName, u.code AS unit, m.quantity_milli, m.factor_milli, m.base_delta_milli
           FROM stock_movements m JOIN stock_documents d ON d.id = m.document_id JOIN products p ON p.id = m.product_id
                JOIN warehouses w ON w.id = m.warehouse_id JOIN units_of_measure u ON u.id = m.unit_id
          WHERE ${where} ORDER BY m.id DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, q.limit, q.offset) as ({ quantity_milli: number; factor_milli: number; base_delta_milli: number } & Record<string, unknown>)[]).map(({ quantity_milli, factor_milli, base_delta_milli, ...r }) => ({
      ...r,
      quantity: fromMilli(quantity_milli),
      factor: fromMilli(factor_milli),
      baseChange: fromMilli(base_delta_milli),
    }));
    return { items: rows };
  });

  app.get('/api/stock/verify', { preHandler: exec }, async (req) => verifyLedger(db, req.user!.organisationId));
}
