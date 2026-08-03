/* ============================================================
   check-secrets.mjs — is each live-signal source actually wired?

   Probes every source with the same call build-live.mjs makes, and
   reports one of three states per source:

     — skipped   no credentials set (you haven't wired it yet)
     x failed    credentials present but the API rejected them
     ok live     real data came back

   That distinction is the whole point: build-live.mjs preserves the
   previous value on failure, so an unconfigured source and a working
   one look identical in live.json. Here they never do.

   Secret VALUES are never printed — only whether each is set, the HTTP
   status, and the one field that proves the call worked.

   Run:  cd scripts && node --env-file=.env check-secrets.mjs
   Node 18+ (uses global fetch). ESM.
   ============================================================ */

const SKIP = Symbol("skip");   // distinct from a failure: nothing was configured

const missing = (...names) => names.filter((n) => !process.env[n]);

/* ---------- probes (mirror build-live.mjs exactly) ---------- */

async function spotify() {
  const need = missing("SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET", "SPOTIFY_REFRESH_TOKEN");
  if (need.length) return { state: SKIP, note: "unset: " + need.join(", ") };

  const id = process.env.SPOTIFY_CLIENT_ID, secret = process.env.SPOTIFY_CLIENT_SECRET;
  const tok = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + Buffer.from(id + ":" + secret).toString("base64")
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: process.env.SPOTIFY_REFRESH_TOKEN })
  });
  if (!tok.ok) {
    const hint = tok.status === 400 ? " — bad refresh token, or client id/secret mismatch"
      : tok.status === 401 ? " — client id/secret rejected" : "";
    throw new Error("token exchange HTTP " + tok.status + hint);
  }
  const auth = { Authorization: "Bearer " + (await tok.json()).access_token };

  const np = await fetch("https://api.spotify.com/v1/me/player/currently-playing", { headers: auth });
  if (np.status === 200) {
    const j = await np.json();
    if (j && j.item) return { note: "now playing: " + j.item.name };
  }
  const top = await fetch("https://api.spotify.com/v1/me/top/tracks?time_range=short_term&limit=1", { headers: auth });
  if (!top.ok) throw new Error("top tracks HTTP " + top.status +
    (top.status === 403 ? " — token missing the user-top-read scope; re-run spotify-auth.mjs" : ""));
  const j = await top.json();
  if (j.items && j.items[0]) return { note: "nothing playing; top track: " + j.items[0].name };
  return { note: "authenticated, but no listening history yet" };
}

async function steam() {
  const need = missing("STEAM_API_KEY", "STEAM_ID");
  if (need.length) return { state: SKIP, note: "unset: " + need.join(", ") };

  const sid = process.env.STEAM_ID;
  if (!/^\d{17}$/.test(sid)) throw new Error("STEAM_ID must be a 17-digit SteamID64 (got " + sid.length + " chars)");

  const res = await fetch("https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v1/" +
    `?key=${process.env.STEAM_API_KEY}&steamid=${sid}&count=10`);
  if (!res.ok) throw new Error("HTTP " + res.status + (res.status === 403 ? " — bad API key" : ""));
  const games = ((await res.json()).response || {}).games || [];
  if (!games.length) return { note: "key works, but no games in the last 2 weeks (or profile is not Public)" };
  const g = games.slice().sort((a, b) => (b.playtime_2weeks || 0) - (a.playtime_2weeks || 0))[0];
  return { note: g.name + " — " + (((g.playtime_2weeks || 0)) / 60).toFixed(1) + "h in 2 weeks" };
}

async function psn() {
  if (!process.env.PSN_NPSSO) return { state: SKIP, note: "unset: PSN_NPSSO (optional)" };
  let api;
  try { api = await import("psn-api"); }
  catch { throw new Error("psn-api not installed — run `npm install` in scripts/"); }
  const code = await api.exchangeNpssoForAccessCode(process.env.PSN_NPSSO);
  const authz = await api.exchangeAccessCodeForAuthTokens(code);
  const res = await api.getRecentlyPlayedGames(authz, { limit: 5 });
  const games = ((res && res.data && res.data.gameLibraryTitlesRetrieve) || {}).games || [];
  if (!games.length) return { note: "authenticated, but no recently played games" };
  return { note: games[0].name || (games[0].concept && games[0].concept.name) || "unknown title" };
}

async function github() {
  if (!process.env.GH_USER) return { state: SKIP, note: "unset: GH_USER" };
  const headers = { "User-Agent": "now-live", Accept: "application/vnd.github+json" };
  if (process.env.GH_TOKEN) headers.Authorization = "Bearer " + process.env.GH_TOKEN;
  const res = await fetch(`https://api.github.com/users/${process.env.GH_USER}/events/public?per_page=30`, { headers });
  if (!res.ok) throw new Error("HTTP " + res.status + (res.status === 404 ? " — no such user" : ""));
  const events = await res.json();
  if (!events.length) return { note: "user exists, but has no public activity yet (fills in after your first push)" };
  const ev = events.find((e) => e.type === "PushEvent") || events[0];
  return { note: (ev.repo && ev.repo.name) + " — " + ev.type.replace("Event", "").toLowerCase() };
}

/* ---------- report ---------- */

const SOURCES = [
  ["spotify", spotify, "listening"],
  ["steam", steam, "playing"],
  ["psn", psn, "playing"],
  ["github", github, "shipping"]
];

const pad = (s, n) => s + " ".repeat(Math.max(0, n - s.length));

async function main() {
  console.log("\nchecking live-signal credentials (values are never printed)\n");

  const results = await Promise.allSettled(SOURCES.map(([, fn]) => fn()));
  let live = 0, skipped = 0, failed = 0;

  results.forEach((r, i) => {
    const [name, , slot] = SOURCES[i];
    if (r.status === "rejected") {
      failed++;
      console.log("  x  " + pad(name, 9) + pad("[" + slot + "]", 12) + "failed — " + ((r.reason && r.reason.message) || r.reason));
    } else if (r.value.state === SKIP) {
      skipped++;
      console.log("  -  " + pad(name, 9) + pad("[" + slot + "]", 12) + "skipped — " + r.value.note);
    } else {
      live++;
      console.log("  ok " + pad(name, 9) + pad("[" + slot + "]", 12) + r.value.note);
    }
  });

  console.log("\n" + live + " live · " + skipped + " not configured · " + failed + " broken");
  if (failed) console.log("fix the broken ones above — build-live.mjs will silently keep the last-known value for them.");
  if (skipped) console.log("unconfigured sources render their empty state on the page (see scripts/README.md).");
  console.log();
}

main().catch((e) => { console.error(e); process.exit(1); });
