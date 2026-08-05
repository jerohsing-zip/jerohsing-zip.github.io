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
- **The turntable wash** — the album art of the current track, quantized to 2–3 dominant colors and thrown
  across the room as bounded colored light. Low-chroma covers are rejected so a dull sleeve never washes the
  room out. Decays back to true room light when playback stops.
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
  at every cloud cover, plus a saturated album wash, in both light and dark scene states. The opaque `--paper`
  credential surfaces make this structurally achievable rather than a per-state negotiation.
- The content bands are **translucent**, so the room stays visible the whole way down the page rather than
  being lidded over below the fold. Text is therefore derived and checked against the *composite* — band over
  the brightest and darkest room the shader can put behind it — not against the band's own colour. The
  translucency costs contrast, and it is spent from a budget `scripts/check-contrast.mjs` measures.
- Focus visible. `aria-live="polite"` on updating values. Album art carries `alt`.
- The window, glass weather, and color wash are `aria-hidden` decoration.
- Reduced-motion keeps correct color and disables animation.
- Semantic landmarks and heading order preserved; the page works without JS and without WebGL.
