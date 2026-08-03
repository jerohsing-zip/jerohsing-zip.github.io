/* ============================================================
   now-spotify — what Jerome is listening to, live.

   GET / → the currently playing track, or the last played one when
   nothing is on. Body matches the `listening` object app.js renders.

   Honest states matter here: a broken Worker must never render as
   "quiet right now". Upstream failure is a 502 (the page keeps its
   previous render); genuine silence is 200 with a null body.
   ============================================================ */
import { getTrack } from "./spotify.js";

const ALLOWED_ORIGINS = [
  /^https:\/\/jerohsing-zip\.github\.io$/,
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/
];

function corsHeaders(origin) {
  const h = { Vary: "Origin" };
  if (origin && ALLOWED_ORIGINS.some((re) => re.test(origin))) {
    h["Access-Control-Allow-Origin"] = origin;
  }
  return h;
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body === undefined ? null : body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers }
  });
}

/* A cached response carries the CORS header of whichever origin filled
   the cache, so it is always restamped for the current caller. */
function withCors(res, cors) {
  const out = new Response(res.body, res);
  out.headers.delete("Access-Control-Allow-Origin");
  for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
  return out;
}

export default {
  async fetch(request, env, ctx) {
    const cors = corsHeaders(request.headers.get("Origin") || "");

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Max-Age": "86400"
        }
      });
    }

    const url = new URL(request.url);
    if (url.pathname !== "/") return json({ error: "not found" }, 404, cors);
    if (request.method !== "GET") {
      return json({ error: "method not allowed" }, 405, { ...cors, Allow: "GET, OPTIONS" });
    }

    const parsedTtl = Number(env.CACHE_TTL);
    const ttl = Number.isFinite(parsedTtl) && parsedTtl >= 0 ? parsedTtl : 20;
    const cache = caches.default;
    const cacheKey = new Request(url.origin + "/", { method: "GET" });

    if (ttl > 0) {
      const hit = await cache.match(cacheKey);
      if (hit) return withCors(hit, cors);
    }

    try {
      const track = await getTrack(env);
      const res = json(track, 200, {
        ...cors,
        "Cache-Control": "public, max-age=" + ttl
      });
      if (ttl > 0) ctx.waitUntil(cache.put(cacheKey, res.clone()));
      return res;
    } catch (e) {
      console.error("[now-spotify]", e.message);
      return json({ error: "upstream unavailable" }, 502, {
        ...cors,
        "Cache-Control": "no-store"
      });
    }
  }
};
