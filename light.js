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
   or the proof drifts away from the render.

   0.84 -> 0.78: more of the room shows through the page. This is the cheapest
   0.06 available — the derived text tokens absorb it entirely and the worst
   composite holds at 4.60:1, exactly where it was. It does not stay cheap.
   0.76 costs 0.03 of contrast, and by 0.74 the sweep fails in sixteen places.
   The floor is 4.5 and it is not negotiable, so this is close to the end of
   the budget rather than a step along it. */
export var BAND_ALPHA = 0.78;

/* The record's standing presence in the room: a flat lean of the walls toward
   the sleeve's hue. Motionless, and weak enough that it is felt rather than
   seen — the strip is what the record actually looks like.

   This used to be six constants driving a noise field with a daylight gain
   bolted on, because a volumetric tint calibrated to read after dark was
   invisible at noon. There is no longer a volumetric tint, so the whole
   compensating apparatus went with it. */
export var WASH = {
  temper: 0.72,   // how far toward the sleeve's own hue the multiplier goes
  lean: 0.12      // and how much of that lands
};

/* The room as the shader leaves it once a sleeve has leaned on it. Mirrors the
   GLSL exactly; both read WASH. The sleeve is normalised to unit luminance
   first — multiplying the room by a raw sleeve colour just darkens it, and a
   navy cover turned the room muddy instead of blue. Dividing out the colour's
   own brightness leaves hue and saturation, so the room shifts colour while
   holding its light. */
