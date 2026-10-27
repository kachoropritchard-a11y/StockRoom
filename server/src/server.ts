import { loadConfig } from './config.ts';
import { openDb } from './db.ts';
import { migrate } from './migrate.ts';
import { ensureDualDepartmentDemoData } from './seed.ts';
import { buildApp } from './app.ts';

const config = loadConfig();
const db = openDb(config.DATABASE_PATH);
migrate(db);
if (config.NODE_ENV !== 'production') {
  try {
    ensureDualDepartmentDemoData(db);
  } catch {
    // Non-fatal in dev
  }
}
const app = buildApp(db, config);

try {
  await app.listen({ port: config.PORT, host: config.HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
