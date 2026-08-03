# now-spotify

A Cloudflare Worker that serves what Jerome is listening to, live.

`GET /` returns the currently playing track, or the most recently played one when
nothing is on. The portfolio page polls it every 30 seconds, which is why the
listening card is current instead of up to 20 minutes stale.

```json
{
  "title": "Caravan",
  "artist": "John Wasson",
  "album": "Whiplash (Original Motion Picture Soundtrack)",
  "art": "https://i.scdn.co/image/…",
  "url": "https://open.spotify.com/track/…",
  "nowPlaying": true,
  "period": null,
  "at": "2026-08-03T07:51:04.530Z"
}
```

- `nowPlaying: true` — playing right now; `at` is the time of the request.
- `nowPlaying: false`, `period: "recent"` — the last thing played; `at` is when it played.
- Body `null` with status `200` — nothing playing and no history. Genuine silence.
- Status `502` — Spotify or the token failed. **Not** silence; the page keeps its
  previous render rather than claiming you're listening to nothing.

## Setup

Everything below runs from the `worker/` directory.

### 1. Install

```bash
cd worker
npm install
```

### 2. Log in to Cloudflare

```bash
npx wrangler login
```

Opens a browser to authorise Wrangler. A free Cloudflare account is enough — this
Worker's traffic is far inside the free tier's 100,000 requests/day.

### 3. Mint a refresh token with the right scopes

**Required even if you already have a Spotify refresh token.** The old one was
issued for `user-read-currently-playing user-top-read`; the last-played fallback
needs `user-read-recently-played`, and scopes cannot be added to an existing token.

From the repository root:

```bash
SPOTIFY_CLIENT_ID=xxx SPOTIFY_CLIENT_SECRET=yyy node scripts/spotify-auth.mjs
```

It prints a URL. Before opening it, add `http://127.0.0.1:8888/callback` as a
Redirect URI in your app at
[developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) and save.
Then open the URL, click Agree, and the token is printed in your terminal.

### 4. Set the three secrets

```bash
npx wrangler secret put SPOTIFY_CLIENT_ID
npx wrangler secret put SPOTIFY_CLIENT_SECRET
npx wrangler secret put SPOTIFY_REFRESH_TOKEN
```

Each prompts for the value. **Paste the value alone** — no surrounding quotes, no
trailing comment, no stray whitespace. A refresh token with a comment glued to the
end fails as an opaque `400`, and all three must come from the *same* Spotify app.
If the client ID and the token come from different apps, Spotify returns
`400 invalid_grant`, which looks identical to a bad token.

Sanity check that the trio works before deploying. From the repository root, paste the same
three values you just entered (no quotes, no extra whitespace):

```bash
SPOTIFY_CLIENT_ID=xxx SPOTIFY_CLIENT_SECRET=yyy SPOTIFY_REFRESH_TOKEN=zzz node -e '
const b = Buffer.from(process.env.SPOTIFY_CLIENT_ID + ":" + process.env.SPOTIFY_CLIENT_SECRET).toString("base64");
const r = await fetch("https://accounts.spotify.com/api/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + b },
  body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: process.env.SPOTIFY_REFRESH_TOKEN })
});
const j = await r.json();
console.log(r.status, j.error || "ok", j.scope || "");'
```

If the credentials and token are good, expect `200 ok user-read-currently-playing user-read-recently-played`. If you see `invalid_grant` or `invalid_client`, the token and client ID are from different apps or one is wrong; redo step 4.

### 5. Run it locally

```bash
npx wrangler dev
```

Visit `http://localhost:8787/` and play something on Spotify. Note that `wrangler dev`
reads secrets from a `.dev.vars` file, not from the deployed secrets, so create one
(it is git-ignored) if you want local runs to hit the real API:

```
SPOTIFY_CLIENT_ID=…
SPOTIFY_CLIENT_SECRET=…
SPOTIFY_REFRESH_TOKEN=…
```

### 6. Deploy

```bash
npx wrangler deploy
```

Wrangler prints the URL, of the form
`https://now-spotify.<your-subdomain>.workers.dev`. Confirm it:

```bash
curl https://now-spotify.<your-subdomain>.workers.dev/
```

### 7. Point the page at it

In `app.js`, set `SPOTIFY_URL` to the URL from the previous step:

```js
var SPOTIFY_URL = "https://now-spotify.<your-subdomain>.workers.dev";
```

Commit and push. Until this is filled in, the listening card falls back to the
static content in `index.html` — the page never breaks, it just isn't live.

## Development

```bash
npm test        # vitest, running in real workerd
npm run dev     # local server on :8787
npm run deploy  # publish
```

Tests stub `fetch`, so they never call Spotify and need no credentials.

## Design notes

**No KV, no D1, no Cron Trigger.** The Worker does work only when the page asks.
State would be a liability here: the answer is a single track that Spotify already
stores authoritatively.

**Two caches keep upstream traffic low.** The access token lives in a module-scope
variable for the isolate's lifetime — tokens last an hour, so the refresh grant
rarely runs. Responses are cached at the edge for `CACHE_TTL` seconds (20 by
default, set in `wrangler.toml`), so simultaneous visitors collapse into one call.

**CORS is an allowlist.** Only the portfolio origin and localhost get an
`Access-Control-Allow-Origin` header, so another site's JavaScript cannot read the
endpoint from a browser. The URL itself is public; the data is one song title.

**Paused counts as not playing**, so a paused track appears through the fallback as
the last played track rather than being reported as live.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `502`, logs show `token 400 invalid_grant` | Token and client ID are from different Spotify apps, or the token has trailing characters. Redo step 4. |
| `502`, logs show `recently-played 403` | Token lacks `user-read-recently-played`. Redo step 3. |
| Always `null`, never a track | Nothing is playing and there's no recent history on this account. |
| Card not updating on the site | `SPOTIFY_URL` in `app.js` is still the placeholder. See step 7. |
| Browser console shows a CORS error | Serving the page from an origin that isn't on the allowlist in `src/index.js`. |

Live logs: `npx wrangler tail`.
