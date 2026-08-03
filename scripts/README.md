# Live snapshot pipeline

A scheduled **GitHub Action** (`.github/workflows/live.yml`) runs `build-live.mjs`
every ~20 minutes. It fetches your Steam / PSN / GitHub activity using
secrets, writes `live.json`, and commits it. The static site reads that file.

Listening data no longer comes from here — it's served live by the `now-spotify`
Cloudflare Worker (`worker/`) and polled directly by `app.js`. See `worker/README.md`.

A second workflow (`.github/workflows/location.yml`) keeps `location.json` current
from a phone ping — see [SHORTCUT.md](../SHORTCUT.md).

Secrets never reach the browser. Each source is fetched independently — one
failing never breaks the others, and the last-known value is kept on failure.

## 1. Put the project on GitHub

```bash
git init
git add .
git commit -m "initial: portfolio + live pipeline"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

## 2. Add credentials

In the repo: **Settings → Secrets and variables → Actions**.

Add a **Variable** (not secret):

| Variable | Value |
|---|---|
| `GH_USER` | your GitHub username (the name **cannot** start with `GITHUB_` — that prefix is reserved) |

Add **Secrets**:

| Secret | Where to get it |
|---|---|
| `STEAM_API_KEY` | **steamcommunity.com/dev/apikey** |
| `STEAM_ID` | Your **SteamID64** (17 digits — e.g. from steamid.io). Profile + game details must be **Public**. |
| `PSN_NPSSO` | *(optional)* Log into **playstation.com**, then open **ca.account.sony.com/api/v1/ssocookie** and copy the `npsso` value. Leave unset to skip PSN. |

Spotify credentials live in the `now-spotify` Worker's own secrets (`wrangler
secret put`), not here — see `worker/README.md`.

## 3. Check what's actually wired

```bash
cd scripts
node --env-file=.env check-secrets.mjs      # or: npm run check
```

Probes every source with the same call `build-live.mjs` makes and prints one line
each — `ok` (real data came back), `-` (no credentials yet), or `x` (credentials
present but rejected, with the HTTP status). Secret **values** are never printed.

Run it after adding each credential. This matters because `build-live.mjs`
deliberately preserves the last-known value when a source fails — which means a
broken source and a working one look identical in `live.json`. This is the only
place they don't.

## 4. Turn it on

- **Actions** tab → enable workflows if prompted → run **live snapshot** once via
  *Run workflow* to verify. Check the logs; `live.json` should update.
- **Settings → Pages** → deploy from your branch. The live site is then at
  `https://<you>.github.io/<repo>/`.

Both workflows run only on a schedule / manual / dispatch trigger (never on push),
so their own commits can't loop. They deliberately do **not** tag commits
`[skip ci]` — that marker can also suppress the Pages rebuild, which would leave
the deployed site serving stale JSON.

## Local testing

```bash
cd scripts
npm install
cp .env.example .env      # fill in what you want to test
node --env-file=.env build-live.mjs
```

Running with no credentials is safe: every source returns "no data", the previous
`live.json` values are preserved, and the file is left untouched.

`live.json` is only rewritten when a **signal** actually changes. Because the
workflow runs every 20 minutes, bumping `fetchedAt` on every run would mean a commit
every 20 minutes — ~2,000/month of noise. So `fetchedAt` means *"when the data last
changed"*, which is also what the page's "updated Xm ago" is really saying. A
now-playing track's `at` is excluded from that comparison (it restamps every run and
isn't rendered while playing), so a single song doesn't churn the file either.

Keep `.env` out of git. The bare `.env` pattern in `.gitignore` matches at any depth,
so `scripts/.env` is covered — confirm before your first commit:

```bash
git check-ignore -v scripts/.env    # prints the matching rule; silence means NOT ignored
```

## Notes

- **PSN is the fragile source** (unofficial API). If it errors, the log shows
  `[psn] failed: …` and the rest still update. Steam is trusted first for the
  "playing" slot when it has real 2-week playtime.
- **Location** is *not* fetched here — `location.json` is written by
  `update-location.mjs` (its own workflow, triggered by a phone Shortcut); this
  script only mirrors it into `live.json` as a fallback. The site's clock, phase,
  and weather follow it. See [SHORTCUT.md](../SHORTCUT.md).
- Refresh cadence: change the `cron` in `live.yml`. GitHub may delay scheduled
  runs a few minutes under load.
