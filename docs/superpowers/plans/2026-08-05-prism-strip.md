# The Prism Strip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the volumetric album-colour wash with a still, narrow strip of split light cast by whichever source is lighting the room, plus a weak motionless hue lean in the walls.

**Architecture:** The light model in `light.js` stays the single source of truth — `room.js` interpolates its constants into GLSL at build time rather than carrying literals, and `scripts/check-contrast.mjs` replays the same maths to prove the render. This plan preserves that arrangement exactly: new constants land in `light.js` as a `STRIP` block, the shader reads them through the existing `f()` interpolation helper, and the sweep script imports them.

**Tech Stack:** Vanilla ES modules, no build step, no framework. WebGL1 fragment shader assembled as a JS string array. Node 20 for the sweep scripts.

## Global Constraints

- **No test framework exists at the repo root.** `scripts/check-contrast.mjs` is the test suite. Run it with `node scripts/check-contrast.mjs`; it exits non-zero on failure. There is no `npm test` at root — `scripts/package.json` exists only for the `build-live.mjs` PSN dependency.
- **The shader may not contain magic numbers that also exist in the model.** Every constant shared between `light.js` and `room.js` goes through `f()` interpolation. This rule is load-bearing: the comment at `room.js:23` records that the wash literals were written out once and drifted within a week, after which the sweep was proving a room the shader was not drawing.
- **ES5-flavoured syntax in browser files.** `app.js`, `room.js`, `light.js` and `signals.js` use `var`, `function`, no arrow functions, no `const`/`let`. Match it. The `scripts/*.mjs` files are modern Node and use `const`/arrow functions — match *that* in the sweep script.
- **WebGL1 / GLSL ES 1.00.** No `mix()` on bools, ternaries on vectors are fine, all loops need constant bounds.
- **The strip contains no `uTime` term.** This is the design's central property, not an optimisation. If a reviewer sees `uTime` inside the strip block, the task is rejected.
- **Colours in the strip come only from the sleeve.** No manufactured hues, no per-channel positional offsetting.

---

## File Structure

| file | responsibility after this work |
|---|---|
| `light.js` | pure light + colour model. Gains `STRIP`, `orderByHue()`, `stripI()`, `stripPeak()`. Loses `washGain()` and five `WASH` constants. |
| `room.js` | WebGL render. Wash block replaced by lean + strip. New uniforms `uLean`, `uWash3`, `uCover`; `uWashGain` removed. |
| `app.js` | wiring. Stops passing `washGain`, starts passing scroll cover and three palette colours. |
| `signals.js` | **unchanged.** Already returns three colours. |
| `scripts/check-contrast.mjs` | the proofs. Gain proofs deleted, four new claims added. |
| `DESIGN.md` | the wash section rewritten as the prism. |

## Task ordering rationale

Task 3 deletes `washGain()`, which `app.js:88` and `check-contrast.mjs:6` both import. Deleting it in isolation leaves the page broken and the sweep unrunnable, so all three files move in that one task. Tasks 1 and 2 are purely additive and land first so Task 3's rewrite has the functions it needs.

Task 4 leaves the render in a shippable state on its own: no haze, no strip. That is a real review gate — if the strip in Task 5 turns out wrong, Task 4 is still an improvement over what ships today.

---

### Task 1: Hue ordering

**Files:**
- Modify: `light.js` (append after `luma()`, around line 42)
- Test: `scripts/check-contrast.mjs`

**Interfaces:**
- Produces: `orderByHue(colors: number[][]) -> number[][]` — returns a new array of the same colour triples, sorted warm edge to cool edge. Does not mutate its argument.

- [ ] **Step 1: Write the failing test**

Append to `scripts/check-contrast.mjs`, just above the final `console.log(fail ? ...)` line:

```js
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
```

Add `orderByHue` to the import list at the top of `scripts/check-contrast.mjs` (line 5-8):

