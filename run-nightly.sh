#!/bin/sh
# quota-nightshift unattended entry point.
# Point your scheduler (cron / launchd / Task Scheduler) at this script.
# It needs no human, no TTY and no open terminal; all output goes to
# runs/night.log. Configure nightshift.json first, and provide provider
# keys via the environment (or an optional .env.nightshift file here).
set -u
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$DIR" || exit 1
if [ -f "$DIR/.env.nightshift" ]; then set -a; . "$DIR/.env.nightshift"; set +a; fi
mkdir -p runs
echo "=== night run $(date '+%F %T') ===" >> runs/night.log
node src/real-night.js >> runs/night.log 2>&1
code=$?
echo "=== exit $code $(date '+%F %T') ===" >> runs/night.log
exit $code
