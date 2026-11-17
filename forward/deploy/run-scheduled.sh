#!/bin/bash
set -euo pipefail
repo="${BROOKS_REPO:-$HOME/brooks-price-action}"
state="$HOME/.local/state/brooks-forward"
mkdir -p "$state"
# Shared lock protects manual scheduled-script invocations and cron/systemd overlap.
exec 9>"$state/runner.lock"
flock -n 9 || exit 0
exec >>"$state/$(TZ=America/Los_Angeles date +%F).log" 2>&1
printf '\nRun started %s\n' "$(date -Is)"
cd "$repo"
git pull --ff-only
exec python3 forward/runner/run_daily.py --workers 2
