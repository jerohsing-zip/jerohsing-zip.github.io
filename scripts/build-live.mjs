/* ============================================================
   build-live.mjs — the scheduled snapshot.
   Fetches Spotify / Steam / PSN / GitHub with secrets (env vars)
   and writes now/live.json for the static site to read.

   Design: each source is fetched independently (Promise.allSettled),
   so one failing never breaks the others. On any failure the previous
   value for that signal is preserved (last-known), so a transient
   outage never blanks the page. PSN is optional and the most fragile.

   The file is only rewritten when a signal actually changed — this runs
   every 20 minutes, and an unconditional write meant a commit every run.

   Run:  node scripts/build-live.mjs      (needs env vars; see README)
   Node 18+ (uses global fetch). ESM.
   ============================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// resolve live.json relative to this file (scripts/..), not the cwd
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "live.json");
const LOCATION = join(ROOT, "location.json");
const now = () => new Date().toISOString();

function readJson(p) { try { return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null; } catch { return null; } }

/* ---------- Spotify: now-playing, else most-played track this week ---------- */
function spotifyTrack(item, nowPlaying, period) {
  return {
    title: item.name,
    artist: (item.artists || []).map((a) => a.name).join(", "),
    album: item.album && item.album.name,
    art: item.album && item.album.images && item.album.images[0] ? item.album.images[0].url : null,
    url: item.external_urls && item.external_urls.spotify,
    nowPlaying: !!nowPlaying,
    period: period || null,
    at: nowPlaying ? now() : null
  };
}
async function spotify() {
  const id = process.env.SPOTIFY_CLIENT_ID, secret = process.env.SPOTIFY_CLIENT_SECRET, refresh = process.env.SPOTIFY_REFRESH_TOKEN;
  if (!id || !secret || !refresh) return null;
  const tok = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + Buffer.from(id + ":" + secret).toString("base64") },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh })
  });
  if (!tok.ok) throw new Error("spotify token " + tok.status);
  const auth = { Authorization: "Bearer " + (await tok.json()).access_token };

  const np = await fetch("https://api.spotify.com/v1/me/player/currently-playing", { headers: auth });
  if (np.status === 200) {
    const j = await np.json();
    if (j && j.item) return spotifyTrack(j.item, true);
  }
  const top = await fetch("https://api.spotify.com/v1/me/top/tracks?time_range=short_term&limit=1", { headers: auth });
  if (top.ok) {
    const j = await top.json();
    if (j.items && j.items[0]) return spotifyTrack(j.items[0], false, "week");
  }
  return null;
}

/* ---------- Steam: most-played game in the last 2 weeks ---------- */
async function steam() {
  const key = process.env.STEAM_API_KEY, sid = process.env.STEAM_ID;
  if (!key || !sid) return null;
  const res = await fetch(`https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v1/?key=${key}&steamid=${sid}&count=10`);
  if (!res.ok) throw new Error("steam " + res.status);
  const games = ((await res.json()).response || {}).games || [];
  if (!games.length) return null;
  const g = games.slice().sort((a, b) => (b.playtime_2weeks || 0) - (a.playtime_2weeks || 0))[0];
  return {
    title: g.name,
    platform: "Steam",
    hoursThisWeek: +(((g.playtime_2weeks || 0)) / 60).toFixed(1),
    minutes: g.playtime_2weeks || 0,
    period: "week",
    at: null
  };
}

/* ---------- PSN: most recently played game (optional, fragile) ---------- */
function parseISODuration(d) {
  if (!d) return null;
  const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/.exec(d);
  if (!m) return null;
  return (+(m[1] || 0)) * 1440 + (+(m[2] || 0)) * 60 + (+(m[3] || 0));
}
async function psn() {
  const npsso = process.env.PSN_NPSSO;
  if (!npsso) return null;
  const api = await import("psn-api");   // dynamic: skipped entirely when PSN unused
  const code = await api.exchangeNpssoForAccessCode(npsso);
  const authz = await api.exchangeAccessCodeForAuthTokens(code);
  const res = await api.getRecentlyPlayedGames(authz, { limit: 5 });
  const games = ((res && res.data && res.data.gameLibraryTitlesRetrieve) || {}).games || [];
  if (!games.length) return null;
  const g = games[0]; // most recent first
  const mins = parseISODuration(g.playDuration);
  return {
    title: g.name || (g.concept && g.concept.name) || "Unknown",
    platform: "PSN",
    hoursThisWeek: mins != null ? +(mins / 60).toFixed(1) : null,
    minutes: mins || 0,
    period: "total",
    at: g.lastPlayedDateTime || null
  };
}

