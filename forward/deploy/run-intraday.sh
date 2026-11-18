#!/bin/bash
set -euo pipefail
repo="${BROOKS_REPO:-$HOME/brooks-price-action}"
state="$HOME/.local/state/brooks-forward"
mkdir -p "$state"
exec 9>"$state/intraday.lock"
flock -n 9 || exit 0
exec >>"$state/intraday-$(TZ=America/Los_Angeles date +%F).log" 2>&1
cd "$repo"
git pull --ff-only
exec python3 forward/runner/intraday.py "$@"
