# The prism — album colour as a refracted strip

**Date:** 2026-08-05
**Status:** approved, ready for planning

## The problem

The record's colour currently reaches the room as a volumetric wash: a viewport-scale
`fbm` field, drifting on the wind, multiplying the walls toward the sleeve's hue.
Three properties of it compound into a render that reads as distracting haze rather
than as a lit room.

1. **The noise is huge and it moves.** `fbm(q*0.90)` in `room.js` produces pools
   nearly as large as the viewport, drifting on `uWind`. Large, slow, moving fields
   are exactly what peripheral vision is built to track.
2. **The tint saturates in daylight.** `washGain` reaches `WASH.dayGain` (1.85), and
   `pool * washI * gain * WASH.tint` clips at `WASH.tintMax` across whole regions.
   Where it clips the wall does not get *tinted* by the sleeve — it *becomes* the
   sleeve.
3. **The bands are translucent over all of it.** At `BAND_ALPHA` 0.84 the moving
   field reads through the reading surface, and the band and plate silhouettes cut
   hard edges across it.

The daylight-gain apparatus is not a bug — it correctly solved the problem it was
given, which was keeping a volumetric effect alive against the sun. This design
removes the volumetric effect, so that apparatus goes with it.

## The idea

Album colour stops being a property of the air and becomes a single lit surface: a
narrow strip of split light thrown on the wall, as from a bevelled edge somewhere in
the room's light.

The record is what the light breaks into. The colours in the strip come **only** from
the sleeve — no manufactured spectrum. What reads as refraction is *separation*: light
that arrived as one thing landing as three, side by side.

This is consistent with the room's standing rule that nothing is drawn as a picture of
itself. The prism is never depicted; only the light it throws is.

## Architecture

Four contributions to the room, replacing three:

| | before | after |
|---|---|---|
| window | unchanged | unchanged |
| lamp | unchanged | unchanged |
| album | volumetric `fbm` wash, gained against the sun | **the strip** (an event) + **the lean** (a constant) |

**The strip** is the record's presence when there is direct light to refract.
**The lean** is a weak, motionless hue shift of the walls, so the room still knows
what is playing when the strip is absent — off-frame, clouded over, or scrolled past.

### Where the strip comes from

The strip is cast by whichever source is currently lighting the room. Weights, all
from uniforms that already exist and are already eased:

```
sun   = uWinI * (1.0 - uCloud)
lampw = uWarmI * LAMP_W            // the lamp is a nearer, weaker source
dom   = max(sun, lampw)
toLamp = lampw / (sun + lampw + 1e-4)
```

The anchor crossfades between the window centre and the lamp:

```
src = mix(uWin + par, LAMP_POS, toLamp)
```

The handoff therefore happens on its own through dusk, with no scheduling. `LAMP_POS`
is the existing `vec2(0.74, 0.17)`.

### Geometry

The cast angle rotates with the window's horizontal position, so the strip sweeps
across the wall as the sun crosses the sky — a second clock, as the window already is.

```
ang = mix(-ANG, +ANG, uWin.x)
dir = vec2(cos(ang), sin(ang))
nrm = vec2(-dir.y, dir.x)
C   = src - nrm * THROW              // the strip lands below the source
p   = vec2((uv.x - C.x) * asp, uv.y - C.y)
across = dot(p, nrm)
along  = dot(p, dir)
```

Cross-section is a **flat-topped plateau with feathered edges**, not a gaussian — a
gaussian peaks at the centre, which would leave the two edge colours dim and defeat
the point of separating them:

```
band  = 1.0 - smoothstep(W * 0.55, W, abs(across))
taper = 1.0 - smoothstep(L * 0.45, L, abs(along))
```

Length-wise brightness varies through a **static** hash — caustic nodes. There is no
`uTime` term anywhere in the strip. This is the single most important property of the
design: the strip is still. A bright band on a wall is furniture; a moving field is
weather, and weather is what the eye tracks.

