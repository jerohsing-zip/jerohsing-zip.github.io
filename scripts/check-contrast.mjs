/* Proves the accessibility promise in DESIGN.md instead of asserting it.
   Sweeps every solar altitude the room can reach and checks the derived
   tokens, then checks the fixed paper surfaces.
   Run: node scripts/check-contrast.mjs */
import {
  tokensFor, contrast, relLum, washRoom, washGain, bandGrounds, orderByHue,
  LIGHT, BAND_ALPHA, WASH
} from "../light.js";

const BODY = 4.5;      // WCAG AA, normal text
const LARGE = 3.0;     // WCAG AA, large text and UI edges

let fail = 0;
const bad = (msg) => { console.log("FAIL " + msg); fail++; };

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);


/* ---- the room must stay a coloured room at every hour ----
   The first build's daytime stops were near-neutral and rendered as flat grey.
   A saturation floor at every stop, and on the interpolated result, keeps the
   walls a real material instead of bleaching them as the sun climbs. */
const SAT_FLOOR = 0.12;
const sat = (c) => { const mx = Math.max(...c), mn = Math.min(...c); return mx ? (mx - mn) / mx : 0; };

/* Cloud is part of the light model, so every sweep below runs the whole sky.
   0 is a clear day; 1 is the overcast that flattens and cools the room. */
const CLOUDS = [0, 0.25, 0.5, 0.75, 1];
const ALTS = [];
for (let alt = -90; alt <= 90; alt += 0.5) ALTS.push(alt);

for (const stop of LIGHT) {
  const s = sat(stop.room);
  if (s < SAT_FLOOR) bad(`LIGHT stop at ${stop.a}° has room saturation ${s.toFixed(3)}, needs ${SAT_FLOOR} — that renders as grey`);
}
/* Overcast desaturates the walls on purpose. The floor is what stops that
   becoming the flat grey the first build shipped: cloud may flatten the room,
   it may not erase the material. */
let worstSat = Infinity, atSat = "";
for (const alt of ALTS) for (const cloud of CLOUDS) {
  const s = sat(tokensFor(alt, cloud).room);
  if (s < worstSat) { worstSat = s; atSat = `${alt}° / cloud ${cloud}`; }
}
console.log(`room saturation worst ${worstSat.toFixed(3)} at ${atSat} (floor ${SAT_FLOOR})`);
if (worstSat < SAT_FLOOR) bad(`interpolated room saturation ${worstSat.toFixed(3)} at ${atSat}`);

/* ---- the room, all day, under every sky ----
   -90 to 90 covers every latitude and season, including the polar cases.

   The bands are translucent, so the ground is no longer --band: it is --band
   composited over the room, and the room is not one colour across a viewport.
   bandGrounds() returns the extremes the shader can put back there, and text
   has to clear the bar on all of them. */
let worstText = Infinity, worstText2 = Infinity, atText = "", atText2 = "";
let scenes = new Set();

for (const alt of ALTS) for (const cloud of CLOUDS) {
  const t = tokensFor(alt, cloud);
  scenes.add(t.scene);
  const where = `altitude ${alt}° / cloud ${cloud}`;
  for (const ground of t.grounds) {
    const cText = contrast(t.text, ground);
    const cText2 = contrast(t.text2, ground);
    if (cText < worstText) { worstText = cText; atText = where; }
    if (cText2 < worstText2) { worstText2 = cText2; atText2 = where; }
    if (cText < BODY) bad(`--text on the band composite at ${where} = ${cText.toFixed(2)}:1`);
    if (cText2 < BODY) bad(`--text-2 on the band composite at ${where} = ${cText2.toFixed(2)}:1`);
  }
}

console.log(`band alpha ${BAND_ALPHA} — text is checked on the composite, not the band`);
console.log(`room sweep  --text   worst ${worstText.toFixed(2)}:1 at ${atText}`);
console.log(`room sweep  --text-2 worst ${worstText2.toFixed(2)}:1 at ${atText2}`);
console.log(`scenes reached: ${[...scenes].join(", ")}`);
if (scenes.size < 2) bad("the room never crosses between light and dark scenes");

/* ---- the paper surfaces: fixed, so checked once ---- */
const paper = hex("#E8E2D4"), ink = hex("#1B1E1C"), ink2 = hex("#55584F"), onair = hex("#8E1F1F");
const pairs = [
  ["--ink on --paper", ink, paper, BODY],
  ["--ink-2 on --paper", ink2, paper, BODY],
  ["--onair on --paper (link hover)", onair, paper, BODY],
  ["--onair lamp on --paper", onair, paper, LARGE]
];
for (const [name, fg, bg, min] of pairs) {
  const c = contrast(fg, bg);
  console.log(`${name.padEnd(34)} ${c.toFixed(2)}:1`);
  if (c < min) bad(`${name} = ${c.toFixed(2)}:1, needs ${min}`);
}

/* ---- the album wash must not be able to break the room ----
   The wash now carries a daylight gain — a tint calibrated for the night is
   invisible at noon — so the sleeve pushes hardest exactly when the room is
   brightest. washRoom() mirrors the shader's maths, and the sleeves below are
   the corners of the colour cube: no real cover can push further than these.

   The band is derived from the unwashed room by design; the wash lands behind
   the band, where bandGrounds() has already bounded it by black and white. So
   what has to hold here is narrower and checkable: the wash may not drive the
   room out of range, and it may not bleach the room to grey or to white. */
