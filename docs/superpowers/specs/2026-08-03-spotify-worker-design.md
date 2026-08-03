# Spotify live updater — Cloudflare Worker

Date: 2026-08-03
Status: approved (design), pending implementation

## Problem

`live.json` is refreshed by a GitHub Actions cron every 20 minutes, committed into the
repo, and read by the page as a static file. That is fine for location, games and GitHub
activity, all of which change slowly. It is wrong for music: what is playing right now
changes every three minutes, so the card is stale far more often than it is correct.

Two further costs of routing music through the cron:

- Every track change writes a commit and triggers a Pages rebuild.
- `fetchedAt` is only stamped when a signal *changes* (`build-live.mjs` "only write when
  changed" logic). Play the same album for an hour and the page truthfully but unhelpfully
  reports "updated 1h ago".

## Goal

Serve now-playing from a Cloudflare Worker the page polls directly, so the listening card
reflects reality within about a minute, with no commits involved.

Scope is deliberately one endpoint: **the currently playing track, falling back to the most
recently played track when nothing is playing.** No history feed, no stats, no database.

## Decisions

| Question | Decision |
| --- | --- |
| Where the Worker lives | `worker/` in this repo, deployed manually via `npx wrangler deploy` |
| Spotify in `build-live.mjs` | Removed — the Worker is the sole source of listening data |
| Freshness | Page polls every 30s; edge cache TTL 20s |
| Response shape | Exactly the existing `listening` object the page already renders |

## Architecture

```
browser ──GET──▶ Worker ──▶ POST /api/token            (refresh grant, cached in isolate)
                       ├──▶ GET  /v1/me/player/currently-playing
                       └──▶ GET  /v1/me/player/recently-played?limit=1   (fallback)
```

Stateless and pull-only. No KV, no D1, no Cron Trigger — the Worker does work only when the
page asks. Two caches keep Spotify traffic low:

- **Access token**, held in a module-scope variable with its expiry. Tokens last an hour;
  an isolate typically outlives many requests, so the refresh grant runs rarely. A cold
  isolate simply fetches a new one. This is a cache, never a source of truth.
- **Response**, via the Cache API (`caches.default`) with a 20s TTL, so concurrent visitors
  and a background tab refreshing on a timer collapse into one upstream call.

### Endpoint

`GET /` returns `application/json`. `OPTIONS /` answers CORS preflight. Any other path
returns 404.

Success body — the identical field set `renderListen` in `app.js` already consumes:

```json
{
  "title":  "Caravan",
  "artist": "John Wasson",
  "album":  "Whiplash (Original Motion Picture Soundtrack)",
  "art":    "https://i.scdn.co/image/…",
  "url":    "https://open.spotify.com/track/…",
  "nowPlaying": true,
  "period": null,
  "at": "2026-08-03T07:51:04.530Z"
}
```

- Playing now → `nowPlaying: true`, `period: null`, `at` = request time.
- Nothing playing → most recent track, `nowPlaying: false`, `period: "recent"`,
  `at` = Spotify's `played_at`.
- Paused counts as not playing, so a paused track surfaces through the fallback as the
  last-played track rather than being reported as live.

### Resolution order

1. `GET /v1/me/player/currently-playing`.
   - `200` with `item` and `is_playing: true` → now playing. Non-track items
     (podcast episodes) are treated as nothing playing.
   - `204` (nothing active) or `is_playing: false` → step 2.
2. `GET /v1/me/player/recently-played?limit=1` → `items[0].track`, `items[0].played_at`.
3. Neither yields a track → `200` with body `null`.

### Scopes — requires re-authorisation

The existing refresh token carries `user-read-currently-playing user-top-read`. The
fallback needs **`user-read-recently-played`**, which it does not have, so
`/recently-played` would return 403.

Therefore:

- `scripts/spotify-auth.mjs` changes its `SCOPE` to
  `user-read-currently-playing user-read-recently-played`.
  (`user-top-read` is dropped — the top-tracks fallback disappears with `build-live.mjs`.)
- A new refresh token must be minted once and stored with `wrangler secret put`.
  This is a mandatory setup step, documented in the README.

### Secrets

`SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REFRESH_TOKEN`, set via
`wrangler secret put`. Nothing secret is ever sent to the browser.

A caution earned the hard way today: the repo secrets and `scripts/.env` had drifted to
different Spotify apps, and the mismatch surfaced only as an opaque `400`. The Worker's
setup docs therefore specify pasting values with no trailing comments or whitespace, and
the Worker logs the upstream `error`/`error_description` on token failure instead of just
the status code.

### CORS

`Access-Control-Allow-Origin` is echoed back only for an allowlisted origin:
`https://jerohsing-zip.github.io`, plus `http://localhost:*` and `http://127.0.0.1:*` for
local development. Unknown origins get the JSON without the header, so browsers on other
sites cannot read it.

### Errors

Honest states matter here — the page must never claim silence it hasn't verified.

- Upstream or token failure → HTTP `502` with `{"error":"…"}`. The page's `.catch` leaves
  whatever is already rendered untouched.
- Genuinely nothing playing and no history → HTTP `200` with `null`, which the page renders
  as its existing "quiet right now" empty state.

That distinction is the point: a broken Worker must not render as "quiet right now".

## Page integration (`app.js`)

The Worker is named `now-spotify`, so it deploys to
`https://now-spotify.<your-subdomain>.workers.dev`. The exact subdomain is only known after
the first deploy, so `app.js` ships with the constant clearly marked and the README's final
step is to paste the real URL in. If the constant is left at its placeholder, the fetch
simply fails and the card falls back to its static HTML content — no crash.

- New constant for the Worker URL.
- `loadListening()` fetches the Worker; on success calls `renderListen(data)`; on any
  failure does nothing, leaving the previous render in place.
- Called on load, then `setInterval(loadListening, 30000)`.
- `renderSignals` no longer calls `renderListen(data.listening)` — listening is now owned
  entirely by the Worker path.

## Pipeline changes (`build-live.mjs` and workflow)

- Delete `spotify()` and `spotifyTrack()`, and drop them from the `Promise.allSettled` set.
- Remove `listening` from the emitted signals, from the `prev` carry-forward, and from
  `pick()` so it no longer participates in change detection.
- `live.yml`: drop the three `SPOTIFY_*` env entries.
- `live.json`: drop the `listening` key; the bot rewrites the file on its next run.
- `scripts/README.md` and `scripts/.env.example`: note that Spotify moved to `worker/`.

The repo secrets `SPOTIFY_*` become unused by CI. Leaving them is harmless; removing them
is a manual cleanup step, not part of this work.

## Testing

`vitest` with `@cloudflare/vitest-pool-workers`, so tests run in real `workerd` rather than
a mock. Spotify is stubbed at `fetch`.

| Case | Expectation |
| --- | --- |
| Playing a track | Correct shape, `nowPlaying: true` |
| `204` from currently-playing | Falls back to recently-played, `nowPlaying: false`, `period: "recent"` |
| `is_playing: false` | Treated as not playing → fallback |
| Podcast episode playing | Treated as nothing playing → fallback |
| Token cached | Two requests trigger only one refresh-grant call |
| Expired token | Refresh grant re-runs |
| Token grant returns 400 | `502`, and the error description is logged |
| Both endpoints empty | `200` with `null` |
| Allowlisted origin | CORS header echoed |
| Unknown origin | No CORS header |
| `POST` or unknown path | `404` / `405` |

Plus a manual `wrangler dev` smoke test against the real account before deploying.

## Deliverables

```
worker/
  src/index.js        Worker (single module, ~150 lines)
  test/spotify.test.js
  wrangler.toml
  package.json
  README.md           setup: Cloudflare account → secrets → re-auth → deploy → wire the page
```

Plus edits to `app.js`, `scripts/build-live.mjs`, `scripts/spotify-auth.mjs`,
`scripts/.env.example`, `scripts/README.md`, `.github/workflows/live.yml`, `live.json`.

## Out of scope

Listening history, play counts, top artists, a progress bar, a custom domain, and
auto-deploy from CI. Each is easy to add later; none is needed to make the card live.