```
nodes = NODE_FLOOR + NODE_VAR * noise(vec2(along * NODE_FREQ, 3.7))
```

### Colour

The spectral axis is the strip's **width**, not its length. Across the narrow
dimension the three palette colours appear in sequence with soft blending; along its
length the colour does not change at all.

```
s = clamp(across / W * 0.5 + 0.5, 0.0, 1.0)
c = s < 0.5 ? mix(uWash, uWash2, s * 2.0)
            : mix(uWash2, uWash3, (s - 0.5) * 2.0)
c = min(c / max(luma(c), 0.05), vec3(CH_MAX))
```

Blended boundaries are mixes of two cover colours, so nothing outside the sleeve's own
palette is ever drawn.

Normalising to unit luminance mirrors the existing `wl` handling and exists for the
same reason: a dark sleeve colour should still throw light rather than throwing
nothing.

The per-channel ceiling is not decoration. Unit *luminance* does not mean unit
*channels*: a saturated red normalised this way reaches 1/0.299 ≈ 3.34 in red, which
would put the strip's peak addition near 1.0 and blow the wall out — the same failure
the wash's own `clamp(..., 0.38, 1.75)` exists to prevent. `CH_MAX` is what makes the
bound in *Contrast and proofs* below a real number.

**Ordering.** The three colours are sorted by **hue angle** before being assigned
across the width, warm edge to cool edge. Real dispersion is ordered by wavelength;
this borrows that logic without borrowing colours the record does not have. A sleeve
that is three shades of rust orders sensibly and reads as three shades of rust, which
is the correct answer for that record.

`albumPalette` in `signals.js` already returns three colours sorted by score. That
ordering is still needed — the lean uses the *dominant* colour, `colors[0]` — so hue
ordering is applied separately, for the strip only.

### Intensity

```
stripI = uWashI * dom * (1.0 - uCover)
col   += c * band * taper * nodes * stripI * GAIN
```

Four conditions, each a real one: a record must be playing, there must be a source,
that source must not be diffused by cloud (folded into `sun`), and the room must
actually be visible.

`uCover` is a new uniform written from scroll position — `clamp(scrollY / heroHeight)`.
The strip fades as the content bands rise over it, so it never ghosts through the
reading column and is never cut by a band edge. That is the second half of the
original complaint, addressed directly.

Overcast killing the strip is physically honest: no direct sun means no sharp shadows
and no caustic. It also gives the room another real state.

### The lean

Everything else the wash used to do collapses to one constant:

```
ll = max(luma(uLean), 0.05)
w  = clamp(mix(vec3(1.0), uLean / ll, WASH.temper), vec3(0.38), vec3(1.75))
col = mix(col, col * w, uWashI * WASH.lean)
```

No `fbm` pool, no daylight gain, no additive glow, no `tintMax` clamp. `WASH.temper`
(0.72) survives unchanged; `WASH.lean` is new at ~0.12.

`WASH.poolMin`, `WASH.tint`, `WASH.add`, `WASH.dayGain` and `WASH.tintMax` are deleted,
along with `washGain()`.

## Constants

All live in `light.js` as a `STRIP` block so the shader keeps reading the model rather
than carrying literals — the same discipline `WASH` already enforces, and for the same
reason recorded in `room.js`: the wash literals were written out once and drifted
within a week.

| name | value | what it is |
|---|---|---|
| `W` | 0.028 | half-width of the strip, aspect-corrected units |
| `L` | 0.30 | half-length |
| `THROW` | 0.26 | how far below the source the strip lands |
| `ANG` | 0.62 | radians of sweep either side of centre |
| `GAIN` | 0.22 | additive strength at full intensity |
| `LAMP_W` | 0.55 | the lamp's weight as a caster, against the sun's |
| `NODE_FLOOR` / `NODE_VAR` | 0.72 / 0.55 | caustic node brightness range |
| `NODE_FREQ` | 13.0 | node spacing along the length |
| `CH_MAX` | 2.2 | per-channel ceiling after unit-luminance normalising |

