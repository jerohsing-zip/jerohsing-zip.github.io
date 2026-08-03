# Automatic location updates

The site's city, clock, sky and weather all follow `location.json`. This is how
that file keeps itself current, without hand-editing JSON.

```
iPhone Shortcut (daily, 09:00)
  └─ Get Current Location → City / State / Latitude / Longitude
     └─ POST /repos/<you>/<repo>/dispatches          (fine-grained PAT)
        └─ .github/workflows/location.yml
           └─ scripts/update-location.mjs
              ├─ lat/lon → IANA timezone (Open-Meteo), coordinates then discarded
              └─ rewrites location.json + commits — only if the city actually changed
```

**What gets published:** `{ city, region, tz, updatedAt }`. Coordinates are used
once, server-side, to look up the timezone, and are never written to the repo.
City-level is as fine as it gets.

**What it costs when you're home:** nothing. The script exits without writing when
the city and timezone are unchanged, so no commit and no rebuild. The git history
of `location.json` becomes a clean travel log.

---

## 1. Create the token

GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained
tokens → Generate new token**.

- **Repository access:** *Only select repositories* → this repo, and nothing else.
- **Permissions → Repository permissions → Contents: Read and write.**
  (This is what authorizes `repository_dispatch`.)
- **Expiration:** 1 year. Put a calendar reminder to rotate it.

The token will sit in plaintext inside the Shortcut — that's the tradeoff for
having no server. Scoped to a single repo, the worst a leak buys someone is a bad
commit to your portfolio.

## 2. Test it from a laptop first

```bash
curl -i -X POST https://api.github.com/repos/<you>/<repo>/dispatches \
  -H "Authorization: Bearer <PAT>" \
  -H "Accept: application/vnd.github+json" \
  -d '{"event_type":"location","client_payload":{"city":"Los Angeles","region":"California","lat":34.05,"lon":-118.24}}'
```

Expect **`204 No Content`** and a run appearing under the **Actions** tab. A `404`
almost always means the token lacks Contents: write, or is scoped to the wrong repo.

## 3. Build the Shortcut

New Shortcut, named e.g. *Ping location*:

1. **Get Current Location**
2. **Get Details of Location** → *City* → rename the variable `City`
3. **Get Details of Location** → *State* → rename `Region`
4. **Get Details of Location** → *Latitude* → rename `Lat`
5. **Get Details of Location** → *Longitude* → rename `Lon`
6. **Text** — paste this, then replace each placeholder with the matching variable
   (long-press → *Insert Variable*; leave the quotes around `City` and `Region`,
   and leave `Lat` / `Lon` unquoted):
   ```json
   {"event_type":"location","client_payload":{"city":"City","region":"Region","lat":Lat,"lon":Lon}}
   ```
7. **Get Contents of URL**
   - URL: `https://api.github.com/repos/<you>/<repo>/dispatches`
   - Method: **POST**
   - Headers: `Authorization` → `Bearer <PAT>` · `Accept` → `application/vnd.github+json`
   - Request Body: **File** → select the **Text** from step 6

Run it once by hand. iOS will ask for location permission — grant **Always** so it
works unattended.

## 4. Schedule it

**Shortcuts → Automation → New → Time of Day → 09:00, Daily** → run *Ping location*
→ turn **Ask Before Running** off (*Run Immediately*).

Worth adding a second automation on **Wi-Fi network changes** or **CarPlay
disconnects**, so an arrival shows up the same day instead of the next morning.

**Android:** same POST from Tasker (HTTP Request action) or the HTTP Shortcuts app,
with a location variable feeding the body.

## Manual override

No phone needed: **Actions → location → Run workflow**, fill in the city (and
optionally lat/lon so the timezone resolves — without them the previous timezone is
kept, and if you've changed cities the run refuses rather than pair a new city with
a stale clock).

Locally:

```bash
LOC_CITY="Los Angeles" LOC_REGION="California" LOC_LAT=34.05 LOC_LON=-118.24 \
  node scripts/update-location.mjs
```

## Troubleshooting

| Symptom | Cause |
|---|---|
| Shortcut returns `404` | Token missing Contents: write, or scoped to another repo |
| Shortcut returns `422` | Malformed JSON body — check the variables in step 6 kept their quotes |
| Run succeeds, site unchanged | The city didn't change (`no change` in the log), or Pages hasn't rebuilt yet |
| Site shows the wrong clock | `tz` in `location.json` isn't a valid IANA zone; `app.js`'s `validTz()` rejects it and falls back to `live.json` |
