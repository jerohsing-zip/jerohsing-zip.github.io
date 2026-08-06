# Keeping the prism strip on screen

**Date:** 2026-08-06
**Status:** approved, implemented

## The problem

On a late western sun the record's strip leaves the viewport entirely. Nothing
on screen then says a record is playing except the lean, which is exactly the
state the strip was built to replace.

Two things compound. The window itself moves right — `windowPos()` clamps
`uv.x` at 0.96. And the cast angle `mix(-ANG, ANG, uWin.x)` rotates with it, so
`nrm.x` grows at the same time, and the throw along `nrm` pushes the strip
further right still.

Measured across window positions, with the sun as caster:

| window x | strip centre | visible span | |
|---|---|---|---|
| 0.04–0.63 | 0.52 | 0.33 → 0.71 | pinned by `CLEAR` |
| 0.70 | 0.803 | 0.62 → 0.99 | fine |
| 0.80 | 0.953 | 0.76 → 1.14 | clipping |
| 0.96 | 1.187 | 0.99 → 1.38 | effectively gone |

The right edge first clips at window x ≈ 0.71. By 0.96 only the outermost 0.6%
of the viewport still contains any of the strip — a hairline of halo.

The cause is an asymmetry in one line. `room.js` clamped `sc0.x` to a *minimum*
only:

```glsl
sc0.x = max(sc0.x, STRIP.CLEAR);
```

`STRIP.CLEAR` exists to hold the strip clear of the plate through the morning,
and it happens to also guarantee the left side can never run off. There was no
matching bound on the right.

Two facts narrow the scope. The left cannot fail, because `CLEAR` already pins
it. And **night cannot fail**: once the lamp is the caster, `toLamp` flips the
throw's sign and the centre tops out at 0.733 on its own. This is a daylight-only
fault.

## The fix

Mirror the existing bound:

```glsl
sc0.x = clamp(sc0.x, STRIP.CLEAR, STRIP.CLEAR_R);
```

with `STRIP.CLEAR_R = 0.88` added beside `CLEAR` in `light.js`.

`min()` against `max()`, so like `CLEAR` it engages gradually and nothing jumps
when it takes hold — from about window x 0.78.

## Why 0.88 and not tighter

0.88 keeps roughly 80% of the strip in frame at the extreme (span 0.687 → 1.073)
and lets the remainder run off the right edge, which is what light does at a
frame boundary. Pinning the *whole* strip inside would have required a centre
around 0.80 and frozen the strip's sweep across a much wider band of the
afternoon — the same "placed rather than thrown" cost `CLEAR` already pays each
morning, paid twice.

The strip keeps its angle, its length and its rise throughout; only its
horizontal footing is held.

## Verified

With a sleeve loaded and the window at 0.96, the strip renders as a diagonal
band of split light spanning uv.x 0.78 → 0.99, peak chroma 101 against a
neutral floor of 17.

As a control, `CLEAR_R` was temporarily raised to 9.0 to disable the bound: the
strip disappears from the frame and peak chroma falls to 62 — and that residual
is the window's own warm edge, not the strip. The per-column chroma metric is
too naive to distinguish those two on its own, so the screenshots are the
decisive evidence and the chroma delta is corroboration.

`check-contrast.mjs` passes. It models strip *intensity* and not geometry, so it
neither caught this nor could have.
