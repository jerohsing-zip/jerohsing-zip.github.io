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