These are starting values, expected to be tuned against the live render. `GAIN`,
`W` and `THROW` are the three that will actually need eyes on them.

## Data flow

```
albumPalette(art)  →  [c0, c1, c2]  (score order)
        │
        ├─ colors[0] ─────────────────────────────→ uLean
        └─ orderByHue(colors) ─→ [h0, h1, h2] ────→ uWash, uWash2, uWash3

scroll ─→ clamp(scrollY / heroHeight) ────────────→ uCover
```

## Files

| file | change |
|---|---|
| `light.js` | add `STRIP` block, `orderByHue()`, `stripI()`; simplify `washRoom()` to the lean; delete `washGain()` and the five dead `WASH` constants |
| `room.js` | replace the wash block in `FRAG`; add `uWash3`, `uLean`, `uCover`; drop `uWashGain`; extend `setWash()` to take three colours and derive both orderings |
| `app.js` | pass all three palette colours; write `uCover` from scroll; drop the `washGain` import and call |
| `signals.js` | unchanged — already returns three colours |
| `scripts/check-contrast.mjs` | replace the gain proofs (see below) |
| `DESIGN.md` | rewrite the wash section as the prism |

`orderByHue()` goes in `light.js` rather than `app.js` because it is pure model and the
sweep script needs to import it.

## Contrast and proofs

**Text legibility holds without new maths.** `bandGrounds()` already checks text
against the band composited over **white**, which bounds any additive light the shader
can put behind a band. The strip also fades to nothing under the bands via `uCover`,
so it is bounded twice. No change to `tokensFor`, `bandGrounds`, `legibleOn` or
`BAND_ALPHA`.

**What changes in `check-contrast.mjs`.** Lines 91–154 exist to prove properties of the
daylight-gain mechanism — that compensation never goes backwards, and that the sleeve
throws materially more colour at high sun. Both claims are about a mechanism this
design deletes, so both tests go. The room-saturation sweep, the text sweep and the
paper-surface checks are untouched.

Replacing them, four claims that are true of the new design:

1. **The lean cannot drive the room out of range.** Same shape as the existing check,
   against the simplified `washRoom(room, sleeve, washI)`, over the same `SLEEVES`
   corners of the colour cube. Finite, non-negative, not bleached to grey or white.
2. **The strip's peak addition is bounded.** `stripPeak()` in `light.js` returns
   `GAIN * (NODE_FLOOR + NODE_VAR) * CH_MAX` — the worst case being a fully saturated
   sleeve colour at a caustic node, at full intensity. Assert it stays under a stated
   ceiling (≈0.65 at the values above). This is what makes the "bounded twice" claim
   checkable rather than asserted.
3. **The record is never entirely absent from the room.** For every altitude and cloud
   fraction, the lean's chromaticity reach against the unwashed room is non-zero — for
   any sleeve `albumPalette` can actually return. Genuinely achromatic covers are
   already refused upstream at `chroma < 0.05` (`signals.js:207`), and a grey sleeve
   normalises to a multiplier of 1 and is a no-op by construction, so the sweep uses
   the chromatic `SLEEVES` corners only.

   This is the honest successor to the deleted "the sun out-votes the record" claim:
   the old test defended a mechanism, this one defends the outcome the mechanism
   existed for.
4. **`orderByHue()` is a permutation.** It returns the same three colours it was given,
   reordered — never dropping, duplicating or altering one.

`stripI()` and `uCover` are pure functions of altitude, cloud and scroll, so 2 and 3
sweep the same `ALTS × CLOUDS` grid the rest of the script already builds.

## Out of scope

- Any change to the window, the lamp, rain, fog or haze.
- Any change to the light model's `LIGHT` table or the token derivation.
- Multiple strips, or the strip breaking across geometry — the shader has no geometry
  and is not getting any.
- Changing `BAND_ALPHA` or the band's translucency. The strip fading under the bands
  addresses the visible seam without touching the surface itself.
