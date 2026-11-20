#!/bin/bash
# Bars-only refresher: keeps the live chart current between 15-minute decisions.
# Uses its own lock (independent of intraday.lock) and never pulls git, so it
# cannot collide with the decision runner's checkout update.
set -euo pipefail
repo="${BROOKS_REPO:-$HOME/brooks-price-action}"
state="$HOME/.local/state/brooks-forward"
mkdir -p "$state"
exec 9>"$state/intraday-bars.lock"
flock -n 9 || exit 0
exec >>"$state/intraday-bars-$(TZ=America/Los_Angeles date +%F).log" 2>&1
cd "$repo"
exec python3 forward/runner/intraday.py --bars-only "$@"
