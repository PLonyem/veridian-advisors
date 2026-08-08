#!/usr/bin/env bash
# Installs a daily cron job that runs the Veridian backend backup script at 2:00 AM.
#
# Usage (from the veridian-backend directory):
#   bash src/scripts/install-cron-backup.sh
#
# Equivalent crontab line, if you'd rather add it yourself via `crontab -e`:
#   0 2 * * * cd /path/to/veridian-backend && /usr/bin/node src/scripts/backup.js >> /path/to/veridian-backend/logs/backup.log 2>&1

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NODE_BIN="$(command -v node)"
LOG_DIR="$PROJECT_DIR/logs"
CRON_LINE="0 2 * * * cd $PROJECT_DIR && $NODE_BIN src/scripts/backup.js >> $LOG_DIR/backup.log 2>&1"

mkdir -p "$LOG_DIR"

# Drop any previous entry for this script before adding the new one, so
# re-running this installer is idempotent instead of stacking duplicates.
(crontab -l 2>/dev/null | grep -vF "src/scripts/backup.js"; echo "$CRON_LINE") | crontab -

echo "Installed daily backup cron job:"
echo "$CRON_LINE"
