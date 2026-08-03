/* ============================================================
   update-location.mjs — writes location.json from a phone ping.

   An iOS Shortcut sends {city, region, lat, lon} to GitHub via
   repository_dispatch; the workflow hands them here as env vars.
   Coordinates are used once — to resolve the IANA timezone — and
   then thrown away, so nothing finer than a city name is ever
   published. See SHORTCUT.md.

   Design: never write a worse file than the one already there.
   A missing city aborts; an unresolvable timezone falls back to the
   previous one; an unchanged city+tz writes nothing at all, so a
   daily ping from home produces no commit.

   Run:  LOC_CITY="Los Angeles" LOC_REGION="California" \
         LOC_LAT=34.05 LOC_LON=-118.24 node scripts/update-location.mjs
   Node 18+ (uses global fetch). ESM.
   ============================================================ */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "location.json");

function readJson(p) { try { return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null; } catch { return null; } }

// same check app.js runs client-side — a bad zone silently drops the site to its fallback
function validTz(tz) {
  if (!tz) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

/* Open-Meteo returns the resolved IANA zone for a coordinate when asked for
   timezone=auto. Keyless, CORS-ok, and already the weather source for the site. */
async function tzFor(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const url = "https://api.open-meteo.com/v1/forecast?latitude=" + lat +
    "&longitude=" + lon + "&current=temperature_2m&timezone=auto";
  const r = await fetch(url);
  if (!r.ok) throw new Error("open-meteo " + r.status);
  const j = await r.json();
  return j.timezone || null;
}

const num = (v) => (v == null || v === "" ? NaN : Number(v));

async function main() {
  const city = (process.env.LOC_CITY || "").trim();
  const region = (process.env.LOC_REGION || "").trim();
  if (!city) { console.error("LOC_CITY is required"); process.exit(1); }

  const prev = readJson(OUT) || {};

  let tz = null;
  try {
    tz = await tzFor(num(process.env.LOC_LAT), num(process.env.LOC_LON));
  } catch (e) {
    console.warn("[tz] lookup failed:", (e && e.message) || e);
  }
  let resolved = validTz(tz);
  if (!resolved) {
    if (tz) console.warn("[tz] rejected invalid zone: " + tz);
    tz = validTz(prev.tz) ? prev.tz : null;
    if (tz) console.warn("[tz] falling back to previous zone: " + tz);
  }
  if (!tz) { console.error("no valid timezone and no usable previous one — refusing to write"); process.exit(1); }

  /* A new city paired with the old city's timezone is worse than staying put:
     the page would show the right place with the wrong clock, wrong sky and
     wrong weather. Leave the last coherent state alone and wait for the next ping. */
  if (!resolved && prev.city && prev.city !== city) {
    console.error("moved to " + city + " but could not resolve its timezone — leaving " +
      prev.city + " in place; re-run when the lookup succeeds");
    process.exit(1);
  }

  if (prev.city === city && prev.tz === tz) { console.log("no change (" + city + " · " + tz + ")"); return; }

  const out = { city, region: region || prev.region || "", tz, updatedAt: new Date().toISOString() };
  writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log("wrote " + OUT + " → " + city + " · " + tz);
}

main().catch((e) => { console.error(e); process.exit(1); });
