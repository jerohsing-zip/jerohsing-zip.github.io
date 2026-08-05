/* Verifies signals.js sun math against Open-Meteo's own sunrise/sunset.
   Run: node scripts/check-solar.mjs
   Passes when every site agrees within TOL_MIN minutes. */
import { solarPosition, sunTimes, regimeOf } from "../signals.js";

const TOL_MIN = 3;

const SITES = [
  { name: "Hsinchu, TW", lat: 24.8138, lon: 120.9675 },
  { name: "Tokyo, JP", lat: 35.6895, lon: 139.6917 },
  { name: "San Francisco, US", lat: 37.7749, lon: -122.4194 },
  { name: "St. Louis, US", lat: 38.6270, lon: -90.1994 },
  { name: "Reykjavik, IS", lat: 64.1466, lon: -21.9426 },   // high latitude, short window
  { name: "Sydney, AU", lat: -33.8688, lon: 151.2093 }      // southern hemisphere
];

const minutesApart = (a, b) => Math.abs(a - b) / 60000;

let failures = 0;

for (const s of SITES) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${s.lat}&longitude=${s.lon}` +
              `&daily=sunrise,sunset&timezone=UTC&forecast_days=1`;
  const res = await fetch(url);
  if (!res.ok) { console.log(`SKIP ${s.name} — Open-Meteo ${res.status}`); continue; }
  const j = await res.json();

  const expRise = new Date(j.daily.sunrise[0] + "Z");
  const expSet = new Date(j.daily.sunset[0] + "Z");
  const got = sunTimes(s.lat, s.lon, expRise);

  const dRise = minutesApart(got.sunrise, expRise);
  const dSet = minutesApart(got.sunset, expSet);
  const ok = dRise <= TOL_MIN && dSet <= TOL_MIN;
  if (!ok) failures++;

  console.log(
    `${ok ? "PASS" : "FAIL"} ${s.name.padEnd(20)} ` +
    `rise ${got.sunrise.toISOString().slice(11, 16)} vs ${expRise.toISOString().slice(11, 16)} (${dRise.toFixed(1)}m)  ` +
    `set ${got.sunset.toISOString().slice(11, 16)} vs ${expSet.toISOString().slice(11, 16)} (${dSet.toFixed(1)}m)`
  );

  /* The altitude curve must agree with the rise/set it produced: the sun is
     at the horizon at sunrise, and genuinely up an hour later. */
  const atRise = solarPosition(s.lat, s.lon, got.sunrise).altitude;
  const after = solarPosition(s.lat, s.lon, new Date(got.sunrise.getTime() + 3600000)).altitude;
  if (Math.abs(atRise) > 1.0) { console.log(`  FAIL altitude at sunrise = ${atRise.toFixed(2)}°, expected ~0`); failures++; }
  if (after <= atRise) { console.log(`  FAIL sun not climbing after sunrise`); failures++; }
}

/* Regime thresholds are the real definitions of twilight. */
const regimes = [[10, "day"], [3, "golden"], [-3, "civil"], [-9, "nautical"], [-15, "astronomical"], [-30, "night"]];
for (const [alt, want] of regimes) {
  const got = regimeOf(alt);
  if (got !== want) { console.log(`FAIL regimeOf(${alt}) = ${got}, expected ${want}`); failures++; }
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nAll solar checks passed.");
process.exit(failures ? 1 : 0);
