import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import { AppError } from './errors.ts';
import { fromCents, fromMilli } from './inventory/engine.ts';
import { registerInventoryRoutes } from './inventory/routes.ts';

export type Role = 'executive_manager' | 'inventory_manager';

export interface AuthUser {
  id: number;
  organisationId: number;
  branchId: number | null;
  email: string;
  name: string;
  role: Role;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

const COOKIE = 'sid';
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(200),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(10, 'Password must be at least 10 characters').max(200),
});

export function buildApp(db: Db, config: Config) {
  // Used so unknown-email logins cost the same as wrong-password logins (no user enumeration by timing).
  const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', config.BCRYPT_COST);
  const allowedOrigins = config.CORS_ORIGIN.split(',');
  const app = Fastify({
    bodyLimit: 4 * 1024 * 1024, // 4 MB max request payload
    logger:
      config.NODE_ENV === 'test'
        ? false
        : {
            redact: [
              'req.headers.authorization',
              'req.headers.cookie',
              'res.headers["set-cookie"]',
              'body.password',
              'body.currentPassword',
              'body.newPassword',
              'body.token',
            ],
          },
    trustProxy: config.NODE_ENV === 'production',
  });

  app.register(helmet);
  app.register(cors, { origin: allowedOrigins, credentials: true });
  app.register(cookie);
  app.register(rateLimit, { global: false });

  // CSRF defence for cookie-authenticated state-changing requests:
  //  1. a custom header (cross-site pages cannot send it without a CORS preflight, which only allowed origins pass), and
  //  2. an Origin check when the browser sends one.
  // Bearer-token clients (native/desktop wrappers) are not affected by CSRF and are exempt.
  app.addHook('onRequest', async (req, reply) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.headers.authorization?.startsWith('Bearer ')) return;
    if (req.headers['x-requested-with'] !== 'stockroom') return reply.code(403).send({ error: 'csrf_rejected' });
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.includes(origin) && new URL(origin).host !== req.headers.host) {
      return reply.code(403).send({ error: 'csrf_rejected' });
    }
  });

  app.setErrorHandler((err: Error & { statusCode?: number; issues?: unknown }, req, reply) => {
    if (err instanceof z.ZodError) {
      return reply.code(400).send({ error: 'validation_error', issues: err.issues.map((i) => ({ path: i.path, message: i.message })) });
    }
    if (err instanceof AppError) return reply.code(err.statusCode).send({ error: err.message, details: err.details });
    // Database constraint violations that slipped past explicit checks are still client errors, not crashes.
    if (/UNIQUE constraint failed/.test(err.message)) return reply.code(409).send({ error: 'duplicate' });
    if (/FOREIGN KEY constraint failed|CHECK constraint failed/.test(err.message)) return reply.code(409).send({ error: 'constraint_violation' });
    if (/stock_movements is append-only|stock_documents is append-only|audit_logs_are_immutable/.test(err.message)) {
      return reply.code(409).send({ error: 'immutable_record' });
    }
    const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    if (status === 500) req.log.error(err);
    const safeCode =
      status === 429
        ? 'rate_limit_exceeded'
        : status === 413
          ? 'payload_too_large'
          : status === 400
            ? 'bad_request'
            : status === 401
              ? 'unauthenticated'
              : status === 403
                ? 'forbidden'
                : status === 404
                  ? 'not_found'
                  : 'internal_error';
    reply.code(status).send({ error: safeCode });
  });

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'not_found' }));

  function authenticate(req: FastifyRequest): AuthUser | null {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : req.cookies[COOKIE];
    if (!token) return null;
    const row = db
      .prepare(
        `SELECT u.id, u.organisation_id, u.branch_id, u.email, u.name, u.role
           FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`,
      )
      .get(sha256(token), new Date().toISOString()) as
      | { id: number; organisation_id: number; branch_id: number | null; email: string; name: string; role: Role }
      | undefined;
    if (!row) return null;
    return { id: row.id, organisationId: row.organisation_id, branchId: row.branch_id, email: row.email, name: row.name, role: row.role };
  }

  /** preHandler factory: requires a valid session and (optionally) one of the given roles. */
  const requireAuth = (...roles: Role[]) => async (req: FastifyRequest, reply: FastifyReply) => {
    const user = authenticate(req);
    if (!user) return reply.code(401).send({ error: 'unauthenticated' });
    if (roles.length && !roles.includes(user.role)) return reply.code(403).send({ error: 'forbidden' });
    req.user = user;
  };

  app.get('/api/health', async () => {
    db.prepare('SELECT 1').get();
    return { status: 'ok' };
  });

  app.post('/api/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = loginSchema.parse(req.body);
    const u = db
      .prepare('SELECT id, password_hash, active, failed_attempts, locked_until FROM users WHERE email = ?')
      .get(body.email) as
      | { id: number; password_hash: string; active: number; failed_attempts: number; locked_until: string | null }
      | undefined;
    const ok = await bcrypt.compare(body.password, u?.password_hash ?? DUMMY_HASH);
    // Locked accounts are rejected even with the correct password until the lock expires.
    if (u?.locked_until && u.locked_until > new Date().toISOString()) {
      return reply.code(423).send({ error: 'account_locked' });
    }
    if (!u || !u.active || !ok) {
      if (u) {
        const attempts = u.failed_attempts + 1;
        if (attempts >= config.MAX_LOGIN_ATTEMPTS) {
          const until = new Date(Date.now() + config.LOCKOUT_MINUTES * 60_000).toISOString();
          db.prepare('UPDATE users SET failed_attempts = 0, locked_until = ? WHERE id = ?').run(until, u.id);
        } else {
          db.prepare('UPDATE users SET failed_attempts = ? WHERE id = ?').run(attempts, u.id);
        }
      }
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(u.id);

    const token = randomBytes(32).toString('base64url');
    const expires = new Date(Date.now() + config.SESSION_TTL_HOURS * 3600_000);
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha256(token), u.id, expires.toISOString());
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString());

    reply.setCookie(COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.NODE_ENV === 'production',
      path: '/',
      expires,
    });
    const r = db
      .prepare('SELECT id, organisation_id, branch_id, email, name, role FROM users WHERE id = ?')
      .get(u.id) as { id: number; organisation_id: number; branch_id: number | null; email: string; name: string; role: Role };
    const user: AuthUser = { id: r.id, organisationId: r.organisation_id, branchId: r.branch_id, email: r.email, name: r.name, role: r.role };
    // `token` in the body supports native/desktop wrappers that prefer Bearer auth over cookies.
    return { user, token };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : req.cookies[COOKIE];
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  // Signed-in users change their own password; all their other sessions are revoked.
  app.post('/api/auth/change-password', { preHandler: requireAuth(), config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = changePasswordSchema.parse(req.body);
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user!.id) as { password_hash: string };
    if (!(await bcrypt.compare(body.currentPassword, row.password_hash))) {
      return reply.code(400).send({ error: 'incorrect_current_password' });
    }
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : req.cookies[COOKIE];
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await bcrypt.hash(body.newPassword, config.BCRYPT_COST), req.user!.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(req.user!.id, sha256(token!));
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: requireAuth() }, async (req) => ({ user: req.user }));

  // Self-service password reset: stores hashed token + writes to email_outbox so it works with or without an external SMTP relay.
  app.post('/api/auth/forgot-password', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req) => {
    const { email } = z.object({ email: z.string().trim().email().max(254) }).parse(req.body);
    const u = db.prepare('SELECT id, email, active FROM users WHERE email = ?').get(email) as { id: number; email: string; active: number } | undefined;
    let resetToken: string | undefined;
    if (u && u.active) {
      resetToken = randomBytes(24).toString('base64url');
      const expires = new Date(Date.now() + 30 * 60_000).toISOString();
      db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(u.id);
      db.prepare('INSERT INTO password_reset_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha256(resetToken), u.id, expires);
      db.prepare('INSERT INTO email_outbox (to_email, subject, body) VALUES (?, ?, ?)').run(
        u.email,
        'Stockroom password reset',
        `Use reset token: ${resetToken} (valid for 30 minutes)`,
      );
    }
    return { ok: true, ...(config.NODE_ENV !== 'production' && resetToken ? { resetToken } : {}) };
  });

  app.post('/api/auth/reset-password', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = z.object({ token: z.string().min(10).max(200), newPassword: z.string().min(10).max(200) }).parse(req.body);
    const row = db
      .prepare('SELECT user_id FROM password_reset_tokens WHERE token_hash = ? AND expires_at > ?')
      .get(sha256(body.token), new Date().toISOString()) as { user_id: number } | undefined;
    if (!row) return reply.code(400).send({ error: 'invalid_or_expired_reset_token' });
    const hash = await bcrypt.hash(body.newPassword, config.BCRYPT_COST);
    db.prepare('UPDATE users SET password_hash = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?').run(hash, row.user_id);
    db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(row.user_id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.user_id);
    return { ok: true };
  });

  // Dashboard summary, scoped to the caller's organisation (and branch for branch-scoped inventory managers), combining structure and live ledger metrics.
  app.get('/api/dashboard/summary', { preHandler: requireAuth() }, async (req) => {
    const org = req.user!.organisationId;
    const branchId = req.user!.role === 'inventory_manager' ? req.user!.branchId : null;
    const branchFilter = branchId !== null ? ` AND w.branch_id = ${Number(branchId)}` : '';
    const count = (sql: string) => (db.prepare(sql).get(org) as { n: number }).n;

    const valueRow = db
      .prepare(
        `SELECT COALESCE(SUM(b.quantity_milli), 0) AS total_units_milli,
                COALESCE(SUM(b.quantity_milli * p.unit_cost_cents), 0) AS total_milli_cents
           FROM stock_balances b
           JOIN products p ON p.id = b.product_id
           JOIN warehouses w ON w.id = b.warehouse_id
          WHERE b.organisation_id = ? AND b.quantity_milli > 0${branchFilter}`,
      )
      .get(org) as { total_units_milli: number; total_milli_cents: number };
    const totalStockUnits = fromMilli(valueRow.total_units_milli);
    const totalStockValue = Math.round(valueRow.total_milli_cents / 1000) / 100;

    const movementBreakdown = db
      .prepare(
        `SELECT d.type,
                COUNT(DISTINCT d.id) AS doc_count,
                COALESCE(SUM(CASE WHEN d.type = 'transfer' THEN (CASE WHEN m.base_delta_milli > 0 THEN m.base_delta_milli ELSE 0 END) ELSE abs(m.base_delta_milli) END), 0) AS units_milli
           FROM stock_documents d
           JOIN stock_movements m ON m.document_id = d.id
           JOIN warehouses w ON w.id = m.warehouse_id
          WHERE d.organisation_id = ?${branchFilter}
            AND NOT EXISTS (SELECT 1 FROM stock_documents rev WHERE rev.reverses_document_id = d.id)
          GROUP BY d.type`,
      )
      .all(org) as { type: string; doc_count: number; units_milli: number }[];
    const byType = Object.fromEntries(movementBreakdown.map((r) => [r.type, { count: r.doc_count, units: fromMilli(r.units_milli) }]));
    const receiptsCount = byType.receipt?.count ?? 0;
    const receiptsUnits = byType.receipt?.units ?? 0;
    const issuesCount = byType.issue?.count ?? 0;
    const issuesUnits = byType.issue?.units ?? 0;
    const transfersCount = byType.transfer?.count ?? 0;
    const transfersUnits = byType.transfer?.units ?? 0;

    const lowStockItems = (db
      .prepare(
        `SELECT p.id AS productId, p.sku, p.name AS productName, u.code AS unit, p.reorder_level_milli,
                COALESCE((SELECT SUM(b.quantity_milli) FROM stock_balances b JOIN warehouses w ON w.id = b.warehouse_id WHERE b.product_id = p.id AND b.organisation_id = p.organisation_id${branchFilter}), 0) AS qty_milli
           FROM products p JOIN units_of_measure u ON u.id = p.base_unit_id
          WHERE p.organisation_id = ? AND p.active = 1 AND p.reorder_level_milli > 0
            AND COALESCE((SELECT SUM(b.quantity_milli) FROM stock_balances b JOIN warehouses w ON w.id = b.warehouse_id WHERE b.product_id = p.id AND b.organisation_id = p.organisation_id${branchFilter}), 0) <= p.reorder_level_milli
          ORDER BY p.name LIMIT 20`,
      )
      .all(org) as { productId: number; sku: string; productName: string; unit: string; reorder_level_milli: number; qty_milli: number }[]).map((r) => ({
      productId: r.productId,
      sku: r.sku,
      productName: r.productName,
      unit: r.unit,
      quantity: fromMilli(r.qty_milli),
      reorderLevel: fromMilli(r.reorder_level_milli),
    }));

    const warehouseSummary = (db
      .prepare(
        `SELECT w.id AS warehouseId, w.name AS warehouseName, br.name AS branchName,
                COALESCE(SUM(b.quantity_milli), 0) AS total_qty_milli,
                COALESCE(SUM(CASE WHEN b.quantity_milli > 0 THEN b.quantity_milli * p.unit_cost_cents ELSE 0 END), 0) AS total_milli_cents
           FROM warehouses w
           JOIN branches br ON br.id = w.branch_id
           LEFT JOIN stock_balances b ON b.warehouse_id = w.id AND b.organisation_id = br.organisation_id
           LEFT JOIN products p ON p.id = b.product_id
          WHERE br.organisation_id = ? AND w.active = 1${branchFilter}
          GROUP BY w.id, w.name, br.name
          ORDER BY w.name`,
      )
      .all(org) as { warehouseId: number; warehouseName: string; branchName: string; total_qty_milli: number; total_milli_cents: number }[]).map((w) => ({
      warehouseId: w.warehouseId,
      warehouseName: w.warehouseName,
      branchName: w.branchName,
      totalUnits: fromMilli(w.total_qty_milli),
      stockValue: Math.round(w.total_milli_cents / 1000) / 100,
    }));

    const recentMovements = (db
      .prepare(
        `SELECT m.id, m.document_id AS documentId, d.type, d.reference, d.created_at AS createdAt,
                p.sku, p.name AS productName, w.name AS warehouseName, u.code AS unit,
                m.quantity_milli, m.base_delta_milli, m.unit_cost_cents
           FROM stock_movements m
           JOIN stock_documents d ON d.id = m.document_id
           JOIN products p ON p.id = m.product_id
           JOIN warehouses w ON w.id = m.warehouse_id
           JOIN units_of_measure u ON u.id = m.unit_id
          WHERE m.organisation_id = ?${branchFilter}
          ORDER BY m.id DESC LIMIT 10`,
      )
      .all(org) as { id: number; documentId: number; type: string; reference: string | null; createdAt: string; sku: string; productName: string; warehouseName: string; unit: string; quantity_milli: number; base_delta_milli: number; unit_cost_cents: number }[]).map((m) => ({
      id: m.id,
      documentId: m.documentId,
      type: m.type,
      reference: m.reference,
      createdAt: m.createdAt,
      sku: m.sku,
      productName: m.productName,
      warehouseName: m.warehouseName,
      unit: m.unit,
      quantity: fromMilli(m.quantity_milli),
      baseChange: fromMilli(m.base_delta_milli),
      unitCost: fromCents(m.unit_cost_cents),
    }));

    const soon = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
    const expiringSoonCount = (db
      .prepare('SELECT COUNT(DISTINCT id) n FROM stock_movements WHERE organisation_id = ? AND expiry_date IS NOT NULL AND expiry_date <= ? AND base_delta_milli > 0')
      .get(org, soon) as { n: number }).n;

    const draftPurchaseOrders = count("SELECT COUNT(*) n FROM purchase_orders WHERE organisation_id = ? AND status = 'draft'");
    const pendingRequisitions = count("SELECT COUNT(*) n FROM requisitions WHERE organisation_id = ? AND status = 'pending'");
    const pendingCountSheets = count("SELECT COUNT(*) n FROM count_sheets WHERE organisation_id = ? AND status = 'draft'");

    return {
      role: req.user!.role,
      branches: count('SELECT COUNT(*) n FROM branches WHERE organisation_id = ? AND active = 1'),
      warehouses: count('SELECT COUNT(*) n FROM warehouses w JOIN branches b ON b.id = w.branch_id WHERE b.organisation_id = ? AND w.active = 1'),
      departments: count('SELECT COUNT(*) n FROM departments d JOIN branches b ON b.id = d.branch_id WHERE b.organisation_id = ? AND d.active = 1'),
      users: req.user!.role === 'executive_manager' ? count('SELECT COUNT(*) n FROM users WHERE organisation_id = ? AND active = 1') : null,
      products: count('SELECT COUNT(*) n FROM products WHERE organisation_id = ? AND active = 1'),
      totalStockUnits,
      totalStockValue,
      receiptsCount,
      receiptsUnits,
      issuesCount,
      issuesUnits,
      transfersCount,
      transfersUnits,
      lowStockCount: lowStockItems.length,
      expiringSoonCount,
      pendingCountSheets,
      pendingApprovals: {
        draftPurchaseOrders,
        pendingRequisitions,
        draftCountSheets: pendingCountSheets,
        total: draftPurchaseOrders + pendingRequisitions + pendingCountSheets,
      },
      lowStockItems,
      warehouseSummary,
      recentMovements,
    };
  });

  // Portal guards: server-side authorization for each portal (UI routing is only a convenience).
  app.get('/api/executive/ping', { preHandler: requireAuth('executive_manager') }, async () => ({ portal: 'executive' }));
  app.get('/api/inventory/ping', { preHandler: requireAuth('inventory_manager', 'executive_manager') }, async () => ({ portal: 'inventory' }));

  registerInventoryRoutes(app, db, requireAuth, config.BCRYPT_COST);

  return app;
}
