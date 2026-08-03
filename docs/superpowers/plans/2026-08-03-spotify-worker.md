# Spotify Live Updater Worker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the currently playing Spotify track (falling back to the most recently played track) from a Cloudflare Worker that the portfolio page polls every 30 seconds.

**Architecture:** A stateless, pull-only Worker with no KV, D1, or Cron Trigger. It refreshes a Spotify access token on demand and caches it in a module-scope variable for the isolate's lifetime, then queries `currently-playing` and falls back to `recently-played`. Responses are cached at the edge for 20 seconds via the Cache API. The response body is byte-for-byte the `listening` object `app.js` already renders, so no new rendering code is needed.

**Tech Stack:** Cloudflare Workers (ES module syntax), Wrangler 3, Vitest with `@cloudflare/vitest-pool-workers` (tests run in real `workerd`). Plain JavaScript — the repo has no TypeScript and no build step.

## Global Constraints

- Plain JavaScript, ESM. No TypeScript, no bundler config beyond Wrangler's defaults.
- Node 20+ for the tooling; the repo's existing scripts assume Node 18+.
- Worker name is exactly `now-spotify`.
- Allowed CORS origins: `https://jerohsing-zip.github.io`, `http://localhost:*`, `http://127.0.0.1:*`.
- Response field set is exactly: `title`, `artist`, `album`, `art`, `url`, `nowPlaying`, `period`, `at`. No extra fields.
- Page poll interval 30000 ms; default edge cache TTL 20 seconds.
- Secrets are `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REFRESH_TOKEN`, set via `wrangler secret put`. Never committed, never sent to the browser.
- Upstream failure → HTTP `502`. Genuinely nothing playing → HTTP `200` with body `null`. These must never be conflated.
- The repo's existing style is plain `var`/`function` in `app.js` and modern ESM in `scripts/`. Match the file you are editing; do not restructure surrounding code.

**Deviation from the spec, deliberate:** the spec sketched `worker/src/index.js` as one ~150-line module. This plan splits it into `src/spotify.js` (Spotify API concerns) and `src/index.js` (HTTP concerns). Same total size, but token/track logic becomes testable without constructing HTTP requests, and each file has one responsibility.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `worker/src/spotify.js` | Token refresh + caching; fetching and shaping a track. Knows nothing about HTTP requests, CORS, or caching. |
| `worker/src/index.js` | The `fetch` handler: routing, CORS, edge cache, status-code mapping. Knows nothing about Spotify's API shape. |
| `worker/test/spotify.test.js` | Tests for token caching and track resolution. |
| `worker/test/worker.test.js` | Tests for routing, CORS, and error mapping. |
| `worker/wrangler.toml` | Worker name, compatibility date, `CACHE_TTL` var. |
| `worker/vitest.config.js` | Wires Vitest to `workerd` via the Workers pool. |
| `worker/package.json` | `wrangler`, `vitest`, `@cloudflare/vitest-pool-workers`; `test` and `deploy` scripts. |
| `worker/README.md` | Setup: Cloudflare account → re-auth for scopes → secrets → deploy → wire the page. |
| `app.js` | Polls the Worker, renders listening. Stops reading `listening` from `live.json`. |
| `scripts/build-live.mjs` | Spotify removed entirely. |
| `scripts/spotify-auth.mjs` | Scope changed to include `user-read-recently-played`. |
| `.github/workflows/live.yml` | `SPOTIFY_*` env entries removed. |
| `live.json`, `scripts/.env.example`, `scripts/README.md` | Follow-on cleanups. |

---

### Task 1: Worker scaffold and access-token caching