const SLEEVES = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [0, 1, 1], [1, 0, 1], [1, 1, 1], [.04, .04, .04]];

for (const alt of ALTS) for (const cloud of CLOUDS) {
  const t = tokensFor(alt, cloud);
  for (const sleeve of SLEEVES) for (const pool of [WASH.poolMin, 1]) {
    const w = washRoom(t.room, sleeve, 1, pool, washGain(alt));
    for (const v of w) if (!isFinite(v) || v < 0) bad(`washed room out of range at ${alt}°: ${w}`);
  }
}

/* The record has to stay visible as the sun comes up — the complaint that
   started this was that daylight simply negated the sleeve. Measured as
   chromaticity, each channel over the room's own luminance, so it asks how
   much *colour* the record throws rather than how bright the room got.

   Two claims, both about the compensation rather than about a colour. Reach
   itself cannot be barred at a number: the room's hue swings hard through
   sunrise — rose to orange in a few degrees — and a yellow sleeve against an
   orange wall is quietly close to a no-op no matter how hard it pushes. That
   is the room being honest, not the gain failing. */
const chroma = (c) => { const l = Math.max(c[0] * .299 + c[1] * .587 + c[2] * .114, 1e-4); return c.map((v) => v / l); };
/* Measured where the room actually spends its area. The wash's pool is a noise
   field that averages near the middle of its range; at pool 1 the tint has
   already hit WASH.tintMax and the gain has nothing left to give, so measuring
   there would test the clamp rather than the compensation. */
const POOL = WASH.poolMin + (1 - WASH.poolMin) * 0.5;
const reach = (alt, sleeve, gain) => {
  const room = tokensFor(alt, 0).room;
  const a = chroma(room), b = chroma(washRoom(room, sleeve, 1, POOL, gain));
  return Math.max(...a.map((v, i) => Math.abs(v - b[i])));
};

/* 1. Compensation never goes backwards as the room brightens. */
let lastGain = -Infinity, lastAlt = null;
for (const alt of ALTS) {
  const g = washGain(alt);
  if (g < lastGain - 1e-9) bad(`washGain falls from ${lastGain.toFixed(3)} at ${lastAlt}° to ${g.toFixed(3)} at ${alt}°`);
  lastGain = g; lastAlt = alt;
}

/* 2. In real daylight the gain is materially there — the sleeve throws
   meaningfully more colour than it would have. Below this margin the whole
   mechanism is a rounding error and the sun has won again. */
const MARGIN = 1.25;
let worstLift = Infinity, atLift = "";
for (const sleeve of SLEEVES.slice(0, 6)) {
  for (const alt of ALTS.filter((a) => a >= 20)) {
    const lift = reach(alt, sleeve, washGain(alt)) / reach(alt, sleeve, 1);
    if (lift < worstLift) { worstLift = lift; atLift = `sleeve ${sleeve} at ${alt}°`; }
  }
}
console.log(`wash gain: ${washGain(-6).toFixed(2)}× at night, ${washGain(60).toFixed(2)}× at high sun`);
console.log(`daylight wash lift: worst ${worstLift.toFixed(2)}× (${atLift})`);
if (worstLift < MARGIN) bad(`the sun still out-votes the record: only ${worstLift.toFixed(2)}× lift at ${atLift}`);

const t0 = tokensFor(0, 0);
if (relLum(t0.band) > 1 || relLum(t0.band) < 0) bad("band luminance out of range");

/* ---- the strip's colours are the sleeve's ----
   orderByHue lays the three palette colours across the strip's width. It may
   reorder them; it may not invent, drop or duplicate one. A rainbow that
   contains a colour the cover does not is the exact failure this design was
   drawn to avoid, so the permutation property is checked rather than assumed. */
const PALETTES = [
  [[0.9, 0.1, 0.1], [0.1, 0.2, 0.8], [0.2, 0.7, 0.2]],
  [[0.6, 0.4, 0.2], [0.7, 0.5, 0.3], [0.5, 0.3, 0.15]],   // three shades of rust
  [[0.5, 0.5, 0.5], [0.9, 0.9, 0.2], [0.1, 0.1, 0.1]]
];
const keyOf = (c) => c.map((v) => v.toFixed(6)).join(",");
for (const p of PALETTES) {
  const before = p.map(keyOf).sort();
  const after = orderByHue(p).map(keyOf).sort();
  if (before.join("|") !== after.join("|")) {
    bad(`orderByHue is not a permutation of ${JSON.stringify(p)}`);
  }
  if (orderByHue(p).length !== 3) bad(`orderByHue returned ${orderByHue(p).length} colours, needs 3`);
  const copy = JSON.parse(JSON.stringify(p));
  orderByHue(p);
  if (JSON.stringify(p) !== JSON.stringify(copy)) bad("orderByHue mutated its argument");
}
/* Warm edge to cool edge: a red/green/blue palette must come back red-first. */
const rgb = orderByHue([[0.1, 0.2, 0.8], [0.2, 0.7, 0.2], [0.9, 0.1, 0.1]]);
if (keyOf(rgb[0]) !== keyOf([0.9, 0.1, 0.1])) bad("orderByHue did not put the warmest colour first");
console.log("orderByHue: permutation and warm-first hold");

console.log(fail ? `\n${fail} FAILURE(S)` : "\nAll contrast checks passed.");
process.exit(fail ? 1 : 0);
