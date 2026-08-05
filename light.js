/* ============================================================
   NIGHT SERVICE — the light model.

   Turns the sun's real altitude and azimuth into the room's colour
   and into the page's text tokens. Pure functions, no DOM, so
   scripts/check-contrast.mjs can sweep every hour of every day and
   prove the accessibility promise in DESIGN.md instead of asserting it.
   ============================================================ */

/* Keyed on solar altitude, not clock hours: these are the real twilight
   thresholds, so golden hour arrives when it actually does and the day
   lengthens with the season. [light through the glass, ambient wall].

   The walls are a real material and keep their colour all day: teal-slate felt
   at night, warming through to sunlit sand. Daylight brightens the room, it
   does not bleach it — a near-neutral daytime stop renders as flat grey, which
   is what the first build shipped. check-contrast.mjs asserts a saturation
   floor at every stop so that cannot come back. */
export var LIGHT = [
  { a: -18, light: [0.05, 0.07, 0.16], room: [0.045, 0.072, 0.070] },   // deep night
  { a: -12, light: [0.08, 0.13, 0.30], room: [0.052, 0.088, 0.098] },
  { a: -6,  light: [0.17, 0.29, 0.56], room: [0.070, 0.120, 0.150] },   // blue hour
  { a: -1,  light: [0.62, 0.40, 0.42], room: [0.160, 0.140, 0.175] },   // civil, rose
  { a: 2,   light: [1.00, 0.56, 0.28], room: [0.310, 0.215, 0.160] },   // golden, warm walls
  { a: 8,   light: [1.00, 0.82, 0.56], room: [0.330, 0.280, 0.205] },   // morning sand
  { a: 25,  light: [1.00, 0.95, 0.86], room: [0.455, 0.395, 0.290] },   // day
  { a: 60,  light: [1.00, 0.97, 0.91], room: [0.520, 0.450, 0.330] }    // high sun
];

/* #D1BA99. Deliberately far less saturated than a literal tungsten reading:
   at full orange this rendered as a glowing orb rather than light falling on a
   wall, and a saturated radial glow is the exact cliché this world refuses. */
export var TUNGSTEN = [0.820, 0.730, 0.600];

function lerp(a, b, t) { return a + (b - a) * t; }
function smooth(t) { return t * t * (3 - 2 * t); }
function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
export function mix3(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
export function scale3(c, k) { return [c[0] * k, c[1] * k, c[2] * k]; }
/* Perceptual weighting, matching the shader's dot(col, vec3(.299,.587,.114)).
   Not relLum() — that one is the WCAG definition and is for contrast only. */
export function luma(c) { return c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114; }

/* Hue angle in degrees, for laying the sleeve's colours across the strip.
   Achromatic colours return 0 rather than NaN — a grey has no hue to sort by
   and any stable answer will do. */
function hueOf(c) {
  var mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]), d = mx - mn;
  if (d < 1e-6) return 0;
  var h;
  if (mx === c[0]) h = ((c[1] - c[2]) / d + 6) % 6;
  else if (mx === c[1]) h = (c[2] - c[0]) / d + 2;
  else h = (c[0] - c[1]) / d + 4;
  return h * 60;
}

/* Real dispersion is ordered by wavelength. The strip cannot borrow a
   spectrum's colours — those come from the record — but it can borrow its
   ordering, so the palette is laid warm edge to cool edge. A sleeve that is
   three shades of rust still orders sensibly and still reads as rust, which
   is the correct answer for that record. */
export function orderByHue(colors) {
  return colors.slice().sort(function (a, b) { return hueOf(a) - hueOf(b); });
}

function ch255(v) { return Math.round(clamp01(v) * 255); }
export function rgb255(c) {
  return "rgb(" + ch255(c[0]) + "," + ch255(c[1]) + "," + ch255(c[2]) + ")";
}
export function rgba255(c, a) {
  return "rgba(" + ch255(c[0]) + "," + ch255(c[1]) + "," + ch255(c[2]) + "," + a + ")";
}

export function lightAt(alt) {
  if (alt <= LIGHT[0].a) return { light: LIGHT[0].light.slice(), room: LIGHT[0].room.slice() };
  var last = LIGHT[LIGHT.length - 1];
  if (alt >= last.a) return { light: last.light.slice(), room: last.room.slice() };
  for (var i = 0; i < LIGHT.length - 1; i++) {
    var p = LIGHT[i], q = LIGHT[i + 1];
    if (alt >= p.a && alt <= q.a) {
      var t = smooth((alt - p.a) / (q.a - p.a));
      return { light: mix3(p.light, q.light, t), room: mix3(p.room, q.room, t) };
    }
  }
  return { light: last.light.slice(), room: last.room.slice() };
}