/* ---------- GitHub: latest public activity (no secret needed) ---------- */
async function github() {
  const user = process.env.GH_USER;   // not GITHUB_USER — GitHub reserves that prefix for Variables/Secrets
  if (!user) return null;
  const headers = { "User-Agent": "now-live", Accept: "application/vnd.github+json" };
  if (process.env.GH_TOKEN) headers.Authorization = "Bearer " + process.env.GH_TOKEN;
  const res = await fetch(`https://api.github.com/users/${user}/events/public?per_page=30`, { headers });
  if (!res.ok) throw new Error("github " + res.status);
  const events = await res.json();
  const ev = events.find((e) => e.type === "PushEvent") || events[0];
  if (!ev) return null;
  let type = "activity", message = ev.type.replace("Event", "").toLowerCase();
  const pl = ev.payload || {};
  if (ev.type === "PushEvent") {
    type = "push";
    const commits = pl.commits || [];
    message = commits.length ? commits[commits.length - 1].message.split("\n")[0] : `pushed ${pl.size || 0} commits`;
  } else if (ev.type === "PullRequestEvent") { type = "pr"; message = (pl.pull_request && pl.pull_request.title) || "opened a pull request"; }
  else if (ev.type === "CreateEvent") { type = "create"; message = `created ${pl.ref_type || "repo"}`; }
  else if (ev.type === "IssuesEvent") { type = "issue"; message = (pl.issue && pl.issue.title) || "issue activity"; }
  else if (ev.type === "WatchEvent") { type = "star"; message = "starred a repo"; }
  return {
    type,
    repo: (ev.repo && ev.repo.name) || "",
    message: String(message).slice(0, 120),
    url: ev.repo ? `https://github.com/${ev.repo.name}` : null,
    at: ev.created_at
  };
}

/* ---------- merge + write ---------- */
function pickPlaying(steamG, psnG) {
  if (steamG && steamG.minutes > 0) return steamG;   // Steam has real 2-week playtime → trust it
  if (psnG) return psnG;                              // else PSN's most-recent
  return steamG || null;
}

async function main() {
  const prev = readJson(OUT) || {};
  const results = await Promise.allSettled([spotify(), steam(), psn(), github()]);
  const [sp, st, ps, gh] = results;
  const val = (r) => (r.status === "fulfilled" ? r.value : null);

  const listening = val(sp) || prev.listening || null;
  const playing = pickPlaying(val(st), val(ps)) || prev.playing || null;
  const shipping = val(gh) || prev.shipping || null;

  const signals = {
    // location.json is the source of truth (written by update-location.mjs);
    // mirrored here purely as a fallback for when location.json fails to load.
    location: readJson(LOCATION) || prev.location || undefined,
    listening,
    playing,
    shipping
  };

  [["spotify", sp], ["steam", st], ["psn", ps], ["github", gh]].forEach(([name, r]) => {
    if (r.status === "rejected") console.warn(`[${name}] failed:`, (r.reason && r.reason.message) || r.reason);
    else if (r.value == null) console.log(`[${name}] no data (skipped or empty)`);
    else console.log(`[${name}] ok`);
  });

  /* Only write when a signal actually changed. fetchedAt alone moves on every run,
     and this runs every 20 minutes — writing unconditionally meant the workflow
     committed every single time, ~2000 commits a month of pure noise.
     So fetchedAt means "when the data last changed", which is also what the page's
     "updated Xm ago" should be saying. */
  const same = existsSync(OUT) && stable(pick(signals)) === stable(pick(prev));
  if (same) { console.log("no change — " + OUT + " left alone"); return; }

  writeFileSync(OUT, JSON.stringify({ fetchedAt: now(), ...signals }, null, 2) + "\n");
  console.log("wrote " + OUT);
}

/* The comparable part of a snapshot: everything except timestamps that move on
   their own. A now-playing track restamps `at` every run, and the page doesn't
   render it in that state anyway (the stamp reads "now" — app.js renderListen),
   so comparing it would reintroduce the same 20-minute churn. */
function pick(o) {
  const listening = o.listening && o.listening.nowPlaying
    ? { ...o.listening, at: null }
    : o.listening;
  return { location: o.location, listening, playing: o.playing, shipping: o.shipping };
}

/* stable stringify — key order must not decide whether we commit */
function stable(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
  return "{" + Object.keys(v).sort().filter((k) => v[k] !== undefined)
    .map((k) => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}";
}

main().catch((e) => { console.error(e); process.exit(1); });
