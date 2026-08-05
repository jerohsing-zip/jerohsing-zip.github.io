/* Proves the accessibility promise in DESIGN.md instead of asserting it.
   Sweeps every solar altitude the room can reach and checks the derived
   tokens, then checks the fixed paper surfaces.
   Run: node scripts/check-contrast.mjs */
import {
  tokensFor, contrast, relLum, washRoom, bandGrounds, orderByHue,
  stripI, stripPeak, LIGHT, BAND_ALPHA
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

/* ---- the record's lean must not be able to break the room ----
   The wash is no longer weather in the air; it is a flat, motionless lean of
   the walls toward the sleeve's hue, with the strip carrying the record's
   actual presence. So what has to hold here is narrower than it was: the lean
   may not drive the room out of range, and it may not bleach it.

   The band is derived from the unwashed room by design, and the lean lands
   behind the band where bandGrounds() has already bounded it by black and
   white — so text legibility is not at stake here, only the room's own health.

   These sleeves are the corners of the colour cube: no real cover pushes
   further. The achromatic corner is included because it must be a no-op, not
   because a cover like it would ever reach here — signals.js refuses those at
   chroma < 0.05. */
const SLEEVES = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [0, 1, 1], [1, 0, 1], [1, 1, 1], [.04, .04, .04]];

/* A complementary sleeve desaturates the wall, because that is what
   complementary light does — the rose room at civil twilight under a green
   cast goes nearly neutral, and it should. So the claim here is relative
   rather than absolute: the lean may take colour out of the room, it may not
   take most of it.

   SAT_FLOOR stays where it belongs, on the unwashed room. That guards the
   walls as a material, and a material's colour is not the light's to erase.
   This bound guards how far the light may reach instead.

   This is one-sided: it only catches a lean that reaches too far. A
   washRoom() that ignored the sleeve entirely and returned the room
   unchanged — or just dimmed it — would retain 1.0 and sail through. It is
   the reach proof directly below that catches that failure, by requiring the
   leaned room to differ from the unwashed one by at least LEAN_FLOOR. Only
   the two together pin the lean down, to roughly 0.046 ≤ WASH.lean ≤ 0.13.

   Worst observed retention at the shipped WASH.lean = 0.12 is 0.250 — a pure
   green sleeve against the rose room at civil twilight, exact complements,
   at a corner of the colour cube that no real cover reaches. The floor is
   set below that with margin, and the corners are deliberately a harder test
   than anything that can ship.

   This bound is NOT monotone in WASH.lean — worst retention runs 0.12 → pass
   (0.250), 0.14 → fail (0.113), 0.16 → fail (0.125), 0.20 → pass again
   (0.234), 0.30 → fail (0.153). So a larger lean passing this check later is
   not evidence it is safe; it can pass, fail, and pass again as the value
   climbs. Anyone hand-tuning WASH.lean needs both proofs green at the new
   value, not just this one, and should not trust a pass here in isolation. */
const RETENTION_FLOOR = 0.20;
let worstRet = Infinity, atRet = "";

for (const alt of ALTS) for (const cloud of CLOUDS) {
  const room = tokensFor(alt, cloud).room;
  const s0 = sat(room);
  for (const sleeve of SLEEVES) {
    const w = washRoom(room, sleeve, 1);
    for (const v of w) if (!isFinite(v) || v < 0) bad(`leaned room out of range at ${alt}°: ${w}`);
    if (s0 > 0) {
      const ret = sat(w) / s0;
      if (ret < worstRet) { worstRet = ret; atRet = `sleeve ${sleeve} at ${alt}° / cloud ${cloud}`; }
    }
  }
}
console.log(`lean saturation retention: worst ${worstRet.toFixed(3)} (${atRet}, floor ${RETENTION_FLOOR})`);
if (worstRet < RETENTION_FLOOR) bad(`the lean bleached the room: retention ${worstRet.toFixed(3)} at ${atRet}`);

/* The achromatic corner is a no-op by construction: a grey sleeve normalises
   to a multiplier of 1, so it cannot move the room. Asserted rather than
   asserted-in-a-comment — signals.js refuses these covers upstream, and a
   claim nothing checks is how that upstream guard quietly becomes load-
   bearing without anyone noticing. */
