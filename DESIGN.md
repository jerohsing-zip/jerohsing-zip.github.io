# Design — NOW (live portfolio)

<!-- impeccable:design-schema 1 -->

This is a **separate surface** from the root LOADOUT/BRUTAL site. It has its own world.
Product truth (who Jerome is, the evidence) is shared from the root `PRODUCT.md`.

## World

**NOW / LIVING INSTRUMENT** — a warm telemetry readout of a real person, floating inside a filmic, time-of-day sky. The emotional hook is *presence*: you arrive and it is unmistakably Jerome, *this moment* — his local clock ticking, the song he's on, the game he's been in, the code he just shipped. A precise mono instrument (the engineer's soul) held inside a living cinematic atmosphere that changes with his local light (dawn · day · dusk · night). The contrast is the thesis: a warm human inside a precise live system.

**Anti-reference:** the AI-default clusters — cream ground + serif display + terracotta accent; near-black + neon-on-black; broadsheet-editorial hairlines + italic serif. Also the LOADOUT/BRUTAL world of the root site: this is softer, warmer, atmospheric, alive — not loud, flat, or brutalist. And not a "dashboard": data serves personality, never a metrics grid.

## Ground & mode

**Experience** — the living portrait leads from the first viewport; the interface recedes. The ground is *not* a fixed light/dark choice: it IS the subject's local time, a graded cinematic sky computed from his timezone. Scene: a recruiter opens one of ten tabs and finds a person who is awake somewhere in the world right now.

## Color — Drenched / time-driven

The surface IS the color, and the color is the time of day. Four phases set the field, text, and accent. Secondary text is always tinted from the ground hue — never gray.

| Token | Night (default) | Role |
|---|---|---|
| `--ground-top` | `#171A3A` | Sky top (deep warm indigo) |
| `--ground-bottom` | `#0A0912` | Sky floor (warm ink, never pure black) |
| `--panel` | `rgba(20,17,28,.55)` | Instrument glass over the sky (a *specific* effect, not decoration) |
| `--text` | `#F2ECDE` | Warm off-white |
| `--text-2` | `#9A93B0` | Secondary, tinted from indigo |
| `--accent` | `#F5B14E` | Lamp amber — the "live" pulse, now-playing glow |
| `--line` | `rgba(242,236,222,.14)` | Hairlines |

Phases (`data-phase` on `<html>`): **dawn** cool steel-rose, **day** luminous warm daylight with dark text (genuinely bright — defeats the dark-UI cliché), **dusk** amber→magenta→violet, **night** indigo→ink. Each phase overrides the tokens above. The accent shifts with the phase (the color of the current key light).

## Type

| Role | Family | Notes |
|---|---|---|
| Human / display | **Bricolage Grotesque** (600–800) | Name, the one-line statement, section titles. The warm, slightly hand-made human voice. Tight tracking on large sizes. |
| Telemetry / data | **Martian Mono** (400–600) | The instrument register — labels, the ticking clock, live values, freshness stamps, meta. Mono earns its place as real live *data/measurement*, not costume. |

Display max ~5.5rem; mono data legible at 12–14px. No gradient text; emphasis by weight/size.

## Signature devices

- **The living sky** — a WebGL field (`sky.js`): domain-warped flow-noise blobs that morph continuously, colored by a **continuous 24-hour curve** (8 keyframes interpolated every second — no phase steps; the UI flips light/dark once at dawn and dusk from the sky's live luminance). Light film grain, soft vignette. It **breathes** on a slow sine pulse and the cursor drives **depth parallax** between a near and a far noise layer. **Weather** (Open-Meteo, no key) layers on subtly: cloud cover mutes/dims, rain cools, fog hazes — with a `temp° · condition` word in the readout. Falls back to a CSS gradient for reduced-motion / no-WebGL. Ambient drifting motes on top.
- **The instrument panel** — the NOW readout: hairline-divided rows (LOCATION / LISTENING / PLAYING / SHIPPING), a `●` live pulse, per-row freshness stamps ("updated 12m ago"). Precise, warm, quiet.
- **The ticking clock** — large mono local time (with seconds), the always-live heartbeat even between data refreshes; drives the phase.
- **Album art** — the one photographic warmth (real Spotify art at runtime; a labeled synthetic tile until wired).

## Motion

One authored moment: the instrument **settles in** on load (rows resolve on an exponential ease-out from an already-legible default), the clock begins to tick, and the sky is already the correct time. Live behaviors: the pulse, a subtle now-playing equalizer, a soft crossfade when the sky crosses a phase boundary while open, and a gentle value-swap when a signal refreshes. Everything honors `prefers-reduced-motion` (phase *color* still applies; animation does not). Driven by the Motion library. No scattered hover effects.

## Structure

No brutalist section numbers. Scroll from the living instrument into the substance, all in one world:
**NOW** (hero instrument) → **WORK** (projects, editorial list — not a card grid) → **RECORD** (experience, a mono-dated time column) → **PROFILE** (bio · stack · languages · résumé) → **CONTACT**. Pace: atmospheric hero, calmer legible content, a real close.

## Data

A scheduled snapshot (GitHub Action) fetches Spotify / Steam / PSN / GitHub with secrets and writes `live.json`; the static page reads it and re-polls. `location.json` is written by a phone Shortcut that pings a second workflow on arrival (city-level only — coordinates resolve the timezone server-side and are discarded; see `SHORTCUT.md`); the clock/phase are computed client-side from that timezone. Secrets never reach the browser. Every signal has honest empty and stale states; a failed fetch still renders a complete page.

## Accessibility

Contrast ≥4.5:1 body / ≥3:1 large — verified on **every** phase background (day and night are different problems). Focus visible. `aria-live="polite"` on updating values; album art has `alt`. Grain/vignette/motes are `aria-hidden`. Reduced-motion pins final state and disables animation while keeping phase color. Semantic landmarks and heading order preserved.