```js
import {
  tokensFor, contrast, relLum, washRoom, washGain, bandGrounds, orderByHue,
  LIGHT, BAND_ALPHA, WASH
} from "../light.js";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/check-contrast.mjs`
Expected: crashes with `SyntaxError: The requested module '../light.js' does not provide an export named 'orderByHue'`

- [ ] **Step 3: Write minimal implementation**

Append to `light.js`, immediately after the `luma()` export (line 42):

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/check-contrast.mjs`
Expected: PASS — `orderByHue: permutation and warm-first hold`, then `All contrast checks passed.`

- [ ] **Step 5: Commit**

```bash
git add light.js scripts/check-contrast.mjs
git commit -m "feat: order a sleeve's palette by hue for the strip"
```

---

### Task 2: The strip's constants and its bound

**Files:**
- Modify: `light.js` (append after the `WASH` block, around line 172)
- Test: `scripts/check-contrast.mjs`

**Interfaces:**
- Consumes: `windowI(alt)`, `tungstenI(alt)` — both already exported from `light.js`.
- Produces:
  - `STRIP` — object literal, keys `W, L, THROW, ANG, GAIN, LAMP_W, NODE_FLOOR, NODE_VAR, NODE_FREQ, CH_MAX`
  - `stripPeak() -> number` — worst-case additive contribution of the strip to one channel
  - `stripI(alt, cloud, cover) -> number` — the strip's intensity **excluding** the record's own `washI`, in 0..1

- [ ] **Step 1: Write the failing test**

Append to `scripts/check-contrast.mjs`, above the final `console.log`:

```js
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
```

Extend the import at the top of `scripts/check-contrast.mjs`:

```js
import {
  tokensFor, contrast, relLum, washRoom, washGain, bandGrounds, orderByHue,
  stripI, stripPeak, LIGHT, BAND_ALPHA, WASH, STRIP
} from "../light.js";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/check-contrast.mjs`
Expected: `SyntaxError: ... does not provide an export named 'stripI'`

- [ ] **Step 3: Write minimal implementation**

Append to `light.js` after the `WASH` block:

```js
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
   one thing landing as three, side by side — not a manufactured spectrum. */
export var STRIP = {
  W: 0.028,          // half-width, aspect-corrected units
  L: 0.30,           // half-length
  THROW: 0.26,       // how far below the caster the strip lands
  ANG: 0.62,         // radians of sweep either side of centre
  GAIN: 0.22,        // additive strength at full intensity
  LAMP_W: 0.55,      // the lamp's weight as a caster, against the sun's
  NODE_FLOOR: 0.72,  // caustic nodes: the strip is not evenly lit along its length
  NODE_VAR: 0.55,
  NODE_FREQ: 13.0,
  /* Unit luminance is not unit channels — a saturated red normalised to
     luma 1 reaches 3.34 in red, which would put the peak addition near 1.0
     and blow the wall out. The wash's own clamp exists for the same reason. */
  CH_MAX: 2.2
};

/* The worst the strip can add to one channel: a fully saturated sleeve colour
   at a caustic node, at full intensity. check-contrast.mjs holds this to a
   ceiling, which is what makes "the strip cannot break the room" a checked
   claim rather than an asserted one. */
