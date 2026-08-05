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

const API = "https://api.spotify.com/v1";

/* The exact field set app.js renders. Nothing more — the page is the
   only consumer and extra fields would just be dead weight on the wire. */
function toTrack(item, { nowPlaying, period, at, progressMs }) {
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
    at,
    /* The playhead. Only meaningful while something is actually playing, so
       it is null on the recently-played fallback rather than a stale number.
       The page extrapolates between polls to draw the turntable's position. */
    progressMs: progressMs != null ? progressMs : null,
    durationMs: item.duration_ms != null ? item.duration_ms : null
  };
}

async function currentlyPlaying(auth) {
  const res = await fetch(API + "/me/player/currently-playing", { headers: auth });
  if (res.status === 204) return null;                  // nothing active
  if (!res.ok) throw new Error("spotify currently-playing " + res.status);

  const j = await res.json().catch(() => null);
  if (!j || !j.item || !j.is_playing) return null;      // paused counts as not playing
  if (j.item.type && j.item.type !== "track") return null;  // podcasts aren't music

  return toTrack(j.item, {
    nowPlaying: true, period: null, at: new Date().toISOString(),
    progressMs: j.progress_ms
  });
}

async function recentlyPlayed(auth) {
  const res = await fetch(API + "/me/player/recently-played?limit=1", { headers: auth });
  if (!res.ok) throw new Error("spotify recently-played " + res.status);

  let j;
  try { j = await res.json(); }
  catch { throw new Error("spotify recently-played: malformed body"); }
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
