/* ============================================================
   NIGHT SERVICE — the signal layer.

   Pure data. Knows nothing about rendering, the DOM, or the
   booth; app.js wires these into the room.

   · solarPosition — where the sun actually is (NOAA algorithm)
   · sunTimes      — sunrise/sunset, so the math is testable
   · regimeOf      — the light regime an altitude falls in
   · albumPalette  — dominant colors of a record sleeve

   The sun math is the one part of this page with a verifiable
   right answer: sunTimes() is checked against Open-Meteo's own
   sunrise/sunset in scripts/check-solar.mjs.
   ============================================================ */

var RAD = Math.PI / 180;
function rad(d) { return d * RAD; }
function deg(r) { return r / RAD; }

/* Days since the J2000.0 epoch, then Julian centuries — the time base
   every term below is a polynomial in. */
function julianCentury(date) {
  return (date.getTime() / 86400000 + 2440587.5 - 2451545) / 36525;
}

/* Declination and the equation of time are shared by position and
   rise/set, so they are solved once here. */
function solarTerms(jc) {
  var gmls = (280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360;   // geometric mean longitude
  var gmas = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);           // geometric mean anomaly
  var eeo = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);       // eccentricity of earth's orbit

  var ctr = Math.sin(rad(gmas)) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) +
            Math.sin(rad(2 * gmas)) * (0.019993 - 0.000101 * jc) +
            Math.sin(rad(3 * gmas)) * 0.000289;                          // equation of center

  var trueLong = gmls + ctr;
  var appLong = trueLong - 0.00569 - 0.00478 * Math.sin(rad(125.04 - 1934.136 * jc));

  var meanObliq = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60;
  var obliq = meanObliq + 0.00256 * Math.cos(rad(125.04 - 1934.136 * jc));

  var decl = deg(Math.asin(Math.sin(rad(obliq)) * Math.sin(rad(appLong))));

  /* Equation of time, in minutes — the gap between clock noon and solar noon. */
  var y = Math.tan(rad(obliq / 2)); y = y * y;
  var eqTime = 4 * deg(
    y * Math.sin(2 * rad(gmls)) -
    2 * eeo * Math.sin(rad(gmas)) +
    4 * eeo * y * Math.sin(rad(gmas)) * Math.cos(2 * rad(gmls)) -
    0.5 * y * y * Math.sin(4 * rad(gmls)) -
    1.25 * eeo * eeo * Math.sin(2 * rad(gmas))
  );

  return { decl: decl, eqTime: eqTime };
}

/* Light bends near the horizon, so the sun is visible slightly before it
   geometrically rises. Without this, sunrise is wrong by minutes. */
function refraction(alt) {
  if (alt > 85) return 0;
  var t = Math.tan(rad(alt));
  var r;
  if (alt > 5) r = 58.1 / t - 0.07 / (t * t * t) + 0.000086 / (t * t * t * t * t);
  else if (alt > -0.575) r = 1735 + alt * (-518.2 + alt * (103.4 + alt * (-12.79 + alt * 0.711)));
  else r = -20.772 / t;
  return r / 3600;
}

/* Where the sun is, from a place and an instant.
   altitude: degrees above the horizon (negative = below, refraction-corrected)
   azimuth:  degrees clockwise from true north (0 N, 90 E, 180 S, 270 W) */
export function solarPosition(lat, lon, date) {
  var d = date || new Date();
  var t = solarTerms(julianCentury(d));

  var utMin = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
  var trueSolar = (utMin + t.eqTime + 4 * lon + 1440) % 1440;
  var ha = trueSolar / 4 - 180;                                   // hour angle, degrees

  var cosZen = Math.sin(rad(lat)) * Math.sin(rad(t.decl)) +
               Math.cos(rad(lat)) * Math.cos(rad(t.decl)) * Math.cos(rad(ha));
  cosZen = Math.max(-1, Math.min(1, cosZen));
  var zenith = deg(Math.acos(cosZen));
  var altitude = 90 - zenith;

  var azimuth;
  var denom = Math.cos(rad(lat)) * Math.sin(rad(zenith));
  if (Math.abs(denom) > 0.001) {
    var c = ((Math.sin(rad(lat)) * Math.cos(rad(zenith))) - Math.sin(rad(t.decl))) / denom;
    azimuth = 180 - deg(Math.acos(Math.max(-1, Math.min(1, c))));
    if (ha > 0) azimuth = -azimuth;
  } else {
    azimuth = lat > 0 ? 180 : 0;                                  // sun overhead; bearing is degenerate
  }

  return {
    altitude: altitude + refraction(altitude),
    azimuth: (azimuth + 360) % 360,
    declination: t.decl
  };
}

