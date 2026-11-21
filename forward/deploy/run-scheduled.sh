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
status=0
python3 forward/runner/run_daily.py --workers 2 || status=$?
# Fallback for the Worker cron: compute today's metrics snapshots right after the daily run (idempotent upsert).
token_file="$HOME/.config/brooks-forward/token"
api=$(python3 -c 'import json;print(json.load(open("forward/runner/config.json"))["api_base"])')
if [ -s "$token_file" ]; then
  curl -s -m 120 -X POST -H "Authorization: Bearer $(cat "$token_file")" -H "User-Agent: brooks-forward-runner/1.0" \
    "$api/api/snapshots/run" | head -c 200; echo
fi
exit $status
