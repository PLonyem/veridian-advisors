const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

// DATA_DIR lets deployments point data.db at a persistent volume (e.g. a Fly.io
// volume mounted at /data) instead of the project root, which usually lives
// inside the container's ephemeral, code-only filesystem. Defaults to the
// project root so local dev behavior is unchanged.
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(__dirname, '..', '..');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const dbPath = path.join(DATA_DIR, 'data.db');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    logger.error(`Failed to connect to SQLite database: ${err.message}`);
    throw err;
  }
  logger.info(`Connected to SQLite database at ${dbPath}`);
});

db.run('PRAGMA foreign_keys = ON');

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function callback(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

const CREATE_LEADS_TABLE = `
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    country TEXT NOT NULL,
    net_worth TEXT NOT NULL,
    tier_interest TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    status TEXT DEFAULT 'New',
    disclaimer_accepted INTEGER DEFAULT 0,
    source TEXT DEFAULT 'Website',
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`;

const CREATE_COMMUNICATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS communications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER NOT NULL,
    type TEXT NOT NULL, -- 'incoming' | 'outgoing'
    channel TEXT DEFAULT 'email',
    subject TEXT,
    content TEXT,
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
  )
`;

const CREATE_INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_leads_email ON leads (email)',
  'CREATE INDEX IF NOT EXISTS idx_leads_status ON leads (status)',
  'CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads (created_at)',
  'CREATE INDEX IF NOT EXISTS idx_communications_lead_id ON communications (lead_id)',
];

async function runMigrations() {
  const applied = [];
  const columns = await all('PRAGMA table_info(leads)');
  const hasNotes = columns.some((col) => col.name === 'notes');

  if (!hasNotes) {
    await run('ALTER TABLE leads ADD COLUMN notes TEXT');
    applied.push('add notes column to leads');
  }

  return applied;
}

async function initializeDatabase() {
  await run(CREATE_LEADS_TABLE);
  await run(CREATE_COMMUNICATIONS_TABLE);

  for (const indexSql of CREATE_INDEXES) {
    await run(indexSql);
  }

  const applied = await runMigrations();
  if (applied.length) {
    logger.info(`Applied migrations: ${applied.join(', ')}`);
  }

  return applied;
}

/**
 * Executes a raw SQL migration script (one or more statements) against the database.
 * Used by src/scripts/migrate.js to run the .sql files in src/migrations/ - distinct
 * from the ad-hoc runMigrations() above, which only handles this module's own
 * built-in startup schema check.
 *
 * @param {string} sql - Raw SQL to execute (e.g. the contents of a migration file).
 * @returns {Promise<void>}
 */
function runMigration(sql) {
  return new Promise((resolve, reject) => {
    db.exec(sql, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function closeDatabase() {
  return new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) return reject(err);
      logger.info('Database connection closed');
      resolve();
    });
  });
}

module.exports = {
  db,
  run,
  get,
  all,
  initializeDatabase,
  runMigrations,
  runMigration,
  closeDatabase,
};
