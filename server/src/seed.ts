import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { loadConfig } from './config.ts';
import { openDb, type Db } from './db.ts';
import { migrate } from './migrate.ts';

/** Creates a starter organisation structure and two users. Idempotent: does nothing if an organisation exists. */
export function seed(db: Db, passwords: { executive: string; inventory: string }, cost = 12): boolean {
  if ((db.prepare('SELECT COUNT(*) n FROM organisations').get() as { n: number }).n > 0) return false;
  const org = Number(db.prepare('INSERT INTO organisations (name) VALUES (?)').run('Demo Organisation').lastInsertRowid);
  const branch = Number(db.prepare('INSERT INTO branches (organisation_id, name, city) VALUES (?, ?, ?)').run(org, 'Head Office', 'Harare').lastInsertRowid);
  db.prepare('INSERT INTO warehouses (branch_id, name) VALUES (?, ?)').run(branch, 'Main Warehouse');
  db.prepare('INSERT INTO departments (branch_id, name) VALUES (?, ?)').run(branch, 'General');
  const addUnit = db.prepare('INSERT INTO units_of_measure (organisation_id, code, name) VALUES (?, ?, ?)');
  for (const [code, label] of [['each', 'Each'], ['kg', 'Kilogram'], ['l', 'Litre'], ['box', 'Box'], ['carton', 'Carton']]) addUnit.run(org, code, label);
  const addUser = db.prepare('INSERT INTO users (organisation_id, branch_id, email, name, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)');
  addUser.run(org, branch, 'executive@example.com', 'Executive Manager', bcrypt.hashSync(passwords.executive, cost), 'executive_manager');
  addUser.run(org, branch, 'inventory@example.com', 'Inventory Manager', bcrypt.hashSync(passwords.inventory, cost), 'inventory_manager');
  return true;
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const config = loadConfig();
  if (config.NODE_ENV === 'production') throw new Error('Refusing to run demo seed in production.');
  const db = openDb(config.DATABASE_PATH);
  migrate(db);
  const pw = { executive: process.env.SEED_EXECUTIVE_PASSWORD ?? randomBytes(9).toString('base64url'), inventory: process.env.SEED_INVENTORY_PASSWORD ?? randomBytes(9).toString('base64url') };
  if (seed(db, pw)) {
    console.log('Seeded. Credentials (shown once):');
    console.log(`  executive@example.com / ${pw.executive}`);
    console.log(`  inventory@example.com / ${pw.inventory}`);
  } else console.log('Organisation already exists; seed skipped.');
}
