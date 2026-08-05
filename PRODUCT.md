# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary: recruiters and hiring managers** evaluating Jerome Hsing as a candidate. They arrive cold, usually
from a different timezone, with the page open as one of many tabs, and they give it seconds before deciding
whether to keep reading. Success is a concrete contact — an email or a LinkedIn message.

Secondary, not optimized for: peers and friends who already know him and check in occasionally.

## Product Purpose

A personal live presence page. It answers "who is Jerome Hsing, and is he worth talking to?" while
simultaneously demonstrating the answer: the page is continuously synchronized with his actual present moment.
It exists to convert a cold evaluator into an inbound message.

## Positioning

The page is *verifiably live*, not merely animated. It reports where Jerome actually is, what the sky and weather
there are actually doing, and what he is actually listening to — assembled from live public signals, with no
server holding state. A neighboring portfolio can copy a layout; it cannot truthfully claim to be showing you
someone's real present moment.

The technical demonstration and the credential are the same artifact: the thing proving he can build is the
thing telling you about him.

## Operating Context

Static site on GitHub Pages (`jerohsing-zip.github.io`), no backend framework. Live data arrives by four
independent paths:

- **`live.json`** — a GitHub Actions cron (`.github/workflows/live.yml`) fetches Steam / PSN / GitHub with
  repository secrets and commits the result. Nominally every 20 minutes; GitHub actually delays it to roughly
  hourly, and it only commits when data changed.
- **`location.json`** — written by an iOS Shortcut firing a `repository_dispatch` on arrival in a new place
  (`SHORTCUT.md`). City-level only: coordinates resolve the timezone server-side and are discarded.
- **`now-spotify` Cloudflare Worker** — serves currently-playing / last-played on request, cached 20s. Owns the
  listening signal entirely; the cron does not.
- **Open-Meteo** — geocoding plus current weather, called directly from the browser. Free, no key.

Secrets never reach the browser.

## Capabilities and Constraints

- **No fixed base.** Jerome is genuinely itinerant between Tokyo, Taiwan, and elsewhere. There is no home city
  to hardcode; location is whatever `location.json` last recorded. Any copy naming a fixed base is false.
- **Spotify audio analysis is unavailable.** `audio-features` and `audio-analysis` were deprecated 2024-11-27
  for all apps without pre-existing extended quota, and this app has none. No tempo, energy, valence, key, or
  beat grid exists or can be obtained. Track metadata, album art, playback progress, and play history remain
  available.
- **Album art is CORS-open.** `i.scdn.co` serves images with `Access-Control-Allow-Origin: *`, so client-side
  pixel access is possible without a proxy.
- **Spotify play history lags.** `recently-played` only records *completed* plays, so a paused track never
  appears there. The last-played fallback can therefore be hours stale while the user is actively listening.
- **Every signal must have honest empty and stale states.** A failed fetch renders a complete page and leaves the
  previous value alone; it must never be presented as a real value. This has been violated before — a
  fabricated placeholder track once shipped as a permanent lie.
- **Languages:** Japanese, Mandarin, and English are native; Cantonese is conversational.

## Brand Commitments

- Name: **Jerome Hsing**.
- This is a **separate surface** from the root LOADOUT/BRUTAL site and does not inherit its visual world.

## Evidence on Hand

Real and usable:

- Full employment history with named employers, roles, locations, and dates (Kinaxis, Plus Curiosity, HireFlow,
  Moongrove) — currently in `index.html`.
- Education: BS Computer Science, Washington University in St. Louis (GPA 3.68, 2025); BA Economics, Claremont
  McKenna (major GPA 3.80, 2025).
- Three project descriptions (HireFlow candidate-fit engine, Moongrove product imagery, WashU rapid prototypes).
- Live telemetry: location, local time, weather, listening, gaming, last commit.

Confirmed to exist, **not yet supplied to the build** (open):

- The real LinkedIn profile URL. The site currently ships a placeholder linking to the bare `linkedin.com`
  homepage with a visible `[link TBD]` marker.
- A PDF résumé. The site currently links a `.docx` located outside the site root.
- A photograph of Jerome. The site currently contains no photography at all.

**Absent — must not be fabricated:** there are no screenshots, live URLs, demos, repositories, or writeups for
any of the three projects. No testimonials, metrics, client names beyond those listed, or benchmarks exist.

## Product Principles

1. **Honest state over flattering state.** An unreachable source renders as unknown or unchanged, never as a
   plausible-looking value. The page's entire claim rests on being true.
2. **The credential must survive the atmosphere.** However alive the page becomes, a recruiter must still learn
   who this is and how to reach him within seconds. Expression never costs legibility.
3. **Demonstrate rather than assert.** The live layer is the proof of technical range; no sentence needs to
   claim he can build things.
4. **Real material only.** Sections are carried by authored content and true facts. Where an asset does not
   exist, the section is reframed honestly rather than filled with invented imagery.
5. **Degrade completely.** No-JS, no-WebGL, reduced-motion, and every failed fetch still produce a coherent,
   accurate page.

## Accessibility & Inclusion

- Body text ≥4.5:1 and large text ≥3:1 contrast, verified against **every** state the live background can reach
  — bright midday and deep night are different problems, and a music-driven tint is a third.
- `prefers-reduced-motion` pins the final state and disables animation while preserving correct color.
- Semantic landmarks and heading order preserved; `aria-live="polite"` on updating values; decorative
  atmosphere is `aria-hidden`.
