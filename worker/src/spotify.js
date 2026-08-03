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
