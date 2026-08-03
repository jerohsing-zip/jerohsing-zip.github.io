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
