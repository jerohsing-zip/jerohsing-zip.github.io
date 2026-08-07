# A clear sky should read clear

**Date:** 2026-08-07
**Status:** approved, implemented

## The problem

The room is soft in every weather. It should be soft when the sky is overcast
and defined when it is clear, and it never gets the second one.

The cause is that all of the room's softening runs off `uHaze`, and `uHaze`
comes from relative humidity alone:

```js
haziness = clamp01((relative_humidity_2m - 60) / 38)
```

The site broadcasts from Hsinchu, which is subtropical and sits at 75–90%
humidity year round. So the term is near-permanently pinned high regardless of
what the sky is doing:

| humidity | `uHaze` |
|---|---|
| 75% | 0.39 |
| 85% | 0.66 |
| 90% | 0.79 |
| 95% | 0.92 |

At a typical 88% it is 0.74 **under a cloudless sky**. The room is therefore
never once crisp, in any weather, at any hour.

It spends that value in two places:

- `room.js:94` — `spill = mix(spill, pow(spill, 0.68), uHaze)`. At 0.74 the wash
  one screen-height from the window rises from 0.157 to ~0.24, roughly 50% more
  light on the far wall.
- `room.js:126` — `col += lightCol * lightI * uHaze * 0.05`, a flat additive lift
  across the whole viewport. A literal fog layer, at 3.7% on a clear day.

Meanwhile **cloud drives no geometry at all**. `cloudedRoom()` gives it colour
and intensity; nothing gives it shape. That is backwards physically: direct sun
through glass throws a patch with an edge, and overcast — undirectional by
definition, as `OVERCAST` in `light.js` already says — throws none.

## The idea

Make definition a property of the sky rather than of the air. One term:

```glsl
float soften = max(uCloud, uHaze*0.35);
```

Cloud dominates. Humidity stays in at about a third weight rather than being
dropped, for two reasons: it is a real scatterer, so a muggy clear day should
still read softer than a dry one; and DESIGN.md promises every field of the
Open-Meteo call renders something, which gating humidity entirely on cloud
would break.

What changes for Hsinchu at 88% humidity:

| sky | before | after |
|---|---|---|
| clear (cloud 0.05) | 0.74 | **0.26** |
| partly cloudy (0.45) | 0.74 | 0.45 |
| overcast (0.92) | 0.74 | **0.92** |

Overcast comes out slightly foggier than before, which is the intended
direction.

## The three applications

**The pane edge** — `room.js:89`. Both axes interpolate between a tight
clear-sky falloff and the current overcast one:

```glsl
float loX = mix(0.15, 0.11, soften), hiX = mix(0.26, 0.33, soften);
float loY = mix(0.20, 0.14, soften), hiY = mix(0.32, 0.38, soften);
```

The transition band halves when clear — 0.22 → 0.11 in x, 0.24 → 0.12 in y —
and each band keeps its midpoint, so the window gains definition *in place*
rather than shrinking.

`smoothstep` requires `edge0 < edge1`, and it holds at both extremes: clear is
0.15 against 0.252–0.268 after `breath`, overcast 0.11 against 0.320–0.340.

**The spill** — `room.js:94`. `soften` replaces `uHaze`. A clear Hsinchu day
goes from roughly +50% far-wall wash to +20%.

**The veil** — `room.js:126`. `soften` replaces `uHaze`. Room-wide fog falls
from 3.7% to 1.3% when clear and rises to 4.6% when overcast.

All three are linear interpolations of the same term, so the room drifts with
the sky instead of switching at a threshold.

## Out of scope

`cloudedRoom()` and the `OVERCAST` constants are untouched. Cloud's effect on
the room's *colour* is already right and is the thing `check-contrast.mjs`
proves. This adds a geometric consequence beside it, and does not disturb it.

`haziness()` in `app.js` is also untouched — humidity still maps to `uHaze` the
same way. Only what the shader does with it changes.

## Risk

DESIGN.md refuses "a picture of a window", and a hard-edged rectangle is what
that refusal means. At a 0.11 band on a ~0.43-wide patch, a quarter of the patch
is still transition — an edge you can see but not trace — and the render bears
that out. If it ever starts reading as a drawn shape, raise the clear-sky `lo`
values and never the `hi` ones; lowering `hi` would shrink the window instead of
softening it.

## Verified

The generated GLSL was assembled outside the browser and checked for balance and
declaration order, because a shader that fails to compile falls back to the CSS
gradient silently.

Rendered at a pinned midday sun: at `soften` 0.26 the window has a defined but
still rounded edge and the wall falls off cleanly; at 0.92 it is diffuse, flat
and grey, with light carrying much further. `check-contrast.mjs` passes.

The contrast sweep is unaffected by design — it reads the modelled ambient,
which excludes the spill — and this change errs safe, since reducing spill on
clear days moves the real composite closer to the value already proven rather
than further from it.
