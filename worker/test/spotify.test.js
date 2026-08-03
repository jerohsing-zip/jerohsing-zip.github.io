import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getAccessToken, getTrack, __testing } from "../src/spotify.js";

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