for (const alt of ALTS) for (const cloud of CLOUDS) {
  const room = tokensFor(alt, cloud).room;
  for (const grey of [[.5, .5, .5], [.04, .04, .04], [1, 1, 1]]) {
    const w = washRoom(room, grey, 1);
    for (let i = 0; i < 3; i++) {
      if (Math.abs(w[i] - room[i]) > 1e-9) {
        bad(`a grey sleeve moved the room at ${alt}° / cloud ${cloud}: ${room} -> ${w}`);
      }
    }
  }
}

/* The record is never entirely absent from the room. The strip comes and goes
   with the light, the weather and the scroll — so the lean is what has to be
   always-on, and "always" is checked at every hour under every sky.

   This is the honest successor to the deleted daylight-gain proofs. Those
   defended a mechanism; this defends the outcome that mechanism existed for.
   Measured as chromaticity — each channel over the room's own luminance — so
   it asks how much *colour* the record throws rather than how bright the room
   got. The achromatic corner is excluded: a grey sleeve normalises to a
   multiplier of 1 and is a no-op by construction, which is why signals.js
   refuses those covers upstream rather than sending them here. */
const chroma = (c) => { const l = Math.max(c[0] * .299 + c[1] * .587 + c[2] * .114, 1e-4); return c.map((v) => v / l); };
const reach = (alt, cloud, sleeve) => {
  const room = tokensFor(alt, cloud).room;
  const a = chroma(room), b = chroma(washRoom(room, sleeve, 1));
  return Math.max(...a.map((v, i) => Math.abs(v - b[i])));
};

const LEAN_FLOOR = 0.02;
let worstReach = Infinity, atReach = "";
for (const sleeve of SLEEVES.slice(0, 6)) {
  for (const alt of ALTS) for (const cloud of CLOUDS) {
    const r = reach(alt, cloud, sleeve);
    if (r < worstReach) { worstReach = r; atReach = `sleeve ${sleeve} at ${alt}° / cloud ${cloud}`; }
  }
}
console.log(`lean reach: worst ${worstReach.toFixed(3)} (${atReach}, floor ${LEAN_FLOOR})`);
if (worstReach < LEAN_FLOOR) bad(`the room stops knowing what is playing: reach ${worstReach.toFixed(3)} at ${atReach}`);

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

/* ---- the strip may not blow the wall out ----
   The strip is additive and its colour is normalised to unit *luminance*,
   which is not unit *channels*: a saturated red normalised that way reaches
   1/0.299 in red. STRIP.CH_MAX is the ceiling that keeps the worst case —
   a fully saturated sleeve colour at a caustic node, at full intensity —
   inside a bound that can be stated as a number instead of hoped for. */
const STRIP_CEILING = 0.65;
const peak = stripPeak();
console.log(`strip peak addition ${peak.toFixed(3)} (ceiling ${STRIP_CEILING})`);
if (peak > STRIP_CEILING) bad(`strip peak addition ${peak.toFixed(3)} exceeds ${STRIP_CEILING}`);
if (!(peak > 0)) bad("strip peak addition is not positive — the strip would never be visible");

/* The strip is an event, not a constant: it needs a source, direct light, and
   an uncovered room. Each of those must actually be able to switch it off. */
if (stripI(60, 0, 1) > 1e-6) bad("a fully covered room still draws the strip");
if (stripI(60, 1, 0) >= stripI(60, 0, 0)) bad("overcast does not dim the strip");
if (stripI(-40, 0, 0) > stripI(60, 0, 0)) bad("the strip is stronger at midnight than at high sun");
for (const alt of ALTS) for (const cloud of CLOUDS) {
  const v = stripI(alt, cloud, 0);
  if (!isFinite(v) || v < 0 || v > 1) bad(`stripI out of 0..1 at ${alt}° / cloud ${cloud}: ${v}`);
}
/* After dark the lamp takes over as the caster, so the strip never vanishes
   entirely while a record is on — it moves and weakens. */
if (!(stripI(-30, 0, 0) > 0)) bad("the lamp does not cast the strip after dark");
console.log(`strip intensity: ${stripI(60, 0, 0).toFixed(2)} high sun, ${stripI(-30, 0, 0).toFixed(2)} night, ${stripI(60, 1, 0).toFixed(2)} overcast noon`);

console.log(fail ? `\n${fail} FAILURE(S)` : "\nAll contrast checks passed.");
process.exit(fail ? 1 : 0);
