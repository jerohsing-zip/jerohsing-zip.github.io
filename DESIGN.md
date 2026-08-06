# Design — NIGHT SERVICE (live portfolio)

<!-- impeccable:design-schema 1 -->

This is a **separate surface** from the root LOADOUT/BRUTAL site. It has its own world.
Product truth lives in `PRODUCT.md`.

**This world replaces the previous NOW / LIVING INSTRUMENT world** (warm telemetry panel in a filmic
time-of-day sky). That world is retained only as anti-reference: its glass panel over an abstract gradient
field sat close to the category rut, and its sky knew the hour without knowing where the sun was.

## World

**NIGHT SERVICE** — a broadcast in progress. Not a portfolio *about* someone; a signal coming *from* someone,
somewhere, right now. The visitor arrives mid-transmission: the room is already lit, the clock already running,
the record already turning. Radio is the medium of presence-at-distance, and it is warm where an instrument
panel is cold — which is the whole reason this world exists.

**Anti-reference:** the dark-mode developer portfolio (near-black, one neon accent, mono labels, project-card
grid, gradient-mesh blob) and its opposite, warm cream editorial (serif display, terracotta, wide whitespace).
Also the previous NOW world. And critically: **radio nostalgia**. This is present tense, not pastiche — no
manufactured static, no VU meters, no skeuomorphic knobs, no fake analog wear. A device that does not carry a
real signal does not ship.

## Ground & mode

**Experience** — the broadcast is the artifact and leads from the first viewport, carrying a Persuade
obligation (see *The ident*).

**Physical scene:** you are inside a small broadcast booth at whatever hour it actually is where Jerome is. The
room's light is his real sky coming through a window, plus a tungsten desk lamp and the on-air lamp. Light or
dark is therefore **not a preference and not a toggle** — it is what time it is there, and the page passes
through the entire range every day.

## Color — Drenched, with a source

The surface IS the light. The difference from the replaced world is that this drench has a **direction and an
origin**: a window at a real position, not an ambient field. Secondary text is always tinted from the room's
current hue, never gray.

| Token | Role | Night value (illustrative) |
|---|---|---|
| `--room` | The booth's ambient wall | `#14201F` deep teal-slate |
| `--room-lit` | Surfaces facing the window | derived; brighter, hue from the sun |
| `--paper` | The ident and credential surfaces — **opaque, always** | `#E8E2D4` bone |
| `--ink` | Text on paper | `#1B1E1C` |
| `--text` | Text on the room | tinted from `--room`, never gray |
| `--tungsten` | The desk lamp pool | `#D1BA99` soft warm parchment |
| `--onair` | The on-air lamp — **live state only** | `#8E1F1F` oxblood |

Deliberately **not** warm indigo + lamp amber (the replaced world) and **not** near-black + neon. The ground
spans bone-white midday through tungsten evening to deep teal night; it is never a fixed dark surface, which is
what keeps the oxblood accent from reading as the neon-on-black cliché.

**Oxblood is reserved.** It means genuinely live data flowing — nothing else may borrow it. When the Worker
fails or data is stale, the lamp is dark. Honest state is physical here, not a label.

## Type

| Role | Family | Notes |
|---|---|---|
| Ident / display | **Archivo** at expanded width (600–800) | Wide and plated, like a station ident or a transmitter rating plate. Carries the name and section titles. |
| Text | **Archivo** (400–500) | Same family; a real workhorse that keeps character at reading sizes. Measure 65–75ch. |
| Data | **Sometype Mono** (400–500) | The clock, coordinates, timestamps. Warmer and more humanist than the replaced world's mono — mono is earned here as genuine measurement, never as "technical" costume. |

Display max 6rem, tracking floor -0.04em. No gradient text; emphasis by weight and size.
Verify both families resolve from Google Fonts before shipping.

## Signature devices

- **The window** — the background, and the only source of daylight. Position from **real solar azimuth**,
  intensity and color from **real solar altitude**, on true thresholds (day / golden / civil / nautical /
  astronomical / night). Not a keyframed 24h ramp. The sun crossing the horizon is light crossing the sill.
- **Weather in the room** — not only on the glass. Fog and the falling streaks stay on the window plane, but
  cloud, rain and humidity are properties of the light itself: **cloud** flattens, cools and dims the whole
  ambient, because an overcast midday is a grey room and not a sunlit one with a duller window; **rain**
  moves it, water crossing the only window taking the room's whole light level with it; **humidity** scatters
  it, so the window loses its edge and carries further. Wind speed and direction set the drift. Every field of
  the same Open-Meteo call is spent — temperature, code, cloud, wind, humidity and precipitation all render
  something, and nothing is requested that does not.
