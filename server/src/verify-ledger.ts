import { loadConfig } from './config.ts';
import { openDb } from './db.ts';
import { migrate } from './migrate.ts';
import { verifyLedger } from './inventory/engine.ts';

// Operator tool: npm run verify-ledger   (exit code 1 if any problem is found)
const db = openDb(loadConfig().DATABASE_PATH);
migrate(db);
const result = verifyLedger(db);
console.log(result.ok ? 'Ledger OK.' : result.problems.map((p) => `[${p.check}] ${p.detail}`).join('\n'));
process.exit(result.ok ? 0 : 1);