/* Sunrise and sunset as UTC Dates, or null on a day the sun never
   crosses the horizon (polar night / midnight sun). 90.833° accounts for
   refraction plus the sun's own radius — the standard rise/set zenith.

   Anchored to the *local solar day* at this longitude, not the UTC calendar
   day. Far east of Greenwich a local sunrise falls on the previous UTC date
   and far west on the next, so anchoring to UTC midnight returns the right
   clock time on the wrong day. */
var MS_PER_DEG = 240000;         // 4 minutes of solar time per degree of longitude

export function sunTimes(lat, lon, date) {
  var d = date || new Date();

  var local = new Date(d.getTime() + lon * MS_PER_DEG);
  var dayStart = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  var t = solarTerms(julianCentury(new Date(dayStart + 43200000)));   // terms at that day's midpoint

  var cosH = Math.cos(rad(90.833)) / (Math.cos(rad(lat)) * Math.cos(rad(t.decl))) -
             Math.tan(rad(lat)) * Math.tan(rad(t.decl));
  if (cosH > 1 || cosH < -1) return { sunrise: null, sunset: null };

  var h = deg(Math.acos(cosH));
  var noon = dayStart + (720 - 4 * lon - t.eqTime) * 60000;

  return {
    sunrise: new Date(noon - h * MS_PER_DEG),
    sunset: new Date(noon + h * MS_PER_DEG)
  };
}

/* The light regime, on real thresholds rather than clock hours.
   These are the actual definitions of twilight, not a design convention. */
export function regimeOf(altitude) {
  if (altitude > 6) return "day";
  if (altitude > 0) return "golden";          // sun up, low and warm
  if (altitude > -6) return "civil";          // the blue hour
  if (altitude > -12) return "nautical";
  if (altitude > -18) return "astronomical";
  return "night";
}

/* ---------- the record sleeve ----------
   Spotify's CDN sends Access-Control-Allow-Origin: *, so a canvas read is
   untainted and no proxy is needed. Verified against i.scdn.co.

   Returns null only when there is genuinely nothing to read — no url, a
   failed load, no pixels. A monochrome sleeve is an answer, not a failure:
   the room renders it as the light it actually is. */
/* 4096 samples into 512 bins. It was 1024 into 64, and the downscale is the
   lossiest step in the whole pipeline — it happens before any of the scoring
   can see the image. At 32px a 600px sleeve averages ~350 source pixels into
   one sample, so a small saturated detail is blended into its surroundings and
   gone before binning starts; at 64 bins two genuinely different hues land in
   the same cell and are averaged toward grey. Measured on one cover, 32/64
   found 15 usable bins and 64/512 found 21, with markedly higher chroma at the
   top. A 64x64 getImageData is still trivially fast. */
var SIZE = 64;
var BITS = 3;

/* Album art puts its subject in the middle and its background at the edges, so
   a sample's distance from centre is a cheap proxy for whether it is the
   record or the wall behind it. Mild on purpose: at 0.45 the corners still
   count for more than half, so this tilts a close call without overriding a
   genuinely edge-to-edge cover. */
var CENTRE_BIAS = 0.45;

/* A colour has to hold this share of the weighted image before it is allowed
   to be the memorable detail. Without it the vibrant target hands the strip to
   a three-pixel speck of JPEG ringing, which is a real colour on the sleeve and
   not in any sense what the sleeve looks like. */
var MIN_POP = 0.004;

/* The vibrant target's own bounds, following the shape Android's Palette uses:
   a saturation floor, and a lightness window that excludes the near-black and
   near-white ends where hue stops being legible.

   The white exclusion is the interesting one. Skipping paper-white *pixels*
   was wrong and was removed — it deleted white covers from the room entirely.
   Excluding near-white *candidates from this one target* is right, and they
   are still eligible to be the dominant. The old filter was not wrong about
   white, it was applied to the wrong question. */