**Files:**
- Create: `worker/package.json`, `worker/wrangler.toml`, `worker/vitest.config.js`
- Create: `worker/src/spotify.js`
- Test: `worker/test/spotify.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `getAccessToken(env) -> Promise<string>`, and `__testing.resetTokenCache() -> void` for test isolation. `env` is an object with `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REFRESH_TOKEN`.

- [ ] **Step 1: Create the project files**

`worker/package.json`:

```json
{
  "name": "now-spotify",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "dev": "wrangler dev",
    "deploy": "wrangler deploy"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.5.2",
    "vitest": "^2.0.5",
    "wrangler": "^3.78.0"
  }
}
```

`worker/wrangler.toml`:

```toml
name = "now-spotify"
main = "src/index.js"
compatibility_date = "2026-01-01"

[vars]
CACHE_TTL = "20"
```

`worker/vitest.config.js`:

```js
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" }
      }
    }
  }
});
```

- [ ] **Step 2: Install dependencies**

Run: `cd worker && npm install`
Expected: completes, creates `worker/package-lock.json` and `worker/node_modules/`.

- [ ] **Step 3: Write the failing tests**

`worker/test/spotify.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getAccessToken, __testing } from "../src/spotify.js";

const ENV = {
  SPOTIFY_CLIENT_ID: "test-id",
  SPOTIFY_CLIENT_SECRET: "test-secret",
  SPOTIFY_REFRESH_TOKEN: "test-refresh"
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

beforeEach(() => __testing.resetTokenCache());
afterEach(() => vi.unstubAllGlobals());

describe("getAccessToken", () => {
  it("exchanges the refresh token for an access token", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ access_token: "access-1", expires_in: 3600 })
    );
    vi.stubGlobal("fetch", fetchMock);

    expect(await getAccessToken(ENV)).toBe("access-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://accounts.spotify.com/api/token");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe(
      "Basic " + btoa("test-id:test-secret")
    );
    expect(init.body.toString()).toContain("grant_type=refresh_token");
  });

  it("reuses a cached token instead of refreshing again", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ access_token: "access-1", expires_in: 3600 })
    );
    vi.stubGlobal("fetch", fetchMock);

    await getAccessToken(ENV);
    await getAccessToken(ENV);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refreshes again once the cached token has expired", async () => {
    let n = 0;
    const fetchMock = vi.fn(async () =>
      jsonResponse({ access_token: "access-" + ++n, expires_in: 10 })
    );
    vi.stubGlobal("fetch", fetchMock);

    expect(await getAccessToken(ENV)).toBe("access-1");
    // expires_in 10s is inside the 30s safety margin, so it is already stale
    expect(await getAccessToken(ENV)).toBe("access-2");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws with Spotify's error description when the grant is rejected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          { error: "invalid_grant", error_description: "Invalid refresh token" },
          400
        )
      )
    );

    await expect(getAccessToken(ENV)).rejects.toThrow(
      /400.*invalid_grant.*Invalid refresh token/
    );
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `cd worker && npm test`
Expected: FAIL — `Failed to resolve import "../src/spotify.js"`.

- [ ] **Step 5: Implement the token logic**

`worker/src/spotify.js`:

```js
/* ============================================================
   spotify.js — talking to Spotify. Knows nothing about HTTP
   requests, CORS or caching; index.js owns all of that.
   ============================================================ */
const TOKEN_URL = "https://accounts.spotify.com/api/token";

/* Access tokens last an hour and an isolate usually outlives many
   requests, so refreshing every time would be pure waste. This is a
   cache and never a source of truth — a cold isolate just refetches. */
let tokenCache = null;   // { token, expiresAt }

function resetTokenCache() { tokenCache = null; }

export const __testing = { resetTokenCache };

export async function getAccessToken(env) {
  const now = Date.now();
  // 30s margin so a token can't expire in flight
  if (tokenCache && tokenCache.expiresAt > now + 30_000) return tokenCache.token;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization:
        "Basic " + btoa(env.SPOTIFY_CLIENT_ID + ":" + env.SPOTIFY_CLIENT_SECRET)
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: env.SPOTIFY_REFRESH_TOKEN
    })
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    /* Carry Spotify's own words. A bare "token 400" cost real debugging
       time once; invalid_grant vs invalid_client point at different fixes. */
    throw new Error(
      "spotify token " + res.status +
      (body.error ? ": " + body.error : "") +
      (body.error_description ? " — " + body.error_description : "")
    );
  }

  tokenCache = {
    token: body.access_token,
    expiresAt: now + (body.expires_in || 3600) * 1000
  };
  return tokenCache.token;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd worker && npm test`
