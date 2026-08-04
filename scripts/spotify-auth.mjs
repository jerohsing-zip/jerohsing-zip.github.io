/* ============================================================
   spotify-auth.mjs — one-time helper to get a Spotify refresh token.
   The refresh token is the only Spotify credential that needs a
   browser consent step; this runs it locally and prints the token.

   Usage:
     SPOTIFY_CLIENT_ID=xxx SPOTIFY_CLIENT_SECRET=yyy node scripts/spotify-auth.mjs
   Then set the printed token on the Worker: cd worker && npx wrangler secret put SPOTIFY_REFRESH_TOKEN
   ============================================================ */
import http from "node:http";


const id = process.env.SPOTIFY_CLIENT_ID, secret = process.env.SPOTIFY_CLIENT_SECRET;
const PORT = 8888;
const REDIRECT = `http://127.0.0.1:${PORT}/callback`;
/* user-read-recently-played powers the "last played" fallback in worker/.
   user-top-read is gone with build-live.mjs's top-tracks fallback. */
const SCOPE = "user-read-currently-playing user-read-recently-played";

if (!id || !secret) {
  console.error("Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET env vars first.");
  process.exit(1);
}

const authUrl = "https://accounts.spotify.com/authorize?" + new URLSearchParams({
  client_id: id, response_type: "code", redirect_uri: REDIRECT, scope: SCOPE
});

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, REDIRECT);
  if (!u.pathname.startsWith("/callback")) { res.writeHead(404); res.end(); return; }
  const code = u.searchParams.get("code");
  if (!code) { res.end("No code returned."); return; }
  try {
    const tok = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + Buffer.from(id + ":" + secret).toString("base64") },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT })
    });
    const j = await tok.json();
    if (j.refresh_token) {
      res.end("Success. You can close this tab; the refresh token is printed in your terminal.");
      console.log("\n=== SPOTIFY_REFRESH_TOKEN ===\n" + j.refresh_token + "\n=============================\nSet it on the Worker:\n  cd worker && npx wrangler secret put SPOTIFY_REFRESH_TOKEN\nPaste the token alone — no quotes, no trailing comment.\n");
    } else {
      res.end("Failed: " + JSON.stringify(j));
      console.error("Token exchange failed:", j);
    }
  } catch (e) { res.end("Error: " + e.message); console.error(e); }
  finally { setTimeout(() => server.close(), 500); }
});

server.listen(PORT, () => {
  console.log("\n1) In your Spotify app settings (developer.spotify.com/dashboard),");
  console.log("   add this EXACT Redirect URI, then Save:\n   " + REDIRECT);
  console.log("\n2) Open this URL in your browser and click Agree:\n\n   " + authUrl + "\n");
});