var VIBRANT_MIN_SAT = 0.30;
var VIBRANT_MIN_L = 0.12;
var VIBRANT_MAX_L = 0.92;

/* Palette weights saturation against normalised population; these are its
   proportions, minus the lightness term, which the window above already does.
   3:1 is what lets a small vivid region outrank a large flat one — the whole
   point of having a second target. */
var W_SAT = 3;
var W_POP = 1;

/* HSV saturation: (max-min)/max. Distinct from lightness below, which is the
   HSL midpoint — the vibrant target needs both, since a colour can be fully
   saturated and still be too dark or too pale to read as a hue. */
function satOf(r, g, b) {
  var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return mx === 0 ? 0 : (mx - mn) / mx;
}
function lightOf(r, g, b) {
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255;
}
function dist(a, b) {
  var dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/* Every stop after the first has to stand this far from all the ones already
   chosen. Five stops off a two-colour sleeve would otherwise come back as five
   shades of the same thing, which is worse than three honest ones — the strip
   would read as a gradient and the extra stops would be padding. Under-filling
   is the correct answer for a plain cover; room.js already draws however many
   it is given. */
var MIN_SEP = 0.20;

/* And the second vibrant has to be a different *hue* from the first, not just
   far enough away in RGB. Without this, a cover with one strong colour returns
   a light and a dark version of it and calls them two details. */
var HUE_SEP = 40;

function hueOf(c) {
  var mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]), d = mx - mn;
  if (d < 1e-6) return 0;
  var h;
  if (mx === c[0]) h = ((c[1] - c[2]) / d + 6) % 6;
  else if (mx === c[1]) h = (c[2] - c[0]) / d + 2;
  else h = (c[0] - c[1]) / d + 4;
  return h * 60;
}
function hueGap(a, b) {
  var d = Math.abs(hueOf(a) - hueOf(b)) % 360;
  return d > 180 ? 360 - d : d;
}
function farFrom(y, picked) {
  for (var i = 0; i < picked.length; i++) if (dist(y.c, picked[i].c) < MIN_SEP) return false;
  return true;
}

/* Finer bins buy hue fidelity and cost coherence: a single region of the sleeve
   spreads across neighbouring cells, and each fragment is then too small to
   clear a population floor that the whole region would clear easily. Measured
   on one cover, the subject's green hair landed in four bins at 0.03%, 0.08%,
   0.17% and 0.28% — every one under the floor, together comfortably over it.

   So neighbouring bins are merged back into regions before anything is scored.
   Greedy and population-ordered: the largest bin absorbs everything within
   MERGE_DIST of it, then the next unabsorbed one does the same. This is the
   step median-cut and k-means get for free by construction; doing it after a
   fixed-grid binning is the cheap way to the same place, and it is why the grid
   can afford to be fine in the first place. */
var MERGE_DIST = 0.13;

function mergeNear(cand) {
  var by = cand.slice().sort(function (a, b) { return b.pop - a.pop; });
  var out = [], used = [];
  for (var i = 0; i < by.length; i++) {
    if (used[i]) continue;
    var r = by[i].c[0] * by[i].pop, g = by[i].c[1] * by[i].pop, b = by[i].c[2] * by[i].pop;
    var pop = by[i].pop;
    for (var j = i + 1; j < by.length; j++) {
      if (used[j] || dist(by[i].c, by[j].c) > MERGE_DIST) continue;
      used[j] = 1;
      r += by[j].c[0] * by[j].pop; g += by[j].c[1] * by[j].pop; b += by[j].c[2] * by[j].pop;
      pop += by[j].pop;
    }
    out.push({ c: [r / pop, g / pop, b / pop], pop: pop });
  }
  /* Saturation and lightness are recomputed from the merged colour, never
     carried over from the seed bin — the merged region's own colour is what
     the targets below are choosing between. */
  for (var k = 0; k < out.length; k++) {
    var c = out[k].c;
    out[k].sat = satOf(c[0] * 255, c[1] * 255, c[2] * 255);
    out[k].light = lightOf(c[0] * 255, c[1] * 255, c[2] * 255);
  }
  return out;
}