/* ---------- weather in the room ----------
   Overcast is not a dimmer window, it is a different light. Diffuse skylight
   is weaker, cooler and almost undirectional, so a grey midday flattens the
   whole room — the walls lose saturation and warmth, not just the glass.

   This lives in the model rather than in the shader so the shader receives an
   ambient that is already correct, and so check-contrast.mjs can sweep cloud
   alongside altitude. The room's colour is what text is read against once the
   bands are translucent; it may not be decided somewhere unprovable.

   These three are bounded by the saturation floor in check-contrast.mjs, and
   that bound is tighter than it looks: cooling a warm wall by lifting its blue
   walks it toward neutral, so flatten and cool trade against each other. The
   room may go grey-*ish* under an overcast sky; it may not go grey. */
export var OVERCAST = {
  flatten: 0.34,   // toward the wall's own luminance — the material desaturates
  cool: 0.05,      // and gains a little blue; skylight runs a higher CCT than sun
  dim: 0.26        // and less of it arrives in the first place
};

/* Cloud only matters while the sun is what lights the room. After dark the
   desk lamp is, and an overcast night looks like any other night. */
function daylight(alt) { return clamp01((alt + 4) / 12); }

export function cloudedRoom(room, cloud, alt) {
  var k = clamp01(cloud || 0) * daylight(alt);
  if (k <= 0) return room.slice();
  var g = luma(room);
  var out = mix3(room, [g, g, g], OVERCAST.flatten * k);
  out = [out[0] * (1 - OVERCAST.cool * k), out[1], out[2] * (1 + OVERCAST.cool * 1.8 * k)];
  return scale3(out, 1 - OVERCAST.dim * k);
}

/* Where the window sits. The viewer faces the equator, so the sun sweeps
   left to right through the day in both hemispheres. */
export function windowPos(alt, az, lat) {
  var facing = lat >= 0 ? 180 : 0;
  var off = ((az - facing + 540) % 360) - 180;
  var x = 0.5 + (off / 150) * 0.42;
  var y = 0.34 + Math.max(-18, Math.min(90, alt)) / 90 * 0.56;
  return [Math.max(0.04, Math.min(0.96, x)), Math.max(0.10, Math.min(0.94, y))];
}
export function windowI(alt) {
  if (alt >= 8) return 1;
  if (alt >= 0) return 0.58 + (alt / 8) * 0.42;
  if (alt >= -18) { var k = 1 + alt / 18; return 0.05 + 0.53 * Math.pow(k, 1.9); }
  return 0.05;
}
export function tungstenI(alt) { return Math.max(0, Math.min(1, (6 - alt) / 22)); }

/* ---------- contrast ----------
   The room's colour changes all day, so text colour is derived and then
   checked, never assumed. */