Expected: PASS — 4 tests.

- [ ] **Step 7: Commit**

```bash
git add worker/package.json worker/package-lock.json worker/wrangler.toml \
        worker/vitest.config.js worker/src/spotify.js worker/test/spotify.test.js
git commit -m "feat(worker): scaffold Worker and cache Spotify access tokens"
```

---

### Task 2: Track resolution — now playing, falling back to last played

**Files:**
- Modify: `worker/src/spotify.js`
- Test: `worker/test/spotify.test.js`

**Interfaces:**
- Consumes: `getAccessToken(env)` from Task 1.
- Produces: `getTrack(env) -> Promise<Track|null>` where `Track` is
  `{ title: string, artist: string, album: string|null, art: string|null, url: string|null, nowPlaying: boolean, period: "recent"|null, at: string|null }`.

- [ ] **Step 1: Write the failing tests**

Append to `worker/test/spotify.test.js` (and add `getTrack` to the import at the top so it reads `import { getAccessToken, getTrack, __testing } from "../src/spotify.js";`):

```js
const TOKEN_OK = { access_token: "access-1", expires_in: 3600 };

const TRACK = {
  type: "track",
  name: "Caravan",
  artists: [{ name: "John Wasson" }, { name: "Studio Band" }],
  album: {
    name: "Whiplash (Original Motion Picture Soundtrack)",
    images: [{ url: "https://i.scdn.co/image/big" }, { url: "https://i.scdn.co/image/small" }]
  },
  external_urls: { spotify: "https://open.spotify.com/track/abc" }
};

/* Routes stubbed fetch by URL so each test states only what it cares about. */
function stubSpotify({ current, recent }) {
  const fetchMock = vi.fn(async (url) => {
    const u = String(url);
    if (u.includes("/api/token")) return jsonResponse(TOKEN_OK);
    if (u.includes("currently-playing")) return current();
    if (u.includes("recently-played")) return recent();
    throw new Error("unexpected fetch: " + u);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const noRecent = () => jsonResponse({ items: [] });

describe("getTrack", () => {
  it("returns the currently playing track", async () => {
    stubSpotify({
      current: () => jsonResponse({ is_playing: true, item: TRACK }),
      recent: noRecent
    });

    const t = await getTrack(ENV);
    expect(t).toMatchObject({
      title: "Caravan",
      artist: "John Wasson, Studio Band",
      album: "Whiplash (Original Motion Picture Soundtrack)",
      art: "https://i.scdn.co/image/big",
      url: "https://open.spotify.com/track/abc",
      nowPlaying: true,
      period: null
    });
    expect(Date.parse(t.at)).not.toBeNaN();
    expect(Object.keys(t).sort()).toEqual(
      ["album", "art", "artist", "at", "nowPlaying", "period", "title", "url"]
    );
  });

  it("falls back to the last played track on 204", async () => {
    stubSpotify({
      current: () => new Response(null, { status: 204 }),
      recent: () =>
        jsonResponse({ items: [{ track: TRACK, played_at: "2026-08-03T07:00:00.000Z" }] })
    });

    expect(await getTrack(ENV)).toMatchObject({
      title: "Caravan",
      nowPlaying: false,
      period: "recent",
      at: "2026-08-03T07:00:00.000Z"
    });
  });

  it("treats a paused track as not playing and falls back", async () => {
    stubSpotify({
      current: () => jsonResponse({ is_playing: false, item: TRACK }),
      recent: () =>
        jsonResponse({ items: [{ track: TRACK, played_at: "2026-08-03T07:00:00.000Z" }] })
    });

    expect(await getTrack(ENV)).toMatchObject({ nowPlaying: false, period: "recent" });
  });

  it("treats a podcast episode as nothing playing and falls back", async () => {
    stubSpotify({
      current: () =>
        jsonResponse({ is_playing: true, item: { type: "episode", name: "Some Show" } }),
      recent: () =>
        jsonResponse({ items: [{ track: TRACK, played_at: "2026-08-03T07:00:00.000Z" }] })
    });

    expect(await getTrack(ENV)).toMatchObject({ title: "Caravan", nowPlaying: false });
  });

  it("returns null when nothing is playing and there is no history", async () => {
    stubSpotify({ current: () => new Response(null, { status: 204 }), recent: noRecent });
    expect(await getTrack(ENV)).toBeNull();
  });

  it("survives a track with no album art", async () => {
    const bare = { ...TRACK, album: { name: "X", images: [] }, external_urls: {} };
    stubSpotify({
      current: () => jsonResponse({ is_playing: true, item: bare }),
      recent: noRecent
    });

    expect(await getTrack(ENV)).toMatchObject({ art: null, url: null, album: "X" });
  });

  it("throws when recently-played is forbidden (missing scope)", async () => {
    stubSpotify({
      current: () => new Response(null, { status: 204 }),
      recent: () => jsonResponse({ error: { status: 403 } }, 403)
    });

    await expect(getTrack(ENV)).rejects.toThrow(/recently-played 403/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd worker && npm test`