export function albumPalette(url) {
  return new Promise(function (resolve, reject) {
    if (!url) { resolve(null); return; }
    var img = new Image();
    img.crossOrigin = "anonymous";
    img.onerror = function () { reject(new Error("art load failed")); };
    img.onload = function () {
      var cv = document.createElement("canvas");
      cv.width = cv.height = SIZE;
      var ctx = cv.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, SIZE, SIZE);

      var data;
      try { data = ctx.getImageData(0, 0, SIZE, SIZE).data; }
      catch (e) { reject(e); return; }      // tainted canvas — fail honestly

      var bins = {}, opaque = 0, total = 0;
      for (var i = 0; i < data.length; i += 4) {
        var r = data[i], g = data[i + 1], b = data[i + 2];
        if (data[i + 3] > 8) opaque++;
        var v = Math.max(r, g, b);
        /* Near-black is skipped: it carries no hue and is usually a border or
           a shadow rather than the record's colour.

           Paper-white used to be skipped alongside it, for the same reason and
           with the same stale justification as the chroma gate below it — a
           white pixel is a no-op for a multiplicative tint. Against an additive
           strip it is the most meaningful pixel on the sleeve, and skipping it
           was the larger of the two faults that made white covers vanish: a
           pure white cover left zero bins and resolved null, while a white
           cover with black type left only the anti-aliased grey edges and threw
           a dim grey band. A cover that is mostly white is a white cover.

           Removing it costs less than it looks. The score below already weights
           by chroma, so a real colour still outranks white until white is about
           3.7x its area; a photographic or coloured sleeve returns exactly the
           same palette as before. What changes is the sleeve that is genuinely
           mostly white, which is the case this is for. */
        if (v < 24) continue;
        /* Weighted by distance from centre — see CENTRE_BIAS. The sample index
           has to come back to x,y for that, which is the only reason this loop
           tracks a position at all. */
        var px = (i / 4) % SIZE, py = Math.floor((i / 4) / SIZE);
        var dx = (px + 0.5) / SIZE - 0.5, dy = (py + 0.5) / SIZE - 0.5;
        var w = 1 - CENTRE_BIAS * Math.min(1, (dx * dx + dy * dy) / 0.5);
        var k = ((r >> (8 - BITS)) << (BITS * 2)) | ((g >> (8 - BITS)) << BITS) | (b >> (8 - BITS));
        var bin = bins[k] || (bins[k] = { r: 0, g: 0, b: 0, n: 0 });
        bin.r += r * w; bin.g += g * w; bin.b += b * w; bin.n += w;
        total += w;
      }

      /* An empty bin map after a *successful* read means a genuinely black
         sleeve. An empty one after a read that returned nothing means the read
         failed, and those must not share an outcome: resolving null tells
         app.js "this record has no colour" and clears the room, where
         rejecting leaves the previous record's colour alone, which is what the
         rest of the page does with a failed fetch. Diagnosing a stale-cache
         bug earlier cost an afternoon partly because these looked identical
         from the outside. */
      if (!opaque) { reject(new Error("art read returned no pixels")); return; }

      var raw = [];
      for (var key in bins) {
        var q = bins[key];
        raw.push({ c: [q.r / q.n / 255, q.g / q.n / 255, q.b / q.n / 255], pop: q.n / total });
      }
      if (!raw.length) { resolve(null); return; }
      var cand = mergeNear(raw);

      /* ---- five stops, five different questions ----
         The strip lays its colours across its width, and they used to be the
         top three of one ranked list — n * (0.3 + chroma). One score cannot
         answer two questions, and that one answered neither well: it returned
         three colours that were each somewhat-dominant and somewhat-colourful,
         which is why the strip so often read as three shades of the same thing.

         Every palette library worth copying resolves this the same way, by
         scoring candidates against separate targets rather than ranking one
         list. So each stop gets a job.

         Every sleeve still returns something. The chroma gate that used to sit
         here refused anything under 0.05 on the grounds that a grey was a
         no-op — true when the record reached the room as a multiplicative
         tint, false once the strip became additive, and it took white covers
         to zero. Nothing replaces it: a grey no-ops the lean by construction,
         and the strip scales with the cover's own luminance, so a black sleeve
         throws almost nothing without anyone deciding that it should. */
      var maxPop = 0;
      for (var m = 0; m < cand.length; m++) if (cand[m].pop > maxPop) maxPop = cand[m].pop;

      /* A — the dominant. Pure population, no chroma bonus at all. What the
         cover *is*, including when the honest answer is "white". */
      var A = cand[0];
      for (var a1 = 1; a1 < cand.length; a1++) if (cand[a1].pop > A.pop) A = cand[a1];

      /* B — the memorable detail. Saturation weighted 3:1 against normalised
         population, inside the vibrant window, above the population floor. This
         is the stop that lets a small vivid region — a green head of hair on a
         white sleeve — reach the wall at all. */
      var B = null, bestB = -1;
      for (var b1 = 0; b1 < cand.length; b1++) {
        var x = cand[b1];
        if (x === A) continue;
        if (x.pop < MIN_POP) continue;
        if (x.sat < VIBRANT_MIN_SAT) continue;
        if (x.light < VIBRANT_MIN_L || x.light > VIBRANT_MAX_L) continue;
        var s = W_SAT * x.sat + W_POP * (x.pop / maxPop);
        if (s > bestB) { bestB = s; B = x; }
      }

      /* C — the tonal counterpart, weighted by presence *and* by how far its
         lightness sits from the dominant's. Ranking this one on population
         alone picked another pale colour off a pale cover: Rumours came back
         cream then light-grey, a strip with no visible structure at all, where
         the dark figures on that sleeve were right there. Weighting by tonal
         distance picks them, and on every cover where the two rules disagreed
         the tonal one was better and never worse. */
      var picked = [A];
      if (B) picked.push(B);

      var C = null, bestC = -1;
      for (var c1 = 0; c1 < cand.length; c1++) {
        var y = cand[c1];
        if (y === A || y === B) continue;
        if (y.pop < MIN_POP || !farFrom(y, picked)) continue;
        var sc = y.pop * Math.abs(y.light - A.light);
        if (sc > bestC) { bestC = sc; C = y; }
      }
      if (C) picked.push(C);

      /* D — the second detail. Same vibrant target as B, but required to be a
         different hue from it, so a cover with one strong colour does not
         return a light and a dark version of it and call them two details. */
      var D = null, bestD = -1;
      for (var d1 = 0; d1 < cand.length; d1++) {
        var z = cand[d1];
        if (z === A || z === B || z === C) continue;
        if (z.pop < MIN_POP || !farFrom(z, picked)) continue;
        if (z.sat < VIBRANT_MIN_SAT) continue;
        if (z.light < VIBRANT_MIN_L || z.light > VIBRANT_MAX_L) continue;
        if (B && hueGap(z.c, B.c) < HUE_SEP) continue;
        var sd = W_SAT * z.sat + W_POP * (z.pop / maxPop);
        if (sd > bestD) { bestD = sd; D = z; }
      }
      if (D) picked.push(D);

      /* E — the second dominant. Whatever is left with the most of the sleeve
         behind it, once everything already chosen has been stood clear of. No
         target of its own: by this point the strip has its dominant, its two
         details and its tonal counterpart, and what it still wants is simply
         more of the record. */
      var E = null, bestE = -1;
      for (var e1 = 0; e1 < cand.length; e1++) {
        var v = cand[e1];
        if (v === A || v === B || v === C || v === D) continue;
        if (v.pop < MIN_POP || !farFrom(v, picked)) continue;
        if (v.pop > bestE) { bestE = v.pop; E = v; }
      }
      if (E) picked.push(E);

      /* Order matters to the caller: room.js reads [0] as the dominant for the
         lean, and hue-orders the rest across the strip's width. A sleeve with
         little variety legitimately yields fewer than five, and that is the
         right answer — MIN_SEP would rather return three honest colours than
         pad to five with shades of one. */
      resolve(picked.map(function (x) { return x.c; }));
    };
    img.src = url;
  });
}
