# Precision7960 setup

Use a normal Linux user with Python 3.9+ (including system tzdata), Node 20+,
Git, util-linux `flock`, an authenticated Claude CLI, and npx/wrangler available.
Codex is not used by this runner. Run all commands below yourself on Precision7960.
Paths assume a clone at `~/brooks-price-action`; change the service and BROOKS_REPO if needed.

For the existing production Worker and daily timer, go directly to
[Add intraday](#add-intraday-to-an-existing-production-installation).
The steps below provision a fresh daily installation.

1. Clone and enter the repository:

   ```sh
   git clone <YOUR_REPOSITORY_URL> ~/brooks-price-action
   cd ~/brooks-price-action
   node --test forward/worker/test
   python3 -m unittest discover -s forward/runner
   ```

2. Create D1, put the returned database ID in `forward/worker/wrangler.toml`, then initialize it:

   ```sh
   cd ~/brooks-price-action/forward/worker
   npx wrangler d1 create brooks_forward
   # Edit database_id in wrangler.toml now.
   npx wrangler d1 execute brooks_forward --remote --file schema.sql
   ```

3. Generate a high-entropy write token, save it locally, and paste that same value into
   the secret prompt. The command below writes it directly to a mode-600 file without
   printing it. Do not commit it or put it in config.json.

   ```sh
   mkdir -p ~/.config/brooks-forward
   chmod 700 ~/.config/brooks-forward
   python3 - <<'PY'
   import os, pathlib, secrets
   p = pathlib.Path.home() / '.config/brooks-forward/token'
   fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
   with os.fdopen(fd, 'w') as f:
       f.write(secrets.token_urlsafe(48) + '\n')
   PY
   npx wrangler secret put WRITE_TOKEN
   npx wrangler deploy
   ```

   Use a local editor to copy the file into the secret prompt, or pipe it directly
   with `npx wrangler secret put WRITE_TOKEN < ~/.config/brooks-forward/token`.
   The file creation deliberately refuses to overwrite an existing token.
   `WRITE_TOKEN` environment variable is an alternative for manual invocations.

4. Set `api_base` in `forward/runner/config.json` to the HTTPS workers.dev/custom URL.
   Keep `timezone` as America/Los_Angeles. Check `skill_dir` (relative to the config
   file), lookback, symbols and conditions. Ensure `claude` works in the service's
   PATH and is authenticated for this Linux user. An API key is not the collector token.
   Require a clean, reviewed checkout for reproducible skill_sha; HEAD does not capture
   local modifications. Keep operator config changes safe before automated pulls.

5. Run the first collection **after 13:15 PT** on a trading day:

   ```sh
   cd ~/brooks-price-action
   python3 forward/runner/run_daily.py --workers 2
   ```

   This really launches up to 12 LLM calls, plus parse retries, and incurs model costs.
   A rerun on the same asof skips stored predictions. Visit `/`, `/api/stats` and a
   reading permalink on the deployed Worker. Forecasts are pending for five bars
   (or longer declared horizons). Inspect partial failures even when exit status is zero.
   Use the scheduled script for manual runs once scheduling is enabled so they share a lock.

6. Install the user service and timer; enable lingering so it survives logout:

   ```sh
   mkdir -p ~/.config/systemd/user ~/.local/state/brooks-forward
   cp forward/deploy/brooks-forward.{service,timer} ~/.config/systemd/user/
   systemctl --user daemon-reload
   systemd-analyze calendar 'Mon..Fri *-*-* 13:40:00 America/Los_Angeles'
   systemctl --user enable --now brooks-forward.timer
   loginctl enable-linger "$USER"
   systemctl --user list-timers brooks-forward.timer
   journalctl --user -u brooks-forward.service
   ```

   `loginctl enable-linger` may need your administrator. Adjust the service PATH for
   Claude's installation, then daemon-reload. Logs are daily files under
   `~/.local/state/brooks-forward/`; archive/rotate them periodically. The service
   pulls with `git pull --ff-only` before collection; a failed pull stops that run.
   Schedule uses Pacific DST explicitly; Persistent=true catches a missed timer
   after boot. Holidays run harmlessly, normally finding the previous asof stored.
   An outage does not fabricate the missing days' forecasts.

7. **Cron fallback**, instead of enabling the timer, on cron implementations supporting CRON_TZ:

   ```cron
   CRON_TZ=America/Los_Angeles
   PATH=/home/YOUR_USER/.local/bin:/usr/local/bin:/usr/bin:/bin
   40 13 * * 1-5 /home/YOUR_USER/brooks-price-action/forward/deploy/run-scheduled.sh
   ```

   Replace YOUR_USER and the repository path. For a different checkout location set
   `BROOKS_REPO` too. A plain TZ environment variable does not change cron's scheduling
   timezone; verify CRON_TZ support or set the host timezone to America/Los_Angeles.
   Do not enable both schedulers. The shared flock is an additional overlap guard.

The Worker has no cron trigger. Monitor the dashboard/logs, Cloudflare quotas and billing,
and back up D1 with an operator-run export periodically. Reads, full readings, model names,
revision IDs and symbols are public; do not include private data in prompts/readings.
No brokerage credentials or order execution are involved.

## Add intraday to an existing production installation

Keep the existing daily timer and token. Apply the additive migration from
`forward/worker` before releasing the updated Worker:

```sh
cd ~/brooks-price-action/forward/worker
npx wrangler d1 execute brooks_forward --remote --file migrations/0002_intraday.sql
```

Already running intraday? The live chart and `skill_chart` use the existing D1
schema. Set up the chart interpreter below and use the updated Worker before
the collector starts sending `skill_chart` decisions.

Once the upgraded Worker is live, check `/api/intraday/stats?symbol=SPY` and
`/api/recaps?symbol=SPY` and install the two new user timers:

```sh
cd ~/brooks-price-action
bash forward/deploy/setup-venv.sh
mkdir -p ~/.config/systemd/user ~/.local/state/brooks-forward
cp forward/deploy/brooks-{intraday,recap}.{service,timer} ~/.config/systemd/user/
systemd-analyze calendar 'Mon..Fri *-*-* 06:45:25 America/Los_Angeles'
systemd-analyze calendar 'Mon..Fri *-*-* 07..12:00,15,30,45:25 America/Los_Angeles'
systemd-analyze calendar 'Mon..Fri *-*-* 13:20:00 America/Los_Angeles'
systemctl --user daemon-reload
systemctl --user enable --now brooks-intraday.timer brooks-recap.timer
systemctl --user list-timers brooks-intraday.timer brooks-recap.timer
```

Run the venv setup as the user that runs the timers. It installs Pillow under
`~/brooks-price-action/.venv-forward` and can be rerun. Set `chart_python` in
`forward/runner/config.json` if you use a different venv. The runner and recap
continue to use system Python, and only the PNG renderer uses the venv.

Intraday fires 25 seconds after each decision close from 06:45 through 12:45 PT.
Recap fires at 13:20 PT. Both timers resume at their next scheduled event after a
restart. Their scripts use independent nonblocking locks and log in
`~/.local/state/brooks-forward/intraday-YYYY-MM-DD.log` and
`~/.local/state/brooks-forward/recap-YYYY-MM-DD.log`. The existing daily wrapper
keeps its own lock. To regenerate today's recap after the close, invoke
`forward/deploy/run-recap.sh --force` from the checkout.
