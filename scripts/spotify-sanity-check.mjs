/* ============================================================
   spotify-sanity-check.mjs — confirms a client id/secret/refresh-token
   trio actually works together, before you paste them into
   `wrangler secret put` three separate times and find out the hard way.

   Set SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET and SPOTIFY_REFRESH_TOKEN
   in the environment first, then run this file directly — see
   worker/README.md step 4 for both bash and PowerShell forms.

   Run:  node scripts/spotify-sanity-check.mjs
   Node 18+ (uses global fetch). ESM.
   ============================================================ */

const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REFRESH_TOKEN } = process.env;

const missing = ["SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET", "SPOTIFY_REFRESH_TOKEN"]
  .filter((n) => !process.env[n]);
if (missing.length) {
  console.error("missing env vars: " + missing.join(", "));
  process.exit(1);
}

const b = Buffer.from(SPOTIFY_CLIENT_ID + ":" + SPOTIFY_CLIENT_SECRET).toString("base64");
const r = await fetch("https://accounts.spotify.com/api/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + b },
  body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: SPOTIFY_REFRESH_TOKEN })
});
const j = await r.json();
console.log(r.status, j.error || "ok", j.scope || "");
