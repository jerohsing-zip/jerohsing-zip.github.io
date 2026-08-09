# Light on the page

**Date:** 2026-08-09
**Status:** prototype, not yet seen

## The idea

The room is behind the content. The bands are paper laid over it, and until now
the only thing that happened where they met was that the light gave up:
`uCover` fades the strip out as the page scrolls over it, so the record's colour
dies the moment the reading surface arrives.

This makes the paper a surface in the room instead. The same rendered light,
blitted into each band **in register** with the room behind it, so a strip
crossing the panel's edge continues across it rather than stopping at it.

And the light **hands over**. `uCover` already measures how much of the room the
page has covered; the page now takes what the wall loses. Scrolling stops being
"content occludes the room" and becomes "the page moves through the light".

## Not a second render

`paper.js` does one `drawImage` per band per frame from the canvas `room.js`
already rendered. It is a texture blit, not a second pass over the fragment
shader. `SCALE 0.66` and `powerPreference: "low-power"` are deliberate
concessions in `room.js` and this does not spend them again.

Register comes for free from that choice: because the source pixels are the
room's own, drawing them at the band's negative offset puts them exactly where
they would be if the band were transparent.

Bands fully off screen skip the blit entirely.

## Two rules, both accessibility rather than taste

**Beneath the ink.** `z-index: -1` inside an isolated `.band` paints the layer
above the band's background and below every in-flow descendant. An overlay
*above* the text would lighten the text: ink sits near 0.01 relative luminance
and a 17% screen lifts it toward 0.17, taking the proven contrast with it.
Underneath, the sheet brightens and the ink is untouched — which is also what
light does to print. The sheet takes it; the ink absorbs it.

**Only lightens.** `mix-blend-mode: screen` cannot lower a channel. Every
checked pair is dark on paper, and contrast is monotonic in the lighter
colour, so a brighter sheet raises every ratio. This is what keeps the existing
sweep valid instead of needing it re-derived.

`isolation: isolate` on `.band` is load-bearing twice over: without it a
negative z-index child escapes to the root stacking context and lands *behind*
the paper, and the blend reaches past the band to the room — the same light
counted twice.

## Checked, not claimed

`check-contrast.mjs` now reads `styles.css` and fails if:

- `.band__light` is not `mix-blend-mode: screen` — `soft-light` and `overlay`
  darken where the source is dark and would silently invert the argument
- `.band__light` is not at `z-index: -1`
- `.band` does not isolate

Then it exercises the bound directly: the paper screened against **pure white**
— brighter than any light the room can throw — must still clear AA for every
pair. Worst case comes out at **7.25:1**, against a 4.5 floor. Bounding it
rather than tracking it, the same way `bandGrounds()` bounds the room behind
the band.

The negative case was exercised: flipping the blend to `soft-light` fails the
run. An assertion that cannot fail is worth nothing.

## Constants

- `LIFT` 0.17 — what the paper takes at full handover. Past ~0.3 the paper
  stops reading as paper and starts reading as a screen showing the room.
- `LIFT_REST` 0.06 — what it takes before the page has covered anything. Not
  zero: a sheet on a lit desk is already catching the room. The handover runs
  between the two, so scrolling deepens the effect rather than switching it on.
- `SCALE` 0.5 — the layer's internal resolution. The source is already a
  0.66-scale render of a soft-edged room; sampling finer buys only memory.

## Degradation

Built only on top of a room that exists. No WebGL means no canvas to blit and
no layer created — the page is exactly as it was. Under `prefers-reduced-motion`
the room is never created at all, and the stylesheet also hides the layer
outright as a second line.

## Not verified

**This has not been looked at.** The Chrome extension was unavailable for the
whole build. What is verified: both modules parse, `check-contrast.mjs` passes
including the three new structural assertions and the white-lit bound, and the
negative case fails as it should.

What is not: whether it looks good, whether `LIFT` is near right, and whether
the handover reads as light moving rather than as a panel brightening. Serve
the branch and scroll — the effect is strongest crossing the first band's top
edge, where the strip meets the paper.

Two known open questions:

- `uCover` still fades the strip on the wall. Now that the light lands on the
  page instead of ghosting through it, the original objection — the old wash
  "read as glass" — is answered differently, and the wall fade may want
  reducing so the handover is a transfer rather than a crossfade through dark.
- The `.plate` on the first screen is opaque paper too, and currently gets
  nothing. If the effect works on the bands it probably belongs there as well.
