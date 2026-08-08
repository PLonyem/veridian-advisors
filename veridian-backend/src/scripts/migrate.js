const fs = require('fs');
const path = require('path');
const database = require('../config/database');
const logger = require('../utils/logger');

const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'migrations');

const CREATE_MIGRATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`;

async function ensureMigrationsTable() {
  await database.run(CREATE_MIGRATIONS_TABLE);
}

async function getAppliedMigrations() {
  const rows = await database.all('SELECT name FROM migrations');
  return new Set(rows.map((row) => row.name));
}

async function recordMigration(name) {
  await database.run('INSERT INTO migrations (name) VALUES (?)', [name]);
}

function listMigrationFiles() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();
}

async function applyMigration(name) {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8');

  try {
    await database.runMigration(sql);
  } catch (err) {
    // SQLite has no `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. A column-add
    // migration whose column already exists (e.g. it was already created as
    // part of 001's CREATE TABLE, or added by an earlier ad-hoc setup) fails
    // with exactly this message - treat that as "already applied", not a
    // real failure. Anything else still aborts the run.
    if (/duplicate column name/i.test(err.message)) {
      logger.warn(`migrate: ${name} - column already exists, marking as applied`);
    } else {
      throw err;
    }
  }

  await recordMigration(name);
}

/**
 * Runs every .sql file in src/migrations/ that hasn't already been recorded in
 * the `migrations` table, in filename order, tracking each as it completes.
 *
 * @returns {Promise<void>}
 */
async function runMigrations() {
  await ensureMigrationsTable();

  const applied = await getAppliedMigrations();
  const files = listMigrationFiles();

  if (!files.length) {
    logger.info('migrate: no migration files found');
    return;
  }

  for (const name of files) {
    if (applied.has(name)) {
      logger.info(`migrate: ${name} - already applied, skipping`);
      continue;
    }

    logger.info(`migrate: ${name} - applying...`);
    try {
      await applyMigration(name);
      logger.info(`migrate: ${name} - done`);
    } catch (err) {
      logger.error(`migrate: ${name} - failed: ${err.message}`);
      throw err;
    }
  }
}

async function main() {
  try {
    await runMigrations();
    logger.info('migrate: all migrations applied successfully');
    process.exit(0);
  } catch (err) {
    logger.error(`migrate: aborted: ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { runMigrations };