export function relLum(c) {
  function ch(v) { return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  return 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2]);
}
export function contrast(a, b) {
  var la = relLum(a), lb = relLum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/* Force a colour to a target luminance while keeping its hue. Scaling down
   for dark targets, mixing toward white for light ones; relative luminance is
   monotonic in both, so a binary search converges. */
function toLuminance(c, target) {
  var lo = 0, hi = 1, mid, out = c;
  for (var i = 0; i < 24; i++) {
    mid = (lo + hi) / 2;
    out = target < 0.3 ? scale3(c, mid) : mix3(c, [1, 1, 1], mid);
    if (relLum(out) < target) lo = mid; else hi = mid;
  }
  return out;
}

/* A mid-tone ground supports no high-contrast text of either polarity: around
   luminance 0.15–0.35 neither white nor black clears 7:1. So the band is never
   allowed to land there. The scene is decided from the room, then the band is
   driven into that scene's safe zone — hue preserved, luminance forced.
   BAND_DARK/BAND_LIGHT are the two safe zones. */
var BAND_DARK = 0.055;
var BAND_LIGHT = 0.62;

/* The content bands are translucent so the room stays visible behind the whole
   page. That means text no longer sits on a known colour, so these constants
   are shared: room.js interpolates WASH into the shader and
   scripts/check-contrast.mjs replays the same maths to prove the composite
   still clears WCAG against every room the shader can produce. One definition,
   or the proof drifts away from the render. */
export var BAND_ALPHA = 0.84;

export var WASH = {
  poolMin: 0.18,     // the record always colours the room a little
  temper: 0.72,      // how far toward the sleeve's own hue the multiplier goes
  tint: 0.68,        // strength of the hue shift
  add: 0.15,         // additive glow, mostly for after dark
  /* Daylight is simply more light than a record sleeve. A tint calibrated to
     read after dark all but vanishes at noon — the sun was not negating the
     wash so much as out-voting it. The wash is given back what the sun takes
     instead of being made loud at night so it survives the day. */
  dayGain: 1.85,
  /* The tint is a mix toward a tinted copy of the room; past 1.0 it would
     overshoot the sleeve's hue, so 1.0 is the natural stop rather than a
     tuned one. With the gain applied the product reaches it wherever the
     noise pools, which is the intended ceiling and not a clipped one. */
  tintMax: 1.0
};

/* How hard the record pushes, given how much light it is pushing against.
   Keyed on the room's own luminance rather than on the altitude directly:
   brightness is the thing the sleeve is losing to, so compensating against
   anything else leaves a band of the morning where the room has already
   brightened and the wash has not yet been given anything back. */
export function washGain(alt) {
  var floor = luma(LIGHT[0].room), ceil = luma(LIGHT[LIGHT.length - 1].room);
  var k = clamp01((luma(lightAt(alt).room) - floor) / (ceil - floor));
  return 1 + (WASH.dayGain - 1) * k;
}

/* The room as the shader leaves it once a sleeve has washed it. Mirrors the
   GLSL exactly; both read WASH. Note that `gain` multiplies the tint and not
   the glow — see the shader for why that separation exists. */
export function washRoom(room, sleeve, washI, pool, gain) {
  var wl = Math.max(luma(sleeve), 0.05);
  var out = [];
  var k = Math.min(pool * washI * (gain == null ? 1 : gain) * WASH.tint, WASH.tintMax);
  for (var i = 0; i < 3; i++) {
    var w = 1 + (sleeve[i] / wl - 1) * WASH.temper;
    w = Math.max(0.38, Math.min(1.75, w));
    out.push(room[i] * (1 - k) + room[i] * w * k + sleeve[i] * pool * washI * WASH.add);
  }
  return out;
}

/* What the visitor actually reads text against once the band is translucent. */
export function bandOver(band, room) { return mix3(room, band, BAND_ALPHA); }

/* The band is translucent, so text no longer sits on one colour — it sits on
   the composite, and the room behind it is not uniform. These are the extremes
   the shader can put there: the nominal wall, and then black and white. The
   last two are past anything the shader actually draws — a pane never quite
   blows out, a vignetted corner never reaches zero — and that is the point.
   Bounding the render instead of tracking it means the proof survives the next
   change to the shader rather than quietly expiring with it. */
export function bandGrounds(band, room) {
  return [bandOver(band, room), bandOver(band, [0, 0, 0]), bandOver(band, [1, 1, 1])];
}

/* legible(), but the text has to clear `target` on every ground it can land
   on, not just the nominal one. Returns the strongest tint that does; falls
   back to the extreme when no tint can, which the sweep then catches. */
export function legibleOn(grounds, toward, target) {
  for (var k = 0.5; k < 1; k += 0.02) {
    var c = mix3(grounds[0], toward, k), ok = true;
    for (var i = 0; i < grounds.length; i++) {
      if (contrast(c, grounds[i]) < target) { ok = false; break; }
    }
    if (ok) return c;
  }
  return toward;
}

/* The exact tokens app.js writes to :root, for a sun altitude and a cloud
   fraction. The band is translucent, so text is checked against the band
   composited over every room the shader can put behind it — a surface that
   actually exists, rather than the flat colour the band used to be. */
export function tokensFor(alt, cloud) {
  var L = lightAt(alt);
  var room = cloudedRoom(L.room, cloud, alt);
  /* Decided by the sun, not by the wall's brightness. An interior at midday is
     darker than the world outside, so the room stays mid-toned all day — which
     is what lets the bone plate keep separating from it. The content bands are
     a separate surface and go genuinely light while the sun is properly up.
     Cloud flattens that surface; it does not turn day into night. */
  var isLight = alt > 6;
  var band = toLuminance(room, isLight ? BAND_LIGHT : BAND_DARK);
  var toward = isLight ? [0.06, 0.07, 0.07] : [0.97, 0.96, 0.92];
  var grounds = bandGrounds(band, room);
  return {
    scene: isLight ? "light" : "dark",
    band: band,
    grounds: grounds,
    text: legibleOn(grounds, toward, 7),
    text2: legibleOn(grounds, toward, 4.6),
    fallA: mix3(room, L.light, 0.30),
    fallB: scale3(room, 0.72),
    light: L.light,
    room: room
  };
}
