# Rain falls — correcting the direction, speed and grain of `uWet`

**Date:** 2026-08-06
**Status:** approved, ready for implementation

## The problem

Rain reads as fog rising off the floor rather than as water crossing the window.
Three properties of the `uWet` field compound into that read, and the first of them
contradicts the design doc outright.

1. **It rises.** Both wet layers subtract time from the sampled `y`, which holds a
   feature's noise value at *increasing* screen `y` — so the field climbs. In
   `room.js:120` the in-room field is `dp.y*1.15 - uTime*0.09`; in `room.js:133` the
   glass streaks carry `vec2(uWind.x*2.2, -1.0)*uTime*1.7`. DESIGN.md:74 specifies
   "fog and the **falling** streaks stay on the window plane," so the streak
   direction is a straight defect against stated intent, not a matter of taste.

2. **It is slow.** The in-room field drifts at `0.09/1.15 = 0.078` screen-heights per
   second — 12.8 seconds to cross the room. Nothing about that cadence is water.

3. **Its grain runs the wrong way.** After the `*3.6`, the lowest octave — which is
   the dominant visual, at `a=0.5` in a five-octave `fbm` — has cells 2.78x taller
   than wide (`x: 3.2*3.6 = 11.52` vs `y: 1.15*3.6 = 4.14` cycles per unit). A
   vertically-elongated cell drifting upward is the textbook construction of a
   plume. This is the property that most makes it read as fog.

The amplitudes are not implicated. `thrown *= 1.0 + run*0.32` and `col *= 1.0 +
run*0.07` were tuned in `7ea0f55` to stop the field drawing rectangles on the walls,
and that tuning stands.

## The idea

Keep the model exactly as DESIGN.md frames it — rain is a property of the light, not
a picture of raindrops; one noise field read at two reaches — and correct only the
three motion properties that make that field read as the wrong phenomenon.

Water crossing the only window in the room falls, at a speed you would call falling,
in sheets that are wider than they are tall. Nothing else changes.

## The changes

### 1. The in-room field — `room.js:120`

```glsl
// before
vec2 rq = vec2(dp.x*3.2, dp.y*1.15 - uTime*0.09) + uWind*t*2.0;
// after
vec2 rq = vec2(dp.x*1.6, dp.y*2.4 + uTime*0.56) + uWind*t*2.0;
```

- `+ uTime` — the field falls.
- `0.56` — drift is `coefficient / y-multiplier`, so `0.56/2.4 = 0.233`
  screen-heights per second, ~4.3s per screen. Three times the current speed.
- `x*1.6, y*2.4` — cells become 1.5x **wider** than tall (`x: 5.76`, `y: 8.64`
  cycles per unit) instead of 2.78x taller. A wide cell falling is a sheet; a tall
  cell drifting is a plume.

`dp` is aspect-corrected at `room.js:86`, so both components are already in units of
one screen height and the cell aspect is purely these multipliers.

Accepted side effect: halving the x-multiplier doubles the visual reach of the
`uWind` term, from `0.0125` to `0.025` screen-units per second at full wind. Rain
still falls near-vertical; wind direction becomes legible where it currently is not.

### 2. The glass streaks — `room.js:133`

```glsl
// before
+ vec2(uWind.x*2.2, -1.0)*uTime*1.7
// after
+ vec2(uWind.x*2.2,  1.0)*uTime*1.7
```

Sign flip only, restoring DESIGN.md:74. Streak speed is left at `1.7/5.0 = 0.34`
screen-heights per second (~2.9s per screen).

Note that speeding up the in-room field narrows the gap between the two layers: the
streaks currently run 4.3x the in-room field and will run 1.5x after this change.
The pane is nearer than the far wall, so it should still be the faster of the two,
and 1.5x preserves that ordering — but the parallax between them becomes much less
pronounced. Verification should confirm the two layers still read as separate
distances; if they read as one flat field, raising the streak coefficient from `1.7`
is the lever, in a follow-up rather than here.

## What deliberately does not change

- Both amplitudes (`0.32`, `0.07`), and the `*3.6` fbm scale.
- The Hoskins hash, the five-octave `fbm`, and the two-reach structure.
- `wetness()` in `app.js:298` and its precipitation mapping.
- The final cool-down pass at `room.js:274`.
- The fog and haze channels, which are separate fields and read correctly.

## Risk

Widening the cells moves back toward the failure `7ea0f55` fixed: cells large enough
to read as structure on the wall rather than as texture. Three things stand against
it — the Hoskins hash removed the axis-aligned seams that made the old cells legible
as rectangles, the amplitudes stay low, and a 4.3s traverse does not sit still long
enough to point at.

It is nonetheless the specific thing verification is looking for. If visible
structure reappears, pull the x-multiplier back toward 2.2 and report the tradeoff
rather than silently re-tuning.

## Verification

In Chrome against a `no-store` server, per the three known traps: force
`canvas.style.transition='none'; canvas.style.opacity='1'` before judging any frame,
confirm `.room` carries both `has-gl` and `is-lit`, and watch the console for
`room shader:` / `room link:`.

Sweep `room.setWeather()` across `wet: 0.15` (light drizzle), `0.45` (steady rain)
and `0.95` (downpour), at two wind directions. `wet` eases at `0.03`/frame and the
tab backgrounds between tool calls, so take throwaway frames to let the value settle
before judging.

Success is three-part: the field falls, it reads as water rather than steam at
`0.45`, and no cell structure is pointable-at on the wall at `0.95`.