Expected: FAIL — `getTrack is not a function` (7 new failures; the 4 token tests still pass).

- [ ] **Step 3: Implement track resolution**

Append to `worker/src/spotify.js`:

```js
const API = "https://api.spotify.com/v1";

/* The exact field set app.js renders. Nothing more — the page is the
   only consumer and extra fields would just be dead weight on the wire. */
function toTrack(item, { nowPlaying, period, at }) {
  const album = item.album || {};
  const images = album.images || [];
  return {
    title: item.name,
    artist: (item.artists || []).map((a) => a.name).join(", "),
    album: album.name || null,
    art: images.length ? images[0].url : null,
    url: (item.external_urls || {}).spotify || null,
    nowPlaying,
    period,
    at
  };
}

async function currentlyPlaying(auth) {
  const res = await fetch(API + "/me/player/currently-playing", { headers: auth });
  if (res.status === 204) return null;                  // nothing active
  if (!res.ok) throw new Error("spotify currently-playing " + res.status);

  const j = await res.json().catch(() => null);
  if (!j || !j.item || !j.is_playing) return null;      // paused counts as not playing
  if (j.item.type && j.item.type !== "track") return null;  // podcasts aren't music

  return toTrack(j.item, { nowPlaying: true, period: null, at: new Date().toISOString() });
}

async function recentlyPlayed(auth) {
  const res = await fetch(API + "/me/player/recently-played?limit=1", { headers: auth });
  if (!res.ok) throw new Error("spotify recently-played " + res.status);

  const j = await res.json().catch(() => null);
  const item = j && j.items && j.items[0];
  if (!item || !item.track) return null;

  return toTrack(item.track, {
    nowPlaying: false,
    period: "recent",
    at: item.played_at || null
  });
}

export async function getTrack(env) {
  const auth = { Authorization: "Bearer " + (await getAccessToken(env)) };
  return (await currentlyPlaying(auth)) || (await recentlyPlayed(auth));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd worker && npm test`
Expected: PASS — 11 tests.

- [ ] **Step 5: Commit**

```bash
git add worker/src/spotify.js worker/test/spotify.test.js
git commit -m "feat(worker): resolve now-playing with last-played fallback"
```

---

### Task 3: HTTP layer — routing, CORS, edge cache, error mapping

**Files:**
- Create: `worker/src/index.js`
- Test: `worker/test/worker.test.js`

