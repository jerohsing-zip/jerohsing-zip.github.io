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
var SIZE = 32;          // 1024 samples is plenty for dominant color
var BITS = 2;           // 4 levels per channel → 64 bins, stable at this sample count

function chromaOf(r, g, b) {
  var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return mx === 0 ? 0 : (mx - mn) / mx;
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

      var bins = {};
      for (var i = 0; i < data.length; i += 4) {
        var r = data[i], g = data[i + 1], b = data[i + 2];
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
        var k = ((r >> (8 - BITS)) << (BITS * 2)) | ((g >> (8 - BITS)) << BITS) | (b >> (8 - BITS));
        var bin = bins[k] || (bins[k] = { r: 0, g: 0, b: 0, n: 0 });
        bin.r += r; bin.g += g; bin.b += b; bin.n++;
      }

      var out = [];
      for (var key in bins) {
        var q = bins[key];
        var cr = q.r / q.n, cg = q.g / q.n, cb = q.b / q.n;
        var chroma = chromaOf(cr, cg, cb);
        /* Weight by population but favour colour, so a large muddy region
           does not outrank the sleeve's actual hue. */
        out.push({ c: [cr / 255, cg / 255, cb / 255], chroma: chroma, score: q.n * (0.3 + chroma) });
      }
      if (!out.length) { resolve(null); return; }

      out.sort(function (a, b) { return b.score - a.score; });
      var top = out.slice(0, 3);

      /* Every sleeve is returned, including the achromatic ones.

         There was a chroma gate here, refusing anything under 0.05 on the
         grounds that a grey was a no-op — true when the record reached the
         room only as a multiplicative tint, since a grey normalises to a
         multiplier of 1 and moves nothing. The prism strip is additive, and a
         white record throws real white light, so the gate stopped describing
         the render and started deleting from it: a largely white cover scores
         chroma ~0.03, resolved null, and took the strip *and* the lean to zero.
         The record vanished from the room entirely.

         Nothing needs refusing in its place. A grey sleeve still no-ops the
         lean by construction, which check-contrast.mjs proves directly rather
         than relying on a guard up here; and the strip scales with the cover's
         own luminance, so a black sleeve throws almost nothing without anyone
         having to decide that it should. */
      resolve(top.map(function (x) { return x.c; }));
    };
    img.src = url;
  });
}
