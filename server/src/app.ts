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
    logger: config.NODE_ENV === 'test' ? false : { redact: ['req.headers.authorization', 'req.headers.cookie'] },
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
    const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    if (status === 500) req.log.error(err);
    reply.code(status).send({ error: status === 500 ? 'internal_error' : err.message });
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

  // Dashboard shell data, scoped to the caller's organisation. Real inventory metrics arrive in later stages.
  app.get('/api/dashboard/summary', { preHandler: requireAuth() }, async (req) => {
    const org = req.user!.organisationId;
    const count = (sql: string) => (db.prepare(sql).get(org) as { n: number }).n;
    return {
      role: req.user!.role,
      branches: count('SELECT COUNT(*) n FROM branches WHERE organisation_id = ? AND active = 1'),
      warehouses: count('SELECT COUNT(*) n FROM warehouses w JOIN branches b ON b.id = w.branch_id WHERE b.organisation_id = ? AND w.active = 1'),
      departments: count('SELECT COUNT(*) n FROM departments d JOIN branches b ON b.id = d.branch_id WHERE b.organisation_id = ? AND d.active = 1'),
      users: req.user!.role === 'executive_manager' ? count('SELECT COUNT(*) n FROM users WHERE organisation_id = ? AND active = 1') : null,
    };
  });

  // Portal guards: server-side authorization for each portal (UI routing is only a convenience).
  app.get('/api/executive/ping', { preHandler: requireAuth('executive_manager') }, async () => ({ portal: 'executive' }));
  app.get('/api/inventory/ping', { preHandler: requireAuth('inventory_manager', 'executive_manager') }, async () => ({ portal: 'inventory' }));

  registerInventoryRoutes(app, db, requireAuth);

  return app;
}