export function stripPeak() {
  return STRIP.GAIN * (STRIP.NODE_FLOOR + STRIP.NODE_VAR) * STRIP.CH_MAX;
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/check-contrast.mjs`
Expected: PASS. `strip peak addition 0.617 (ceiling 0.65)` and a strip-intensity line.

If the peak exceeds the ceiling, **lower `STRIP.GAIN`, not the ceiling.** The ceiling is the claim; the gain is the tuning.

- [ ] **Step 5: Commit**

```bash
git add light.js scripts/check-contrast.mjs
git commit -m "feat: add the strip's constants and prove its bound"
```

---

### Task 3: Collapse the wash to a lean

This is the task that deletes machinery. `washGain()` is imported by both `app.js` and `check-contrast.mjs`, so all three files move together or the page is broken between commits.

**Files:**
- Modify: `light.js:157-198` (the `WASH` block, `washGain()`, `washRoom()`)
- Modify: `app.js:14-17` (import) and `app.js:88` (the `setLight` call)
- Modify: `scripts/check-contrast.mjs:91-154` (delete the gain proofs, add the lean proofs)

**Interfaces:**
- Produces: `washRoom(room, sleeve, washI) -> number[3]` — **signature changed**, was `(room, sleeve, washI, pool, gain)`. The `pool` and `gain` parameters are gone.
- Produces: `WASH = { temper: 0.72, lean: 0.12 }` — `poolMin`, `tint`, `add`, `dayGain`, `tintMax` deleted.
- Removes: `washGain()` entirely.

- [ ] **Step 1: Write the failing test**

In `scripts/check-contrast.mjs`, **delete lines 91–154** — everything from the `/* ---- the album wash must not be able to break the room ---- */` comment through the `if (worstLift < MARGIN) bad(...)` line. Those prove properties of the daylight-gain mechanism this task removes.

Replace that deleted block with:

```js
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

for (const alt of ALTS) for (const cloud of CLOUDS) {
  const t = tokensFor(alt, cloud);
  for (const sleeve of SLEEVES) {
    const w = washRoom(t.room, sleeve, 1);
    for (const v of w) if (!isFinite(v) || v < 0) bad(`leaned room out of range at ${alt}°: ${w}`);
    if (sat(w) < SAT_FLOOR * 0.6) bad(`the lean bleached the room to ${sat(w).toFixed(3)} at ${alt}° with sleeve ${sleeve}`);
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
```

Then remove `washGain` from the import list, leaving:

```js
import {
  tokensFor, contrast, relLum, washRoom, bandGrounds, orderByHue,
  stripI, stripPeak, LIGHT, BAND_ALPHA, WASH, STRIP
} from "../light.js";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/check-contrast.mjs`
Expected: FAIL. `washRoom` still takes five parameters, so calling it with three leaves `pool` and `gain` undefined and the arithmetic produces `NaN` — the range check reports `leaned room out of range`.

- [ ] **Step 3: Write minimal implementation**

In `light.js`, replace the `WASH` block (lines 157-172), `washGain()` (lines 174-183) and `washRoom()` (lines 185-198) with:

```js
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
  var wl = Math.max(luma(sleeve), 0.05);
  var k = clamp01(washI == null ? 1 : washI) * WASH.lean;
  var out = [];
  for (var i = 0; i < 3; i++) {
    var w = Math.max(0.38, Math.min(1.75, 1 + (sleeve[i] / wl - 1) * WASH.temper));
    out.push(room[i] * (1 - k) + room[i] * w * k);
  }
  return out;
}
```

In `app.js`, remove `washGain` from the import (lines 14-17):

```js
import {
  tokensFor, windowPos, windowI, tungstenI,
  TUNGSTEN, BAND_ALPHA, rgb255, rgba255
} from "./light.js";
```

and delete the `washGain` line from the `setLight` call, so `app.js:82-89` reads:

```js
      room.setLight({
        win: windowPos(alt, az, lat),
        winI: windowI(alt),
        light: t.light,
        room: t.room,
        warm: TUNGSTEN,
        warmI: tungstenI(alt)
      }, !lightInit);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/check-contrast.mjs`
Expected: PASS, including a `lean reach: worst ...` line above the floor.

Then confirm nothing still references the deleted names:

Run: `grep -rn "washGain\|poolMin\|dayGain\|tintMax\|WASH.tint\|WASH.add" --include=*.js --include=*.mjs . | grep -v node_modules | grep -v .claude/worktrees`
Expected: no output. `room.js` still references `WASH.tint` etc. at this point — **that is expected and Task 4 fixes it**; note the hits and move on. Any hit outside `room.js` is a miss to fix now.

- [ ] **Step 5: Commit**

```bash
git add light.js app.js scripts/check-contrast.mjs
git commit -m "refactor: collapse the album wash to a flat lean

The daylight-gain apparatus existed to keep a volumetric tint alive
against the sun. There is no longer a volumetric tint, so it goes too,
along with the proofs that defended it."
```

---

### Task 4: The lean in the shader

At the end of this task the render has no haze and no strip. That is deliberately a shippable state and a real review gate.

**Files:**
- Modify: `room.js` — the wash block in `FRAG` (lines 125-151), the uniform declarations (line 37-38), the `U` map (lines 194-200), the `cur` object (lines 221-225), `setLight()` (lines 228-237), `setWash()` (lines 243-249), the frame loop (lines 263-297), and the import (line 17)

**Interfaces:**
- Consumes: `WASH`, `orderByHue` from `light.js`
- Produces: `setWash(colors, amount)` — **behaviour changed.** Now accepts up to three colours; derives `uLean` from `colors[0]` (score order, the dominant colour) and `uWash`/`uWash2`/`uWash3` from `orderByHue(colors)`. Still accepts `null` to fade the record out.

- [ ] **Step 1: Update the import**

`room.js:17`:

```js
import { WASH, STRIP, orderByHue } from "./light.js";
```

(`STRIP` is unused until Task 5. Import it now so Task 5 touches only the shader string.)

- [ ] **Step 2: Replace the uniform declarations**

`room.js:37-38`, replace:

```js
  "uniform vec3 uWash; uniform vec3 uWash2; uniform float uWashI;",   // the record's colours
  "uniform float uWashGain;",        // what the sun makes the record pay
```

with:

```js
  "uniform vec3 uWash; uniform vec3 uWash2; uniform vec3 uWash3;",    // the sleeve, hue-ordered across the strip
  "uniform vec3 uLean; uniform float uWashI;",                        // the sleeve's dominant colour, and whether a record is on
  "uniform float uCover;",           // how much of the room the page has scrolled over
```

- [ ] **Step 3: Replace the wash block in FRAG with the lean**

`room.js:125-151`, replace the whole block from `// ---- the record's colour, drifting on the wind` through the `col += washCol * pool * ...` line with:

```js
  /* ---- the record, as a lean in the walls.
     Normalised to unit luminance before tinting. Multiplying the room by a raw
     sleeve colour just darkens it — a navy cover turned the room muddy instead
     of blue. Dividing out the colour's own brightness leaves hue and satura-
     tion, so the room shifts colour while holding its light.

     Flat and motionless on purpose. This is the record's standing presence,
     felt rather than seen; the strip below is what it actually looks like. */
  "  float ll = max(luma(uLean), 0.05);",
  "  vec3 lw = clamp(mix(vec3(1.0), uLean/ll, " + f(WASH.temper) + "), vec3(0.38), vec3(1.75));",
  "  col = mix(col, col*lw, uWashI * " + f(WASH.lean) + ");",
```

Note the `par` and `q`/`warp`/`field` locals defined in the deleted block are not used anywhere below it — verify with a search for `warp` and `field` in `FRAG` before deleting, and keep `par` (it is defined at line 52 and used by the window).

- [ ] **Step 4: Add the uniform locations**

`room.js:194-200`, in the `U` map: remove `washGain: u("uWashGain")`, add `wash3: u("uWash3")`, `lean: u("uLean")`, `cover: u("uCover")`.

- [ ] **Step 5: Update the eased state**

In `cur` (lines 221-225): remove `washGain: 1`, add `wash3: [0, 0, 0]`, `lean: [0, 0, 0]`, `cover: 0`.

In `setLight()` (lines 228-237): delete the `if (typeof s.washGain === "number") tgt.washGain = s.washGain;` line.

Replace `setWash()` (lines 243-249) with:

```js
  /* null → no usable colour in the sleeve; decay back to the room's own light.

     Two orderings, because they answer different questions. The lean wants the
     cover's *dominant* colour, which is the order albumPalette returns. The
     strip wants them laid warm edge to cool edge, which is orderByHue's. */
  function setWash(colors, amount) {
    if (!colors || !colors.length) { tgt.washI = 0; return; }
    var o = orderByHue(colors);
    tgt.lean = colors[0].slice();
    tgt.wash = o[0].slice();
    tgt.wash2 = (o[1] || o[0]).slice();
    tgt.wash3 = (o[2] || o[1] || o[0]).slice();
    tgt.washI = typeof amount === "number" ? amount : 1;
  }

  /* How much of the room the page has scrolled over. The strip fades out under
     the content bands rather than ghosting through them at BAND_ALPHA and
     being cut by a band edge — which is what made the old wash read as glass. */
  function setCover(v) { tgt.cover = v < 0 ? 0 : v > 1 ? 1 : v; }
```

Add `setCover: setCover` to the returned object (line 306).

- [ ] **Step 6: Update the frame loop**

In `frame()`: add `ease3(cur.wash3, tgt.wash3, 0.03);` and `ease3(cur.lean, tgt.lean, 0.03);` alongside the existing wash easing. Remove the `cur.washGain` easing line.

Cover tracks the scrollbar, so it eases faster than the sun does:

```js
    cur.cover = ease(cur.cover, tgt.cover, 0.15);
```

In the uniform writes: remove `gl.uniform1f(U.washGain, cur.washGain);`, add:

```js
    gl.uniform3fv(U.wash3, cur.wash3);
    gl.uniform3fv(U.lean, cur.lean);
    gl.uniform1f(U.cover, cur.cover);
```

- [ ] **Step 7: Verify the shader compiles and the haze is gone**

There is no automated test for GLSL. Serve and look:

```bash
python -m http.server 8000
```

Open `http://localhost:8000`, then check the console. Expected: **no** `room shader:` or `room link:` warning — `createRoom()` logs the info log and returns null on failure, and the page silently falls back to the CSS gradient, so a silent success and a silent failure look similar from the outside. Confirm the canvas is live by checking that `.room` carries the `has-gl` and `is-lit` classes.

Expected visually: the room is lit by window and lamp, with a faint even colour cast from the record. **No drifting blobs anywhere.** Compare against the screenshot that started this work.

- [ ] **Step 8: Commit**

```bash
git add room.js
git commit -m "feat: the record leans on the walls instead of weathering them"
```

---

### Task 5: The strip

**Files:**
- Modify: `room.js` — insert the strip block into `FRAG` after the lean
- Modify: `app.js` — wire scroll to `setCover()`

**Interfaces:**
- Consumes: `STRIP` from `light.js` (imported in Task 4), `setCover()` from `room.js` (added in Task 4), the `lp` lamp-position local already defined at `room.js:120`.

- [ ] **Step 1: Add the strip to FRAG**

In `room.js`, immediately after the lean block from Task 4 — and it **must** come after `lp` is defined at line 120, since the strip reuses it as the lamp anchor:

```js
  /* ---- and as a strip of split light.
     Something with a bevelled edge is sitting in the room's light. The record
     is what that light breaks into: the three colours across the strip's width
     are the sleeve's own, laid warm edge to cool edge by orderByHue(). What
     reads as refraction is separation, not a manufactured spectrum.

     There is no uTime term in here, and there must not be. A bright band on a
     wall is furniture; a moving field is weather, and the eye cannot stop
     reading weather. That is what the old wash got wrong. */
  "  float sun = uWinI * (1.0 - uCloud);",
  "  float lampw = uWarmI * " + f(STRIP.LAMP_W) + ";",
  "  float stripI = uWashI * max(sun, lampw) * (1.0 - uCover);",
  "  if (stripI > 0.002) {",
  /* Cast by whichever source is actually lighting the room, so the handoff
     from window to lamp happens on its own through dusk with nothing
     scheduling it. */
  "    float toLamp = lampw / (sun + lampw + 1e-4);",
  "    vec2 src = mix(uWin + par, lp, toLamp);",
  /* The cast angle rotates with the window's position, so the strip sweeps as
     the sun crosses — a second clock, as the window already is. */
  "    float ang = mix(" + f(-STRIP.ANG) + ", " + f(STRIP.ANG) + ", uWin.x);",
  "    vec2 dir = vec2(cos(ang), sin(ang));",
  "    vec2 nrm = vec2(-dir.y, dir.x);",
  "    vec2 sc0 = src - nrm * " + f(STRIP.THROW) + ";",
  "    vec2 sp = vec2((uv.x-sc0.x)*asp, uv.y-sc0.y);",
  "    float across = dot(sp, nrm), along = dot(sp, dir);",
  /* A flat-topped plateau, not a gaussian: a gaussian peaks at the centre,
     which would leave the two edge colours dim and defeat the separation the
     whole strip exists to show. */
  "    float plateau = 1.0 - smoothstep(" + f(STRIP.W * 0.55) + ", " + f(STRIP.W) + ", abs(across));",
  "    float taper = 1.0 - smoothstep(" + f(STRIP.L * 0.45) + ", " + f(STRIP.L) + ", abs(along));",
  /* Caustic nodes — a real strip is not evenly lit along its length. Static:
     the noise is read at a fixed position, never advanced. */
  "    float nodes = " + f(STRIP.NODE_FLOOR) + " + " + f(STRIP.NODE_VAR) + "*noise(vec2(along*" + f(STRIP.NODE_FREQ) + ", 3.7));",
  /* The spectral axis is the strip's width, not its length. Blends between
     the stops are mixes of two cover colours, so nothing outside the sleeve's
     own palette is ever drawn. */
  "    float s = clamp(across/" + f(STRIP.W) + "*0.5 + 0.5, 0.0, 1.0);",
  "    vec3 sc = s < 0.5 ? mix(uWash, uWash2, s*2.0) : mix(uWash2, uWash3, (s-0.5)*2.0);",
  /* Unit luminance so a dark sleeve colour still throws light, then a per-
     channel ceiling because unit luminance is not unit channels — a saturated
     red normalised this way reaches 3.34 in red and would blow the wall out. */
  "    sc = min(sc / max(luma(sc), 0.05), vec3(" + f(STRIP.CH_MAX) + "));",
  "    col += sc * plateau * taper * nodes * stripI * " + f(STRIP.GAIN) + ";",
  "  }",
```

- [ ] **Step 2: Wire scroll to the cover uniform**

In `app.js`, after the room is created. The first `.band` is where the page starts covering the room, so its offset is the denominator:

```js
  /* The strip lives in the open room above the fold. Past that the content
     bands are over it, and a bright strip behind an 84%-opaque band is a ghost
     with a hard edge — the artifact this whole change set out to remove. */
  function coverNow() {
    var band = document.querySelector(".band");
    if (!band) return 0;
    var top = band.getBoundingClientRect().top + window.scrollY;
    return Math.max(0, Math.min(1, window.scrollY / Math.max(top, 1)));
  }
  window.addEventListener("scroll", function () {
    if (room) room.setCover(coverNow());
  }, { passive: true });
```

Call `room.setCover(coverNow())` once at the point where `room` is first assigned, so a page loaded mid-scroll (a refresh, or a `#segments` deep link) starts correct rather than fading in.

- [ ] **Step 3: Verify visually**

Run: `python -m http.server 8000`, open `http://localhost:8000`.

Check the console for `room shader:` — a GLSL error here is likely, since this is the largest shader change. WebGL1 has no `mix()` overload for the bool case, but the ternary on `vec3` used above is legal.

Then confirm, in order:

1. A narrow band of the sleeve's colours is visible on the wall, still.
2. Nothing about it moves. Watch for 30 seconds. Any drift means a `uTime` crept in.
3. Scrolling down fades it out before the first band reaches it.
4. Its three colours are recognisably from the album art currently in the plate.

- [ ] **Step 4: Tune against the live render**

`GAIN`, `W` and `THROW` are the three constants set from reasoning rather than from looking. Adjust them in `light.js` — never in the shader — and reload.

- If the strip is invisible: `GAIN` up, or check `stripI` is non-zero at the current sun altitude.
- If it reads as a glowing bar rather than cast light: `GAIN` down.
- If the three colours are not separable: `W` up.
- If it sits behind the plate where nobody sees it: `THROW` up, or widen `ANG`.

After any `GAIN` or `CH_MAX` change, re-run `node scripts/check-contrast.mjs` — the peak bound from Task 2 is what stops tuning from blowing the wall out.

- [ ] **Step 5: Commit**

```bash
git add room.js app.js light.js
git commit -m "feat: the record's colour arrives as a strip of split light"
```

---

### Task 6: The written room

`DESIGN.md` describes the wash as it was. Left alone it becomes the most misleading file in the repo — it documents a mechanism that no longer exists, in a project whose whole discipline is that the writing and the render agree.

**Files:**
- Modify: `DESIGN.md` — the wash section
- Modify: `room.js:1-16` — the header comment lists the three lights

- [ ] **Step 1: Read the current wash section**

Run: `grep -n "wash\|turntable\|sleeve" DESIGN.md`

- [ ] **Step 2: Rewrite it**

Cover, in the file's existing voice: that the record's colour arrives as a strip of split light rather than as weather; that the strip is cast by the window or the lamp and sweeps with the sun; that it is still, and why stillness is the point; that its colours are only ever the sleeve's; that cloud kills it because a caustic needs direct light; that it fades under the bands; and that the lean is what remains when it is absent.

Say explicitly that the daylight-gain apparatus was removed and why — it solved a real problem for a mechanism that no longer exists. The file's habit is to record what was tried and rejected, and that history is worth keeping.

- [ ] **Step 3: Update the shader header**

`room.js:4-8` says the room is lit by three real things and describes the third as "the turntable wash — colour thrown by the record now playing." Update it to name the prism, and keep the "nothing here is drawn as an object" paragraph — it now applies to the prism too, which is never depicted, only its light.

- [ ] **Step 4: Full verification**

```bash
node scripts/check-contrast.mjs && node scripts/check-solar.mjs
```

Expected: both pass. `check-solar.mjs` is untouched by this work and should be unchanged — run it to confirm nothing in `light.js` broke it.

```bash
grep -rn "washGain\|poolMin\|dayGain\|tintMax" --include=*.js --include=*.mjs --include=*.md . | grep -v node_modules | grep -v .claude/worktrees | grep -v docs/superpowers
```

Expected: no output outside the spec and plan documents.

- [ ] **Step 5: Commit**

```bash
git add DESIGN.md room.js
git commit -m "docs: the prism replaces the turntable wash"
```

---

## Self-review notes

Checked against the spec:

- Spec's four proofs map to: claim 4 → Task 1, claim 2 → Task 2, claims 1 and 3 → Task 3.
- Spec's `CH_MAX` addition is in Task 2's constants and Task 5's shader.
- Spec's `orderByHue` in `light.js` "because the sweep script needs to import it" — Task 1 does exactly that.
- `signals.js` correctly untouched in every task.
- `washRoom`'s signature change is stated in Task 3's Interfaces block, since Task 3's implementer is the only one who sees both the old and new call sites.

Two things a reviewer should push on:

1. **`stripI()` in `light.js` is never called by `app.js`** — the shader computes the same thing from uniforms it already has, and `stripI()` exists so `check-contrast.mjs` can sweep it. That is a deliberate duplication of the kind `room.js:23` warns about, and it is the same bargain `washRoom()` already makes: the model and the GLSL mirror each other, and the sweep is what catches drift. If the two disagree, the sweep is right and the shader is wrong.
2. **`STRIP.THROW`, `W` and `GAIN` are guesses.** Task 5 Step 4 exists because they cannot be set from reasoning. Expect that step to take longer than the rest of Task 5.