**Interfaces:**
- Consumes: `getTrack(env)` and `__testing.resetTokenCache()` from Tasks 1–2.
- Produces: the default export `{ fetch(request, env, ctx) }` that Wrangler runs.

`env` additionally carries `CACHE_TTL` (a string). `"0"` disables the edge cache; tests set it to `"0"` so the Cache API cannot leak state between them.

- [ ] **Step 1: Write the failing tests**

`worker/test/worker.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import worker from "../src/index.js";
import { __testing } from "../src/spotify.js";

const ENV = {
  SPOTIFY_CLIENT_ID: "test-id",
  SPOTIFY_CLIENT_SECRET: "test-secret",
  SPOTIFY_REFRESH_TOKEN: "test-refresh",
  CACHE_TTL: "0"
};

const SITE = "https://jerohsing-zip.github.io";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

const TRACK = {
  type: "track",
  name: "Caravan",
  artists: [{ name: "John Wasson" }],
  album: { name: "Whiplash", images: [{ url: "https://i.scdn.co/image/big" }] },
  external_urls: { spotify: "https://open.spotify.com/track/abc" }
};

function stubPlaying() {
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    const u = String(url);
    if (u.includes("/api/token")) return jsonResponse({ access_token: "a", expires_in: 3600 });
    if (u.includes("currently-playing")) return jsonResponse({ is_playing: true, item: TRACK });
    return jsonResponse({ items: [] });
  }));
}

async function call(request) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, ENV, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

const get = (opts = {}) =>
  new Request("https://now-spotify.example.workers.dev/", {
    headers: opts.origin ? { Origin: opts.origin } : {}
  });

beforeEach(() => __testing.resetTokenCache());
afterEach(() => vi.unstubAllGlobals());

describe("worker fetch", () => {
  it("returns the track as JSON", async () => {
    stubPlaying();
    const res = await call(get());

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    expect(await res.json()).toMatchObject({ title: "Caravan", nowPlaying: true });
  });

  it("returns 200 with null when nothing is playing at all", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const u = String(url);
      if (u.includes("/api/token")) return jsonResponse({ access_token: "a", expires_in: 3600 });
      if (u.includes("currently-playing")) return new Response(null, { status: 204 });
      return jsonResponse({ items: [] });
    }));

    const res = await call(get());
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  it("returns 502 when Spotify fails, so the page can keep its last render", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      jsonResponse({ error: "invalid_grant", error_description: "Invalid refresh token" }, 400)
    ));

    const res = await call(get());
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBeTruthy();
  });

  it("echoes the CORS header for the site origin", async () => {
    stubPlaying();
    const res = await call(get({ origin: SITE }));
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(SITE);
    expect(res.headers.get("Vary")).toContain("Origin");
  });

  it("allows localhost for development", async () => {
    stubPlaying();
    const res = await call(get({ origin: "http://localhost:8000" }));
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:8000");
  });

  it("omits the CORS header for an unknown origin", async () => {
    stubPlaying();
    const res = await call(get({ origin: "https://evil.example.com" }));
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("answers CORS preflight", async () => {
    const res = await call(new Request("https://now-spotify.example.workers.dev/", {
      method: "OPTIONS",
      headers: { Origin: SITE }
    }));

    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
  });

  it("404s an unknown path", async () => {
    const res = await call(new Request("https://now-spotify.example.workers.dev/nope"));
    expect(res.status).toBe(404);
  });

  it("405s a non-GET method", async () => {
    const res = await call(new Request("https://now-spotify.example.workers.dev/", {
      method: "POST"
    }));
    expect(res.status).toBe(405);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd worker && npm test`
Expected: FAIL — `Failed to resolve import "../src/index.js"`.

- [ ] **Step 3: Implement the fetch handler**

`worker/src/index.js`:

```js
/* ============================================================
   now-spotify — what Jerome is listening to, live.

   GET / → the currently playing track, or the last played one when
   nothing is on. Body matches the `listening` object app.js renders.

   Honest states matter here: a broken Worker must never render as
   "quiet right now". Upstream failure is a 502 (the page keeps its
   previous render); genuine silence is 200 with a null body.
   ============================================================ */
import { getTrack } from "./spotify.js";

const ALLOWED_ORIGINS = [
  /^https:\/\/jerohsing-zip\.github\.io$/,
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/
];

function corsHeaders(origin) {
  const h = { Vary: "Origin" };
  if (origin && ALLOWED_ORIGINS.some((re) => re.test(origin))) {
    h["Access-Control-Allow-Origin"] = origin;
  }
  return h;
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body === undefined ? null : body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers }
  });
}

/* A cached response carries the CORS header of whichever origin filled
   the cache, so it is always restamped for the current caller. */
function withCors(res, cors) {
  const out = new Response(res.body, res);
  out.headers.delete("Access-Control-Allow-Origin");
  for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
  return out;
}

export default {
  async fetch(request, env, ctx) {
    const cors = corsHeaders(request.headers.get("Origin") || "");

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Max-Age": "86400"
        }
      });
    }

    const url = new URL(request.url);
    if (url.pathname !== "/") return json({ error: "not found" }, 404, cors);
    if (request.method !== "GET") {
      return json({ error: "method not allowed" }, 405, { ...cors, Allow: "GET, OPTIONS" });
    }

    const ttl = Number(env.CACHE_TTL ?? 20);
    const cache = caches.default;
    const cacheKey = new Request(url.origin + "/", { method: "GET" });

    if (ttl > 0) {
      const hit = await cache.match(cacheKey);
      if (hit) return withCors(hit, cors);
    }

    try {
      const track = await getTrack(env);
      const res = json(track, 200, {
        ...cors,
        "Cache-Control": "public, max-age=" + ttl
      });
      if (ttl > 0) ctx.waitUntil(cache.put(cacheKey, res.clone()));
      return res;
    } catch (e) {
      console.error("[now-spotify]", e.message);
      return json({ error: "upstream unavailable", detail: e.message }, 502, {
        ...cors,
        "Cache-Control": "no-store"
      });
    }
  }
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd worker && npm test`
Expected: PASS — 20 tests across both files.

- [ ] **Step 5: Commit**

```bash
git add worker/src/index.js worker/test/worker.test.js
git commit -m "feat(worker): add HTTP layer with CORS, edge cache and honest error states"
```

---

### Task 4: Re-auth for the new scope, and the setup README

**Files:**
- Modify: `scripts/spotify-auth.mjs:16`
- Create: `worker/README.md`

**Interfaces:**
- Consumes: the deployed Worker from Task 3.
- Produces: nothing consumed by later tasks. Task 5 references the Worker URL that this README explains how to obtain.

The existing refresh token lacks `user-read-recently-played`, so the fallback would 403 (Task 2 has a test pinning that error). This task makes the re-auth possible and documents it.

- [ ] **Step 1: Update the requested scopes**

In `scripts/spotify-auth.mjs`, replace line 16:

```js
const SCOPE = "user-read-currently-playing user-top-read";
```

with:

```js
/* user-read-recently-played powers the "last played" fallback in worker/.
   user-top-read is gone with build-live.mjs's top-tracks fallback. */
const SCOPE = "user-read-currently-playing user-read-recently-played";
```

- [ ] **Step 2: Update the helper's closing instructions**

In the same file, replace the success log on line 41:

```js
      console.log("\n=== SPOTIFY_REFRESH_TOKEN ===\n" + j.refresh_token + "\n=============================\nAdd this as a repo secret. Done.\n");
```

with:

```js
      console.log("\n=== SPOTIFY_REFRESH_TOKEN ===\n" + j.refresh_token + "\n=============================\nSet it on the Worker:\n  cd worker && npx wrangler secret put SPOTIFY_REFRESH_TOKEN\nPaste the token alone — no quotes, no trailing comment.\n");
```

