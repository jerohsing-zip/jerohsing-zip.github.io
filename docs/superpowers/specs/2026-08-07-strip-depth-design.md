# The strip's depth, and its survival under cloud

**Date:** 2026-08-07
**Status:** approved, implemented

Two changes to the prism strip, unrelated in intent but coupled in the geometry,
which is why they ship together.

## 1. Parallax

`par` is `(uMouse-0.5)*0.05`, so ±0.025 at the extremes. The window moves by
`par` at 1x; the strip moves by `par * (PAR_X, PAR_Y)`. What the eye reads as
parallax is neither of those — it is the **difference**:

| | x | y |
|---|---|---|
| before (3.2, 1.0) | ±0.055 | **±0.000** |
| after (5.4, 1.8) | ±0.110 | ±0.020 |

`PAR_Y: 1.0` was the window's own rate, so the strip and the window rose and
fell together and never separated in depth at all.

The old comment said a gain in y "would just bob it". That was true as written:
at y1.0 every bit of vertical motion was shared with the window, so it *was* the
room bobbing. Held above the window's rate it is not bobbing, it is a second
plane. The comment is rewritten rather than left to contradict the constant.

## 2. Overcast

```glsl
float sun = uWinI * (1.0 - uCloud);   // before
float sun = uWinI * mix(1.0, STRIP.OVERCAST, uCloud);   // after
```

At overcast noon the old term was exactly zero — the sun contribution gone and
`tungstenI(60)` not yet risen — so `stripI` was 0 and the strip did not dim, it
disappeared. The record left the room entirely on the greyest days of the year.
`check-contrast.mjs` printed this as `0.00 overcast noon` without anything
failing, because the only assertion is that overcast be *dimmer* than clear.

`STRIP.OVERCAST = 0.35` is what survives full cloud. Diffuse skylight still
reaches the prism; what it lacks is a beam, so the throw falls hard and then
holds instead of falling to nothing. 0.35 sits below the lamp's night-time 0.55,
which keeps the sun and the lamp distinguishable as casters.

| sky | stripI at noon, before | after |
|---|---|---|
| clear | 1.00 | 1.00 |
| half cloud | 0.50 | 0.68 |
| overcast | **0.00** | **0.35** |

**Both consumers read the one constant.** The shader computes this, and
`stripI()` in `light.js` models it for the sweep. They are required to agree —
`STRIP.THROW`'s comment records the time they did not, when the sweep "reported
the lamp casting happily after dark while the shader drew nothing". A single
`STRIP.OVERCAST` makes divergence impossible rather than merely unlikely.

## Why they ship together

`sc0.x` is clamped to `[CLEAR, CLEAR_R]` and the pointer term is added
**after**, deliberately — folded in before, the clamp flattened the sideways
slide for the hours it was active. That ordering means anything `PAR_X` can add
lands on top of `CLEAR_R`. Raising `PAR_X` to 5.4 raises the post-clamp
excursion from ±0.08 to ±0.135.

Measured at the far corner (window x 0.96, sun as caster, `W` 0.072):

| | centre | visible |
|---|---|---|
| before (PAR_X 3.2, CLEAR_R 0.88) | 0.960 | 59% |
| PAR_X 5.4, CLEAR_R left at 0.88 | 1.015 | **47%** |
| PAR_X 5.4, CLEAR_R 0.82 | 0.955 | 60% |

So `CLEAR_R` moves to **0.82**, holding the visible fraction where it was.
Shipping the parallax change alone would have given back most of what `CLEAR_R`
was added to fix, silently, in a corner case only reachable with the pointer
pushed to one edge on a late western sun.

The cost is that the clamp engages from about window x 0.72 rather than 0.76 —
a slightly wider band of the afternoon has the strip placed rather than thrown.
That is the same trade `CLEAR` already makes every morning.

## Verified

- `check-contrast.mjs` passes and now reports `1.00 high sun, 0.55 night, 0.35
  overcast noon`.
- The generated GLSL was assembled outside the browser and inspected: balanced,
  every identifier declared before use, and emitting
  `mix(1.0, 0.35000, uCloud)`, `clamp(sc0.x, 0.52000, 0.82000)` and
  `par * vec2(5.40000, 1.80000)`.
- The corner geometry above was computed against the real constants, including
  the negative case (`CLEAR_R` left alone → 47%).

## Not verified

The browser extension was unavailable, so this has **not been looked at**. The
maths and structure hold; how it *reads* has not been judged. Two numbers are
taste rather than correctness and are the ones to move:

- `STRIP.OVERCAST` — whether 0.35 is genuinely "visible" against an overcast
  room, or wants to be nearer 0.45. Raising it past ~0.55 starts erasing the
  distinction between the sun and the lamp as casters.
- `STRIP.PAR_X` — whether ±0.110 of differential is "more pronounced" enough.
  If it goes higher, `CLEAR_R` must come down with it; the relationship is in
  the table above.