export function washRoom(room, sleeve, washI) {
  /* A true epsilon, not a brightness floor. This used to clamp at 0.05, which
     silently made dark sleeves dim the room instead of colouring it — a navy
     cover at luma 0.027 was divided by 0.05, so its ratios came out flattened
     toward 1 and the tint it should have thrown went missing. The [0.38, 1.75]
     clamp below already bounds the near-black case this was guarding, so the
     floor was redundant as well as wrong. Guard only against division by zero. */
  var wl = Math.max(luma(sleeve), 1e-4);
  var k = clamp01(washI == null ? 1 : washI) * WASH.lean;
  var out = [];
  for (var i = 0; i < 3; i++) {
    var w = Math.max(0.38, Math.min(1.75, 1 + (sleeve[i] / wl - 1) * WASH.temper));
    out.push(room[i] * (1 - k) + room[i] * w * k);
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

/* ---------- the prism ----------
   The record reaches the room as a strip of split light rather than as weather
   in the air. Something with a bevelled edge sits in the room's light; the
   record is what that light breaks into.

   Nothing here varies with time. That is the point rather than an economy: a
   bright band on a wall is furniture, a moving field is weather, and the eye
   tracks weather. The previous wash drifted on the wind and was impossible to
   stop reading.

   The colours are the sleeve's own, laid across the strip's width by
   orderByHue(). What reads as refraction is separation — light that arrived as
   one thing landing as five, side by side — not a manufactured spectrum. */
export var STRIP = {
  /* Half-width of the core, in uv units. The strip runs near-horizontal, so
     this reads as a fraction of viewport height: 0.048 is about 77px of core
     on an 800px-tall window, or ~15px per stop at five stops. It was 0.028,
     which gave each stop 9px and blurred them into one gradient.

     0.072 is about 115px of core on that same window, ~23px per stop. This was
     0.048 and held there on the argument that the core only has to be thick
     enough for the colours to separate, with HALO_W carrying the apparent
     width — a thick core reads as a painted stripe rather than as light.

     That risk is real and this is where to look if the strip ever starts
     reading as paint. But at 0.048 the separation it was protecting was the
     only thing the strip had, and the record deserves more room on the wall
     than that. HALO_W is a multiple of W, so the bloom widens with it and the
     ratio of core to halo is unchanged.

     Costs nothing at the ceiling: stripPeak() is GAIN, the node terms, HALO_GAIN
     and CH_MAX, none of which is W. A wider strip lights more wall at the same
     peak, it does not light it harder. */
  W: 0.072,
  /* Where the core's falloff starts, as a fraction of W. At 0.25 three
     quarters of the core is transition, which is what makes the edge soft
     rather than cut. It was 0.55. */
  EDGE: 0.25,
  /* The bloom: a second, much wider and much dimmer pass carrying the same
     colours, with no caustic nodes. Light spilling past its own edge is what
     separates something glowing from something painted, and it is what does
     the widening — the core stays restrained and the halo carries the size.

     HALO_W is a multiple of W; HALO_GAIN a fraction of GAIN. Both are set from
     looking, not from reasoning. */
  HALO_W: 3.5,
  HALO_GAIN: 0.35,
  L: 0.30,           // half-length
  /* How far from the caster the strip lands — below the window, above the
     lamp. The throw was downward from both at first, which is right for a
     window high on the wall and wrong for a lamp at y=0.17: it put the lamp's
     strip below the floor and off the bottom of the viewport. The sweep could
     not catch it, because stripI() models intensity and not geometry — it
     reported the lamp casting happily after dark while the shader drew
     nothing. Light thrown from below lands above. */
  THROW: 0.42,
  ANG: 0.62,         // radians of sweep either side of centre
  /* The strip's centre never slides left of this. Between about 05:00 and
     11:00 the window sits at uv.x 0.21–0.32 — behind the plate — and so does
     everything it casts, which left the record with nothing but the lean for
     seven hours of every day. So the cast is biased: placed, for those hours,
     rather than purely thrown. That is a real cost and worth naming, because
     everything else in this room is a consequence of where the light is. The
     strip keeps its angle, its length and its rise; only its horizontal
     footing is held. Past noon the geometry clears the plate on its own and
     this stops applying — max(), so nothing jumps when it does. */
  CLEAR: 0.52,
  /* And never right of this, for the same reason in mirror. CLEAR bounds the
     morning; nothing bounded the afternoon, and the cast angle keeps pushing
     the strip right long after the window has stopped moving. The throw is
     along nrm, whose x component grows with the angle, so the two compound:
     at window x 0.96 the strip's centre lands at 1.187 and its left edge at
     0.994 — the record's colour leaves the viewport entirely on a late western
     sun, with nothing on screen to say a record is playing.

     0.88 keeps roughly two thirds of the strip in frame at the extreme and
     lets the rest run off the edge, which is what light does at a frame
     boundary; pinning the whole strip inside would have frozen its sweep
     across a much wider band of the afternoon. Engages from about window x
     0.78, and min() like CLEAR's max(), so nothing jumps when it takes hold.

     Daylight only. Once the lamp is the caster the throw flips sign and the
     centre tops out at 0.733 on its own, so this never binds after dark. */
  CLEAR_R: 0.88,
  /* How much the strip answers the pointer, against the room's own parallax.
     It is applied after CLEAR, not before — folded in earlier it went through
     the max() and the strip lost all sideways movement for the seven hours the
     clamp is active, leaving only the vertical component. It reacted, so it
     looked deliberate, which is the worst kind of wrong.

     Wider in x than in y because that is the axis the strip is thin on: at
     x3.2 the slide is about three times the strip's own half-width and reads
     as the light shifting, while the same gain in y would just bob it. */
  PAR_X: 3.2,
  PAR_Y: 1.0,
  /* Additive strength at full intensity. 0.22 until the halo arrived — the
     bloom is additive on top of the core, so it enters the peak bound, and at
     0.22 the worst case came to 0.78 against a ceiling of 0.65. The rule for
     this is the one written into the original plan: lower GAIN, not the
     ceiling. The ceiling is the claim; the gain is the tuning. The core dims
     slightly and the halo more than repays it. */
  GAIN: 0.18,
  LAMP_W: 0.55,      // the lamp's weight as a caster, against the sun's
  NODE_FLOOR: 0.72,  // caustic nodes: the strip is not evenly lit along its length
  NODE_VAR: 0.55,
  NODE_FREQ: 13.0,
  /* How much of its own darkness a sleeve is allowed to keep.
     The strip divides the sleeve colour by its luminance, which at NORM = 1 is
     full normalisation: every record throws exactly as much light as every
     other, and a dark near-neutral cover — normalised to luma 1 — lands on the
     wall as pale grey. That reads as no relation to the sleeve at all, which
     is the one thing the strip exists to be.

     At NORM < 1 the divisor is L^NORM, so the strip's own luminance comes out
     as L^(1-NORM) and a dark record throws a dark strip. 0.55 leaves roughly a
     2.7x spread between a very dark sleeve and a mid one, which is visible
     without letting a black cover go out entirely.

     Not 0: that is the raw sleeve colour, and it was rejected for the lean for
     a reason recorded in washRoom() — a dark cover then dims the room instead
     of colouring it. This keeps most of that protection while giving the
     darkness back. */
  NORM: 0.55,
  /* How much of the sleeve colour's shared neutral is taken out before it is
     thrown. NORM fixed the brightness and left the real fault: a dark, cool
     cover adds light that *desaturates* the warm wall it lands on, so the band
     came out paler than the room around it — a dark navy sleeve drove the
     band's saturation to 0.06 against a wall at 0.36. Grey, and brighter than
     its surroundings, which is the pale band this was reported as.

     Subtracting min(r,g,b) leaves only what actually carries hue. That is not
     a manufactured colour: it is the sleeve's own hue at higher purity, and it
     is what a prism does — it receives light and returns something more
     saturated than it got. A genuinely grey cover still comes back grey, since
     it has no chromatic remainder to keep, and dims rather than greying the
     wall. signals.js refuses those upstream anyway.

     Not 1.0: taking all of it makes a near-neutral sleeve land as a pure hue
     the cover does not visibly contain, which crosses from separating the
     record's colour into inventing it. */
  PURITY: 0.7,
  /* Unit luminance is not unit channels — a saturated red normalised to
     luma 1 reaches 3.34 in red, which would put the peak addition near 1.0
     and blow the wall out. The wash's own clamp exists for the same reason.
     Still a hard min(), so it bounds the result at every NORM and stripPeak()
     stays a true ceiling. */
  CH_MAX: 2.2
};

/* The worst the strip can add to one channel: a fully saturated sleeve colour
   at a caustic node, with the halo at full strength underneath it, at full
   intensity. check-contrast.mjs holds this to a ceiling, which is what makes
   "the strip cannot break the room" a checked claim rather than an asserted
   one.

   The HALO_GAIN term is the whole reason this function is worth having. The
   bloom is a second additive pass, so it raises the worst case, and a bound
   that forgot it would keep passing while quietly ceasing to be true — the
   exact way stripI() went on reporting a strip the shader was not drawing.
   Mirrors the shader's (plateau*nodes + halo*HALO_GAIN) at its maximum, where
   plateau, nodes-noise and halo are each 1. */
export function stripPeak() {
  return STRIP.GAIN * (STRIP.NODE_FLOOR + STRIP.NODE_VAR + STRIP.HALO_GAIN) * STRIP.CH_MAX;
}

/* The colour one stop of the strip throws, before intensity and gain. Mirrors
   the GLSL exactly; both read STRIP.NORM and STRIP.CH_MAX.

   This exists so "a darker record throws a darker strip" is a checked claim.
   It was not one before, and could not have been: at NORM = 1 the maths was a
   normalisation with nothing to check, and what shipped was a pale grey band
   under every dark sleeve on the page. */
export function stripColor(sleeve) {
  /* PURITY picks the hue, NORM picks the brightness, and the two are kept
     apart on purpose. They were folded together at first — brightness taken
     from what survived the purity subtraction — which quietly punished
     neutrals twice: a white sleeve has almost nothing left after its own grey
     is removed, so it came out at 0.58 of the light it should throw. The
     direction is what purity is for; the sleeve's own luminance is what sets
     how much of it arrives. */
  var mn = Math.min(sleeve[0], sleeve[1], sleeve[2]) * STRIP.PURITY;
  var c = [sleeve[0] - mn, sleeve[1] - mn, sleeve[2] - mn];
  var cl = Math.max(luma(c), 1e-4);
  var target = Math.pow(Math.max(luma(sleeve), 1e-4), 1 - STRIP.NORM);
  var out = [];
  for (var i = 0; i < 3; i++) out.push(Math.min(c[i] / cl * target, STRIP.CH_MAX));
  return out;
}

/* How hard the strip is thrown, given the light there is to refract and how
   much of the room is still visible. Mirrors the shader's dominance maths.

   Excludes the record's own washI: that is whether there is a record at all,
   which is the caller's business, not the light model's. */
export function stripI(alt, cloud, cover) {
  var sun = windowI(alt) * (1 - clamp01(cloud || 0));
  var lamp = tungstenI(alt) * STRIP.LAMP_W;
  return Math.max(sun, lamp) * (1 - clamp01(cover || 0));
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
