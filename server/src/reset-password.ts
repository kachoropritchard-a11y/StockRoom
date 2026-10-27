import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { loadConfig } from './config.ts';
import { openDb, type Db } from './db.ts';
import { migrate } from './migrate.ts';

/** Sets a new password, clears any lockout and revokes all sessions. Returns false if the user does not exist. */
export function resetPassword(db: Db, email: string, password: string, cost = 12): boolean {
  const u = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: number } | undefined;
  if (!u) return false;
  db.prepare('UPDATE users SET password_hash = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?').run(bcrypt.hashSync(password, cost), u.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  return true;
}

// Operator tool (no email service yet): npm run reset-password -- user@example.com  [NEW_PASSWORD env optional]
if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const email = process.argv[2];
  if (!email) throw new Error('Usage: npm run reset-password -- <email>');
  const config = loadConfig();
  const db = openDb(config.DATABASE_PATH);
  migrate(db);
  const password = process.env.NEW_PASSWORD ?? randomBytes(12).toString('base64url');
  if (!resetPassword(db, email, password, config.BCRYPT_COST)) {
    console.error('No such user.');
    process.exit(1);
  }
  console.log(`Password reset for ${email}. New password${process.env.NEW_PASSWORD ? ' set from NEW_PASSWORD' : ` (shown once): ${password}`}`);
}