- [ ] **Step 3: Write the README**

`worker/README.md`:

````markdown
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

Sanity check, from the repository root, that the trio works before deploying:

```bash
node --env-file=scripts/.env -e '
const b = Buffer.from(process.env.SPOTIFY_CLIENT_ID + ":" + process.env.SPOTIFY_CLIENT_SECRET).toString("base64");
const r = await fetch("https://accounts.spotify.com/api/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + b },
  body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: process.env.SPOTIFY_REFRESH_TOKEN })
});
const j = await r.json();
console.log(r.status, j.error || "ok", j.scope || "");'
```

Expect `200 ok user-read-currently-playing user-read-recently-played`.

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
````

- [ ] **Step 4: Verify the README's commands are accurate**

Run: `cd worker && npm test` (still passing) and confirm every script referenced
in the README exists in `package.json`: `test`, `dev`, `deploy`.

- [ ] **Step 5: Commit**

```bash
git add worker/README.md scripts/spotify-auth.mjs
git commit -m "docs(worker): add setup README; request recently-played scope"
```

---

### Task 5: Wire the page to the Worker and remove Spotify from the cron pipeline

**Files:**
- Modify: `app.js` (add poller; `renderSignals` stops rendering `listening`)
- Modify: `scripts/build-live.mjs` (remove `spotify()`, `spotifyTrack()`, and `listening`)
- Modify: `.github/workflows/live.yml:36-38` (drop `SPOTIFY_*` env)
- Modify: `live.json` (drop the `listening` key)
- Modify: `scripts/.env.example`, `scripts/README.md`

**Interfaces:**
- Consumes: the deployed Worker URL from Task 4.
- Produces: nothing — this is the final task.

- [ ] **Step 1: Add the Worker poller to `app.js`**

Immediately above the `/* ---------- data ---------- */` block (around line 186), add:

```js
  /* ---------- listening (live) ----------
     Owned entirely by the now-spotify Worker, not by live.json — a track
     changes every few minutes and the 20-minute cron could never keep up.
     Paste the deployed Worker URL here; see worker/README.md step 7.
     Left as the placeholder, the card just keeps its static HTML. */
  var SPOTIFY_URL = "https://now-spotify.CHANGE-ME.workers.dev";

  function loadListening() {
    if (SPOTIFY_URL.indexOf("CHANGE-ME") !== -1) return;
    fetch(SPOTIFY_URL, { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) { renderListen(d); })
      /* A failed fetch leaves the previous render alone. Showing
         "quiet right now" because the Worker is down would be a lie. */
      .catch(function () {});
  }
```

- [ ] **Step 2: Stop `renderSignals` from rendering listening**

In `app.js`, change:

```js
  function renderSignals(data) {
    renderListen(data.listening); renderPlay(data.playing);
    renderShip(data.shipping); renderFresh(data.fetchedAt);
  }
```

to:

```js
  function renderSignals(data) {
    /* listening deliberately absent — the Worker owns it (loadListening) */
    renderPlay(data.playing);
    renderShip(data.shipping); renderFresh(data.fetchedAt);
  }
```

- [ ] **Step 3: Start the poller**

In `app.js`, after the existing `setInterval(load, 180000);` line (around line 300), add:

```js
  loadListening();
  setInterval(loadListening, 30000);   // now-playing, straight from the Worker
```

- [ ] **Step 4: Remove Spotify from `build-live.mjs`**

Delete the whole `/* ---------- Spotify ... ---------- */` block — both
`spotifyTrack()` and `spotify()` (lines 29–64).

In `main()`, change:

```js
  const results = await Promise.allSettled([spotify(), steam(), psn(), github()]);
  const [sp, st, ps, gh] = results;
  const val = (r) => (r.status === "fulfilled" ? r.value : null);

  const listening = val(sp) || prev.listening || null;
  const playing = pickPlaying(val(st), val(ps)) || prev.playing || null;
```

