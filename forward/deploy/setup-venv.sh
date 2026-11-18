#!/usr/bin/env bash
set -euo pipefail

venv="$HOME/brooks-price-action/.venv-forward"
if [[ ! -x "$venv/bin/python" ]]; then
  python3 -m venv "$venv"
fi
"$venv/bin/python" -m pip install pillow