- **The prism** — the record's colour, arriving as a narrow strip of split light rather than as weather in the
  air. Something with a bevelled edge is sitting in the room's light; the record is what that light breaks
  into. It is cast by whichever source is actually lighting the room — the window by day, the desk lamp after
  dark — so the handover happens on its own through dusk with nothing scheduling it, and it sweeps as the sun
  crosses, a second clock. Cloud kills it outright, because a caustic needs direct light and an overcast
  midday has none to give. It fades out as the page scrolls over the room, rather than ghosting through a
  translucent band and being cut by its edge.

  **It does not move.** That is the design, not an economy. A bright band on a wall is furniture; a moving
  field is weather, and the eye cannot stop reading weather. Its colours are only ever the sleeve's own, laid
  warm edge to cool edge — what reads as refraction is *separation*, light that arrived as one thing landing
  as three side by side, never a manufactured spectrum. A cover that is three shades of rust still reads as
  rust, which is the correct answer for that record. Every sleeve reaches the wall, including the monochrome
  ones — a white record throws white light, and that is a true rendering of it rather than a failure to find
  a colour.

  **A dark record throws a dark strip, and keeps its hue.** Both had to be built; neither was free. The strip
  first divided the sleeve colour by its own luminance, which made every record throw exactly the same amount
  of light — so a dark cover landed as a pale band indistinguishable from a bright one. Dividing by a *power*
  of that luminance gives the darkness back. The subtler fault was chromatic: a dark, cool sleeve adds light
  that desaturates the warm wall it lands on, so the band came out *less* saturated than the room around it —
  measurably, 0.06 against a wall at 0.36. So the shared neutral is taken out of the colour before it is
  thrown, leaving only what carries hue. That is not invention: it is the sleeve's own colour at higher
  purity, which is what a prism returns. A genuinely grey cover has no chromatic remainder and still comes
  back grey — `check-contrast.mjs` holds it to that, which is the line between separating the record's colour
  and manufacturing one.

  The monochrome case cost a third fix. `signals.js` refused any cover under chroma 0.05, which was sound
  while the record reached the room only as a multiplicative tint: a grey normalises to a multiplier of 1 and
  genuinely moves nothing. Against an additive strip it was deleting a real render — a largely white sleeve
  scored ~0.03, resolved `null`, and took the strip *and* the lean to zero, so the record disappeared from the
  room entirely. The gate is gone. Nothing replaced it: a grey still no-ops the lean by construction, and the
  strip already scales with the cover's luminance, so a black sleeve throws almost nothing without anyone
  deciding it should.

  What remains when the strip is absent — overcast, or scrolled past — is **the lean**: a flat, motionless
  tilt of the walls toward the sleeve's dominant hue, weak enough to be felt rather than seen. The sleeve is
  normalised to unit luminance first, so the room shifts colour while holding its light; multiplying by a raw
  cover colour just darkens, and a navy sleeve turned the room muddy instead of blue. Both decay back to true
  room light when playback stops.

  *What was here before, and why it went.* The wash was a volumetric fbm field drifting on the wind, with a
  daylight-gain stage bolted on because a tint calibrated to read after dark was invisible at noon. The gain
  solved a real problem, and it went with the mechanism that had it: there is no volumetric tint left to
  defend against the sun. The field itself was the deeper mistake — viewport-scale colour moving behind text
  is impossible to stop reading, and behind an 84%-opaque band it read as glass. The proofs that guarded the
  gain were deleted with it, and replaced by proofs of the outcome it existed for: that the record is never
  entirely absent from the room, and that neither lean nor strip can drive the room out of range.

  *One honest departure.* Everything else in this room is a consequence of where the light is. Between about
  05:00 and 11:00 the window sits behind the ident plate, and so did everything it cast — the record had
  nothing but the lean for seven hours of every day. So the strip's horizontal footing is held clear of the
  plate for those hours. It keeps its angle, its length and its rise; only its footing is placed rather than
  thrown, and it stops applying the moment the geometry clears the plate on its own.
- **The on-air lamp** — lit only while data is genuinely live. Replaces the previous world's abstract `●` pulse
  with something that means something.
- **The ident** — a persistent opaque plate carrying name, what he does, where he is transmitting from, and how
  to reach him. It never scrolls away and never depends on the room's luminance. **This is the Persuade
  obligation and the resolution of the ambient/recruiter tension: the atmosphere is free to be as alive as it
  likes because the credential does not live inside it.**

## Motion

**One authored moment: the cold open.** The room is already lit and running when the page loads — nothing
fades up from nothing, because the broadcast did not start when you arrived. The authored beat is the ident
*settling in* after the room establishes, on an exponential ease-out from an already-legible default.

Everything else is genuinely ambient: the window light moves because the sun moves, over minutes and hours, not
on a loop. No scattered hover effects. `prefers-reduced-motion` pins the final state and keeps correct color
while disabling animation.

## Structure

Cold-open staging: the visitor lands inside the broadcast with no introductory chrome, and the ident identifies
the station immediately and persistently (as real broadcasts do — frequently and briefly), rather than
withholding identity.

**ON AIR** (the room, current state) → **SEGMENTS** (work) → **THE RECORD** (career; the double meaning is the
point) → **BETWEEN RECORDS** (bio, in first person, where a DJ talks) → **THE LINE'S OPEN** (contact).

Pace: atmospheric opening, calm legible middle, a real close.

## Data

Four independent live paths, all detailed in `PRODUCT.md`: the `now-spotify` Worker (listening), a GitHub
Actions cron (`live.json`), an iOS Shortcut (`location.json`), and Open-Meteo (weather + geocoding). Solar
position is computed client-side from the geocoded coordinates — no API.

**No fixed location may be hardcoded anywhere.** Jerome is itinerant; the transmitting origin is whatever
`location.json` last recorded.

Every signal has honest empty and stale states. A failed fetch leaves the previous value alone and renders a
complete page; it is never presented as a real value.

## Accessibility

- Body ≥4.5:1 and large text ≥3:1, verified against **every** state the room can reach: all six solar regimes
  at every cloud cover, plus a saturated album lean, in both light and dark scene states. The opaque `--paper`
  credential surfaces make this structurally achievable rather than a per-state negotiation.
- The content bands are **translucent**, so the room stays visible the whole way down the page rather than
  being lidded over below the fold. Text is therefore derived and checked against the *composite* — band over
  the brightest and darkest room the shader can put behind it — not against the band's own colour. The
  translucency costs contrast, and it is spent from a budget `scripts/check-contrast.mjs` measures.
- Focus visible. `aria-live="polite"` on updating values. Album art carries `alt`.
- The window, glass weather, the prism strip and the lean are `aria-hidden` decoration.
- Reduced-motion keeps correct color and disables animation.
- Semantic landmarks and heading order preserved; the page works without JS and without WebGL.