to:

```js
  const results = await Promise.allSettled([steam(), psn(), github()]);
  const [st, ps, gh] = results;
  const val = (r) => (r.status === "fulfilled" ? r.value : null);

  const playing = pickPlaying(val(st), val(ps)) || prev.playing || null;
```

Remove `listening` from the `signals` object, and change the reporting line to:

```js
  [["steam", st], ["psn", ps], ["github", gh]].forEach(([name, r]) => {
```

Then simplify `pick()`, whose entire `listening` special case exists only for a
now-playing track that no longer passes through this file:

```js
/* The comparable part of a snapshot. Listening lives in the Worker now, so
   nothing here restamps itself between runs. */
function pick(o) {
  return { location: o.location, playing: o.playing, shipping: o.shipping };
}
```

Finally update the file header comment: change
`Fetches Spotify / Steam / PSN / GitHub` to `Fetches Steam / PSN / GitHub`, and add
a line noting `listening comes from the now-spotify Worker; see worker/README.md`.

- [ ] **Step 5: Remove the Spotify secrets from the workflow**

In `.github/workflows/live.yml`, delete these three lines from the `env:` block:

```yaml
          SPOTIFY_CLIENT_ID: ${{ secrets.SPOTIFY_CLIENT_ID }}
          SPOTIFY_CLIENT_SECRET: ${{ secrets.SPOTIFY_CLIENT_SECRET }}
          SPOTIFY_REFRESH_TOKEN: ${{ secrets.SPOTIFY_REFRESH_TOKEN }}
```

Also update the workflow's header comment: `Refreshes live.json from Spotify /
Steam / PSN / GitHub` becomes `Refreshes live.json from Steam / PSN / GitHub`.

- [ ] **Step 6: Drop `listening` from `live.json`**

Delete the `"listening": { … }` block from `live.json`. The bot rewrites the file on
its next run; removing it now keeps a stale track from being served in the meantime.

- [ ] **Step 7: Update the script docs**

In `scripts/.env.example`, delete the three `SPOTIFY_*` lines and their
`# --- Spotify … ---` heading, replacing them with:

```
# --- Spotify moved to worker/ (a Cloudflare Worker; see worker/README.md) ---
```

In `scripts/README.md`, remove Spotify from the list of sources this script fetches
and from the secrets table, and note that listening data now comes from the Worker.

- [ ] **Step 8: Verify the pipeline still runs**

Run: `cd scripts && node --env-file=.env build-live.mjs`
Expected: logs `[steam]`, `[psn]`, `[github]` lines with no `[spotify]` line, no
crash, and `live.json` has no `listening` key.

- [ ] **Step 9: Verify the page**

Serve the site (`npx serve .` or `python -m http.server`) and open it. With
`SPOTIFY_URL` still the placeholder, confirm the page loads and the other three
signals render. After Task 4's deploy, paste the real URL and confirm the listening
card populates within 30 seconds and follows a track change.

- [ ] **Step 10: Commit**

```bash
git add app.js scripts/build-live.mjs scripts/.env.example scripts/README.md \
        .github/workflows/live.yml live.json
git commit -m "feat: serve listening from the Worker, drop Spotify from the cron"
```

---

## Verification

Before opening the PR:

1. `cd worker && npm test` — all 20 tests pass.
2. `cd scripts && node --env-file=.env build-live.mjs` — runs clean without Spotify.
3. `grep -rn "spotify" app.js scripts/build-live.mjs .github/workflows/live.yml` —
   only the `SPOTIFY_URL` constant and comments remain.
4. `npx wrangler deploy` from `worker/`, then `curl` the URL and confirm a track.

Note that step 4 requires the Cloudflare login and the re-minted token, which only
the repository owner can perform. If the implementing agent lacks those credentials,
it must stop after step 3, leave `SPOTIFY_URL` at its placeholder, and say plainly
in the PR that deployment and the URL substitution remain outstanding.
