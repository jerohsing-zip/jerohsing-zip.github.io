/* ============================================================
   NOW — live portfolio logic (Motion-driven).
   · local clock + time-of-day phase, computed from the city tz
   · reads live.json (scheduled snapshot), re-polls, renders signals
   · honest empty / stale states; a failed fetch still leaves a
     complete page (static fallbacks stay in the HTML)
   Motion pass (confirmed): instrument entrance, phase crossfade,
   ambient motes + scroll reveals.
   ============================================================ */
import { animate, stagger, inView } from "./vendor/motion.js";
import { createSky } from "./sky.js";

(function () {
  "use strict";
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var loc = { city: "Tokyo", tz: "Asia/Tokyo" };

  /* ---------- continuous time-of-day color (24h curve) ----------
     Color keyframes around the clock; the sky interpolates between them,
     so it's always the exact color for the exact local time (no phase cuts).
     Each keyframe is [deep, mid, warm light-source] as 0..1 rgb. */
  var KEYS = [
    { h: 0.0,  c: [[0.024, 0.024, 0.059], [0.078, 0.082, 0.227], [0.910, 0.635, 0.306]] }, // deep night, lamp
    { h: 4.0,  c: [[0.055, 0.047, 0.118], [0.141, 0.122, 0.259], [0.788, 0.545, 0.690]] }, // pre-dawn violet
    { h: 6.5,  c: [[0.180, 0.153, 0.251], [0.357, 0.306, 0.431], [0.949, 0.635, 0.549]] }, // dawn rose
    { h: 9.0,  c: [[0.682, 0.761, 0.855], [0.847, 0.878, 0.902], [1.000, 0.851, 0.627]] }, // morning
    { h: 13.0, c: [[0.776, 0.835, 0.902], [0.918, 0.906, 0.855], [1.000, 0.906, 0.745]] }, // midday
    { h: 16.5, c: [[0.604, 0.525, 0.627], [0.878, 0.722, 0.588], [0.969, 0.694, 0.369]] }, // golden hour
    { h: 18.5, c: [[0.243, 0.137, 0.251], [0.478, 0.243, 0.369], [0.961, 0.522, 0.306]] }, // dusk
    { h: 21.0, c: [[0.055, 0.047, 0.180], [0.106, 0.114, 0.267], [0.910, 0.620, 0.340]] }  // into night
  ];
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(t) { return t * t * (3 - 2 * t); }
  function colorsAt(hf) {
    var n = KEYS.length;
    for (var i = 0; i < n; i++) {
      var a = KEYS[i], b = KEYS[(i + 1) % n];
      var h0 = a.h, h1 = (i === n - 1) ? b.h + 24 : b.h;
      var hh = (i === n - 1 && hf < h0) ? hf + 24 : hf;
      if (hh >= h0 && hh <= h1) {
        var t = smooth((hh - h0) / (h1 - h0)), out = [];
        for (var j = 0; j < 3; j++) out.push([
          lerp(a.c[j][0], b.c[j][0], t), lerp(a.c[j][1], b.c[j][1], t), lerp(a.c[j][2], b.c[j][2], t)
        ]);
        return out;
      }
    }
    return KEYS[0].c;
  }
  function rgb255(c) { return "rgb(" + (c[0] * 255 | 0) + "," + (c[1] * 255 | 0) + "," + (c[2] * 255 | 0) + ")"; }
  function rgba255(c, a) { return "rgba(" + (c[0] * 255 | 0) + "," + (c[1] * 255 | 0) + "," + (c[2] * 255 | 0) + "," + a + ")"; }
  function lum(c) { return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]; }
  function scale3(c, k) { return [c[0] * k, c[1] * k, c[2] * k]; }

  var sky = null;   // WebGL field (null → CSS-gradient fallback)
  var skyFront = null;
  function buildSky() {
    var host = $(".sky");
    if (!host) return;
    skyFront = document.createElement("div"); skyFront.className = "sky__layer";
    host.insertBefore(skyFront, host.firstChild);
  }

  /* ---------- time + phase ---------- */
  function partsIn(tz) {
    var p = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz, hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit"
    }).formatToParts(new Date()).reduce(function (o, x) { o[x.type] = x.value; return o; }, {});
    return { h: +p.hour % 24, m: p.minute, s: p.second, hh: p.hour };
  }
  function tzShort(tz) {
    try {
      return new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" })
        .formatToParts(new Date()).find(function (x) { return x.type === "timeZoneName"; }).value;
    } catch (e) { return ""; }
  }
  function phaseOf(h) {
    if (h >= 5 && h < 8) return "dawn";
    if (h >= 8 && h < 17) return "day";
    if (h >= 17 && h < 20) return "dusk";
    return "night";
  }

  var colorsInit = false;
  function applyTokens(cols) {
    var light = lum(cols[1]) > 0.5;
    document.documentElement.setAttribute("data-scene", light ? "light" : "dark");
    var ui = light ? scale3(cols[2], 0.5) : cols[2];   // keep the UI accent legible on light scenes
    var s = document.documentElement.style;
    s.setProperty("--accent", rgb255(ui));
    s.setProperty("--accent-ink", light ? "#FFF8EC" : "#14100A");
  }
  function paintSky(cols, immediate) {
    if (sky) { sky.setPhase(cols, immediate); return; }   // WebGL field lerps toward the new colors
    if (!skyFront) return;                                 // CSS-gradient fallback (no-WebGL / reduced)
    skyFront.style.background =
      "radial-gradient(70vmax 55vmax at 72% 12%, " + rgba255(cols[2], 0.14) + ", transparent 60%)," +
      "linear-gradient(178deg, " + rgb255(cols[1]) + ", " + rgb255(cols[0]) + " 82%)";
  }
  function tick() {
    var t = partsIn(loc.tz);
    var clock = $("[data-clock]"); if (clock) clock.textContent = t.hh + ":" + t.m + ":" + t.s;
    var fc = $("[data-foot-clock]"); if (fc) fc.textContent = t.hh + ":" + t.m;
    var hf = t.h + (+t.m) / 60 + (+t.s) / 3600;
    var cols = colorsAt(hf);
    paintSky(cols, !colorsInit); colorsInit = true;
    applyTokens(cols);
    var dp = $("[data-daypart]"); if (dp) dp.textContent = phaseOf(t.h);   // human label only
  }

  /* ---------- relative time ---------- */
  function ago(iso) {
    if (!iso) return "";
    var d = (Date.now() - new Date(iso).getTime()) / 1000;
    if (d < 60) return "just now";
    if (d < 3600) return Math.floor(d / 60) + "m ago";
    if (d < 86400) return Math.floor(d / 3600) + "h ago";
    var days = Math.floor(d / 86400);
    if (days === 1) return "yesterday";
    if (days < 7) return days + "d ago";
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  function setText(sel, val) { var el = $(sel); if (el && val != null) el.textContent = val; }

  /* ---------- render signals ---------- */
  function validTz(tz) {
    if (!tz) return false;
    try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch (e) { return false; }
  }
  function renderLocation(l) {
    if (!l) return;
    if (l.city) loc.city = l.city;
    if (validTz(l.tz)) loc.tz = l.tz;
    setText("[data-city]", loc.city);
    setText("[data-tz]", tzShort(loc.tz) || "");
    var fp = $("[data-foot-place]");
    if (fp && fp.childNodes[0]) fp.childNodes[0].nodeValue = loc.city + " · ";
    tick();
    loadWeather();
  }
  function renderListen(d) {
    var row = $('[data-sig="listen"]'), art = $("[data-art]");
    if (!d || !d.title) {
      if (row) row.classList.add("sig--empty");
      setText("[data-listen-title]", "quiet right now"); setText("[data-listen-artist]", "no track");
      setText('[data-stamp="listen"]', ""); return;
    }
    if (row) row.classList.remove("sig--empty");
    setText("[data-listen-title]", d.title); setText("[data-listen-artist]", d.artist || "");
    if (art && d.art) { art.style.backgroundImage = 'url("' + d.art + '")'; art.classList.add("has-art"); }
    setText('[data-stamp="listen"]', d.nowPlaying ? "now" : (d.period === "week" ? "top this week" : ago(d.at)));
  }
  function renderPlay(d) {
    var row = $('[data-sig="play"]');
    if (!d || !d.title) {
      if (row) row.classList.add("sig--empty");
      setText("[data-play-title]", "not playing lately"); setText("[data-play-platform]", "—");
      setText("[data-play-hours]", "0h"); setText('[data-stamp="play"]', ""); return;
    }
    if (row) row.classList.remove("sig--empty");
    setText("[data-play-title]", d.title); setText("[data-play-platform]", d.platform || "");
    setText("[data-play-hours]", (d.hoursThisWeek != null ? d.hoursThisWeek : "?") + "h");
    setText('[data-stamp="play"]', d.period === "week" ? "this week" : ago(d.at));
  }
  function renderShip(d) {
    var row = $('[data-sig="ship"]');
    if (!d || !d.message) {
      if (row) row.classList.add("sig--empty");
      setText("[data-ship-title]", "a quiet week for code"); setText("[data-ship-repo]", "—");
      setText('[data-stamp="ship"]', ""); return;
    }
    if (row) row.classList.remove("sig--empty");
    setText("[data-ship-title]", d.message); setText("[data-ship-repo]", (d.repo || "").split("/").pop());
    setText('[data-stamp="ship"]', ago(d.at));
  }
  function renderFresh(iso) {
    var el = $("[data-fresh]"); if (!el) return;
    el.textContent = iso ? "updated " + ago(iso) : "last-known data";
  }
  function renderSignals(data) {
    /* listening deliberately absent — the Worker owns it (loadListening) */
    renderPlay(data.playing);
    renderShip(data.shipping); renderFresh(data.fetchedAt);
  }

  /* ---------- listening (live) ----------
     Owned entirely by the now-spotify Worker, not by live.json — a track
     changes every few minutes and the 20-minute cron could never keep up.
     Paste the deployed Worker URL here; see worker/README.md step 7.
     Left as the placeholder, the card just keeps its static HTML. */
  var SPOTIFY_URL = "https://now-spotify.CHANGE-ME.workers.dev";

  function loadListening() {
    if (SPOTIFY_URL.indexOf("CHANGE-ME") !== -1) return;
    fetch(SPOTIFY_URL, { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) { renderListen(d); })
      /* A failed fetch leaves the previous render alone. Showing
         "quiet right now" because the Worker is down would be a lie. */
      .catch(function () {});
  }

  /* ---------- data ----------
     location.json is the hand-edited source of truth for where Jerome is;
     live.json's location only fills in if location.json is missing/invalid. */
  var locSet = false;
  function load() {
    fetch("location.json", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (l) { if (l && validTz(l.tz)) { renderLocation(l); locSet = true; } })
      .catch(function () {});
    fetch("live.json", { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (data) {
        renderSignals(data);
        if (!locSet && data.location) renderLocation(data.location);
      })
      .catch(function () { renderFresh(null); });
  }

  /* ---------- weather (Open-Meteo — free, no API key, CORS-ok) ----------
     Subtle color-only effect: cloud cover mutes/dims the sky, rain cools it,
     fog hazes it. A word ("18° · light rain") lands in the readout. */
  var WMO = {
    0: "clear", 1: "mainly clear", 2: "partly cloudy", 3: "overcast",
    45: "fog", 48: "freezing fog", 51: "light drizzle", 53: "drizzle", 55: "heavy drizzle",
    56: "freezing drizzle", 57: "freezing drizzle", 61: "light rain", 63: "rain", 65: "heavy rain",
    66: "freezing rain", 67: "freezing rain", 71: "light snow", 73: "snow", 75: "heavy snow",
    77: "snow grains", 80: "light showers", 81: "showers", 82: "heavy showers",
    85: "snow showers", 86: "snow showers", 95: "thunderstorm", 96: "thunderstorm", 99: "thunderstorm"
  };
  function isWet(code) { return (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95; }
  function isSnow(code) { return (code >= 71 && code <= 77) || code === 85 || code === 86; }

  function applyWeather(code, cloud, temp) {
    if (sky) sky.setWeather({
      cloud: (cloud != null ? cloud : 0) / 100,
      wet: isWet(code) ? 0.85 : (isSnow(code) ? 0.4 : 0),
      fog: (code === 45 || code === 48) ? 0.85 : 0
    });
    var el = $("[data-wx]");
    if (el) el.textContent = (temp != null ? Math.round(temp) + "° · " : "") + (WMO[code] || "");
  }

  var wxCity = null, wxCoord = null;
  function fetchWx(coord) {
    fetch("https://api.open-meteo.com/v1/forecast?current=temperature_2m,weather_code,cloud_cover&latitude=" + coord.lat + "&longitude=" + coord.lon)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j && j.current) applyWeather(j.current.weather_code, j.current.cloud_cover, j.current.temperature_2m); })
      .catch(function () {});
  }
  function loadWeather() {
    var city = loc.city; if (!city) return;
    if (wxCity === city && wxCoord) { fetchWx(wxCoord); return; }   // cached geocode
    fetch("https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=" + encodeURIComponent(city))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.results || !j.results.length) return;
        var g = j.results[0]; wxCoord = { lat: g.latitude, lon: g.longitude }; wxCity = city;
        fetchWx(wxCoord);
      })
      .catch(function () {});
  }

  /* ---------- motion: entrance ---------- */
  function entrance() {
    var els = document.querySelectorAll(".now .reveal");
    if (reduced) { els.forEach(function (e) { e.style.opacity = 1; e.style.transform = "none"; }); return; }
    animate(els, { opacity: [0, 1], y: [16, 0] },
      { delay: stagger(0.08, { startDelay: 0.12 }), type: "spring", stiffness: 440, damping: 34 });
  }

  /* ---------- motion: scroll reveals for the content bands ---------- */
  function bandReveals() {
    if (reduced) return;
    var targets = document.querySelectorAll(
      ".band__head, .work, .rec, .story__prose, .story__spec, .contact__h, .contact__sub, .contact__links"
    );
    var seen = new WeakSet();
    targets.forEach(function (el) {
      el.style.opacity = "0"; el.style.transform = "translateY(18px)";
      inView(el, function () {
        if (seen.has(el)) return; seen.add(el);
        animate(el, { opacity: [0, 1], y: [18, 0] }, { duration: 0.6, ease: [0.2, 0.8, 0.2, 1] });
      }, { amount: 0.2, margin: "0px 0px -10% 0px" });
    });
  }

  /* ---------- motion: ambient sky motes ---------- */
  function motes() {
    var host = $("[data-motes]");
    if (!host || reduced) return;
    var n = Math.min(26, Math.round(window.innerWidth / 52));
    for (var i = 0; i < n; i++) {
      var m = document.createElement("span"); m.className = "mote";
      var s = 1 + Math.random() * 2, o = 0.05 + Math.random() * 0.13;
      m.style.left = (Math.random() * 100) + "%"; m.style.top = (Math.random() * 100) + "%";
      m.style.width = m.style.height = s + "px"; m.style.opacity = o;
      host.appendChild(m);
      animate(m, { y: [0, -26 - Math.random() * 24], opacity: [o, o * 0.25] },
        { duration: 9 + Math.random() * 11, repeat: Infinity, repeatType: "reverse", ease: "easeInOut", delay: Math.random() * 6 });
    }
  }

  /* ---------- start ---------- */
  buildSky();                 // CSS-gradient fallback layers
  if (!reduced) {
    sky = createSky($(".sky")); // WebGL morphing field (null if unsupported)
    if (sky) {                  // shader carries its own grain + vignette
      var gr = $(".sky__grain"); if (gr) gr.style.display = "none";
      var vg = $(".sky__vignette"); if (vg) vg.style.display = "none";
    }
  }
  tick();                     // sets initial phase immediately (no crossfade)
  setInterval(tick, 1000);
  load();
  setInterval(load, 180000);  // re-poll snapshot every 3 min
  loadListening();
  setInterval(loadListening, 30000);   // now-playing, straight from the Worker
  loadWeather();
  setInterval(loadWeather, 900000);  // refresh weather every 15 min
  entrance();
  bandReveals();
  motes();
})();
