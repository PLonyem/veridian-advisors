const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const leadService = require('../services/leadService');
const logger = require('../utils/logger');

// See DATA_DIR note in src/config/database.js - same reasoning applies here so
// backups land on a persistent volume in deployments that have one, instead of
// the container's ephemeral filesystem.
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(__dirname, '..', '..');
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
const RETENTION_DAYS = 30;
const BACKUP_FORMAT_VERSION = '1.0';

function ensureBackupsDir() {
  if (!fs.existsSync(BACKUPS_DIR)) {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  }
}

function formatTimestampForFilename(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

function writeBackupFile(backupData) {
  const fileName = `backup-${formatTimestampForFilename(new Date())}.json`;
  const filePath = path.join(BACKUPS_DIR, fileName);
  fs.writeFileSync(filePath, JSON.stringify(backupData, null, 2));
  return filePath;
}

function compressBackupFile(filePath) {
  const gzPath = `${filePath}.gz`;
  fs.writeFileSync(gzPath, zlib.gzipSync(fs.readFileSync(filePath)));
  return gzPath;
}

// Removes backup-*.json / backup-*.json.gz files older than RETENTION_DAYS,
// based on file mtime. Returns the names of whatever was deleted.
function cleanupOldBackups() {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const deleted = [];

  for (const fileName of fs.readdirSync(BACKUPS_DIR)) {
    if (!fileName.startsWith('backup-')) continue;

    const filePath = path.join(BACKUPS_DIR, fileName);
    if (fs.statSync(filePath).mtimeMs < cutoff) {
      fs.unlinkSync(filePath);
      deleted.push(fileName);
    }
  }

  return deleted;
}

async function runBackup() {
  try {
    ensureBackupsDir();

    // No filters and a limit far beyond any realistic table size = "all leads".
    const [leads, communications] = await Promise.all([
      leadService.getAllLeads({ limit: Number.MAX_SAFE_INTEGER, offset: 0 }),
      leadService.getAllCommunications(),
    ]);
    const backupData = {
      exportedAt: new Date().toISOString(),
      version: BACKUP_FORMAT_VERSION,
      count: leads.length,
      leads,
      communications,
    };

    const filePath = writeBackupFile(backupData);
    logger.info(
      `backup: exported ${backupData.count} lead(s) and ${communications.length} communication(s) to ${filePath}`,
    );

    // Compression and retention cleanup are best-effort extras: the JSON backup
    // above already succeeded, so a failure here shouldn't fail the whole run.
    try {
      const gzPath = compressBackupFile(filePath);
      logger.info(`backup: compressed backup to ${gzPath}`);
    } catch (err) {
      logger.warn(`backup: gzip compression failed (JSON backup is still valid): ${err.message}`);
    }

    try {
      const deleted = cleanupOldBackups();
      if (deleted.length) {
        logger.info(`backup: removed ${deleted.length} backup(s) older than ${RETENTION_DAYS} days: ${deleted.join(', ')}`);
      }
    } catch (err) {
      logger.warn(`backup: cleanup of old backups failed: ${err.message}`);
    }
  } catch (err) {
    logger.error(`backup: failed: ${err.message}`);
    throw err;
  }
}

async function main() {
  try {
    await runBackup();
    process.exit(0);
  } catch (err) {
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { runBackup };
