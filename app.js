/* ============================================================
   NIGHT SERVICE — live portfolio logic.

   · the room's light comes from the sun's real position, not the hour
   · location.json is the only source of where Jerome is (he is itinerant;
     no city may be hardcoded anywhere in this file)
   · the Worker owns "on the turntable"; live.json owns the rest
   · honest empty and stale states throughout — a failed fetch leaves the
     previous value alone and never renders as a real one
   ============================================================ */
import { animate, stagger, inView } from "./vendor/motion.js";
import { createRoom } from "./room.js";
import { createPaperLight } from "./paper.js";
import { solarPosition, albumPalette } from "./signals.js";
import {
  tokensFor, windowPos, windowI, tungstenI,
  TUNGSTEN, BAND_ALPHA, rgb255, rgba255
} from "./light.js";

(function () {
  "use strict";

  /* ---------- things to replace with real assets ----------
     Left empty rather than guessed: the previous build shipped a visible
     "[link TBD]" pointing at the bare linkedin.com homepage, and a dead link
     is worse than no link. Set this and the row renders itself. */
  var LINKEDIN_URL = "https://www.linkedin.com/in/jeromehsing/";
  var RESUME_URL = "assets/resume.pdf";

  var SPOTIFY_URL = "https://now-spotify.jerohsing.workers.dev";

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* No default location. Until location.json (or live.json) resolves, the
     page honestly reports that it does not know where the signal is coming
     from — the alternative is a stale city on a page whose whole claim is
     that it is true right now. */
  var loc = null;
  var coord = null;

  var room = null;
  var paper = null;
  var lightInit = false;

  /* The sky the room is currently under. Held rather than passed straight to
     the shader because cloud is part of the light model now, not a filter on
     top of it — the ambient wall is computed from the sun *and* the cloud, and
     the sun moves every second while the weather arrives every fifteen
     minutes. Null until Open-Meteo answers: a clear sky is a claim, and this
     page does not make claims it has not been told. */
  var sky = { cloud: 0, wet: 0, fog: 0, haze: 0, wind: [0, 0] };

  /* The light model lives in light.js so scripts/check-contrast.mjs can sweep
     every solar altitude and prove these tokens clear WCAG, rather than us
     asserting it for the two hours we happened to look at. */
  var lastTokens = "";
  function applyLight(alt, az, lat) {
    var t = tokensFor(alt, sky.cloud);
    var band = rgb255(t.band), text = rgb255(t.text), text2 = rgb255(t.text2);
    var key = t.scene + band + text + text2;
    /* These change over minutes, not seconds. Writing them every tick would
       repaint every band on the page once a second for nothing. */
    if (key !== lastTokens) {
      lastTokens = key;
      var s = document.documentElement.style;
      document.documentElement.setAttribute("data-scene", t.scene);
      s.setProperty("--band", band);
      /* The bands are translucent so the room stays visible the whole way down
         the page. --band remains for anything that needs the solid colour. */
      s.setProperty("--band-a", rgba255(t.band, BAND_ALPHA));
      s.setProperty("--text", text);
      s.setProperty("--text-2", text2);
      /* Only when the shader is absent. With it live these sit underneath a
         crossfading canvas, and re-colouring them mid-fade is a visible snap. */
      if (!room) {
        s.setProperty("--fall-a", rgb255(t.fallA));
        s.setProperty("--fall-b", rgb255(t.fallB));
      }
    }

    if (room) {
      room.setLight({
        win: windowPos(alt, az, lat),
        winI: windowI(alt),
        light: t.light,
        room: t.room,
        warm: TUNGSTEN,
        warmI: tungstenI(alt)
      }, !lightInit);
    }
    lightInit = true;
  }

  /* ---------- clock ---------- */
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
  function validTz(tz) {
    if (!tz) return false;
    try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch (e) { return false; }
  }

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

  function tick() {
    drawPlayhead();
    if (!loc || !validTz(loc.tz)) return;
    var t = partsIn(loc.tz);
    setText("[data-clock]", t.hh + ":" + t.m + ":" + t.s);

    if (coord) {
      var sun = solarPosition(coord.lat, coord.lon, new Date());
      applyLight(sun.altitude, sun.azimuth, coord.lat);
    }
  }

  /* ---------- renders ---------- */
  function renderLocation(l) {
    loc = l;
    setText("[data-city]", l.city + (l.region ? ", " + l.region : ""));
    setText("[data-tz]", tzShort(l.tz));
    var f = $("[data-foot-place]");
    if (f) f.textContent = l.city;
    tick();
    loadWeather();
  }

  /* The record throws its colour across the room, but only while it is
     actually playing — a track that ended hours ago should not still be
     colouring the walls.

     Held here because the first track usually arrives before the room exists:
     the room cannot be built until geocoding says where it is, so the sleeve
     colour has to be re-applied once it does. */
  var lastListen = null;
  function applyWash(d) {
    if (!room) return;
    if (!d || !d.art) { room.setWash(null); return; }
    albumPalette(d.art)
      .then(function (p) { room.setWash(p, d.nowPlaying ? 1 : 0.7); })
      .catch(function () { room.setWash(null); });
  }

  var playhead = null;
  function drawPlayhead() {
    var row = $('[data-sig="listen"]');
    if (!row) return;
    if (!playhead) { row.classList.remove("has-playhead"); return; }
    var p = (playhead.progress + (Date.now() - playhead.at)) / playhead.duration;
    if (p >= 1) {                       // the track ended; the next poll says what followed
      playhead = null; row.classList.remove("has-playhead"); return;
    }
    row.classList.add("has-playhead");
    row.style.setProperty("--playhead", Math.max(0, p).toFixed(4));
  }

  function renderListen(d) {
    var row = $('[data-sig="listen"]'), art = $("[data-art]");
    if (!d || !d.title) {
      if (row) row.classList.add("cue--empty");
      playhead = null; drawPlayhead();
      setText("[data-listen-title]", "nothing spinning");
      setText("[data-listen-artist]", "");
      setText('[data-stamp="listen"]', "");
      if (art) { art.style.backgroundImage = ""; art.classList.remove("has-art", "is-spinning"); }
      lastListen = null; applyWash(null);
      return;
    }
    if (row) row.classList.remove("cue--empty");
    setText("[data-listen-title]", d.title);
    setText("[data-listen-artist]", d.artist || "");
    setText('[data-stamp="listen"]', d.nowPlaying ? "now" : ago(d.at));

    if (art && d.art) { art.style.backgroundImage = 'url("' + d.art + '")'; art.classList.add("has-art"); }
    else if (art) { art.style.backgroundImage = ""; art.classList.remove("has-art"); }
    /* Keyed on nowPlaying rather than on the artwork: a track with no sleeve is
       still a record, and it is still turning. */
    if (art) art.classList.toggle("is-spinning", !!d.nowPlaying);

    /* The turntable's position. A record has one, and showing it is the
       difference between "a song is playing" and "this is happening right
       now" — it advances between polls instead of sitting still for 30s. */
    playhead = (d.nowPlaying && d.progressMs != null && d.durationMs)
      ? { at: Date.now(), progress: d.progressMs, duration: d.durationMs }
      : null;
    drawPlayhead();

    lastListen = d;
    applyWash(d);
  }

  function renderPlay(d) {
    var row = $('[data-sig="play"]');
    if (!d || !d.title) {
      if (row) row.classList.add("cue--empty");
      setText("[data-play-title]", "nothing this week");
      setText("[data-play-platform]", "");
      setText('[data-stamp="play"]', ""); return;
    }
    if (row) row.classList.remove("cue--empty");
    setText("[data-play-title]", d.title);
    setText("[data-play-platform]", (d.platform || "") + (d.hoursThisWeek != null ? " · " + d.hoursThisWeek + "h" : ""));
    setText('[data-stamp="play"]', d.period === "week" ? "this week" : ago(d.at));
  }

  function renderShip(d) {
    var row = $('[data-sig="ship"]');
    if (!d || !d.message) {
      if (row) row.classList.add("cue--empty");
      setText("[data-ship-title]", "quiet on the wire");
      setText("[data-ship-repo]", "");
      setText('[data-stamp="ship"]', ""); return;
    }
    if (row) row.classList.remove("cue--empty");
    setText("[data-ship-title]", d.message);
    setText("[data-ship-repo]", d.repo || "");
    setText('[data-stamp="ship"]', ago(d.at));
  }

  function renderFresh(iso) {
    setText("[data-fresh]", iso ? "snapshot " + ago(iso) : "last-known snapshot");
  }

  /* ---------- the on-air lamp ----------
     Oxblood is reserved for genuinely live data. When the Worker is
     unreachable the lamp goes dark and says so; it never glows on stale data. */
  var lastLive = 0;
  function setLive(ok) {
    if (ok) lastLive = Date.now();
    var live = Date.now() - lastLive < 120000;
    var lamp = $("[data-lamp]");
    if (lamp) lamp.classList.toggle("is-live", live);
    setText("[data-onair]", live ? "ON AIR" : "NO SIGNAL");
  }

  /* ---------- data ---------- */
  function loadListening() {
    fetch(SPOTIFY_URL, { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) { renderListen(d); setLive(true); })
      /* A failed fetch leaves the previous render alone. Showing "nothing
         spinning" because the Worker is down would be a lie. */
      .catch(function () { setLive(false); });
  }

  function load() {
    fetch("location.json", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (l) { if (l && l.city && validTz(l.tz)) renderLocation(l); })
      .catch(function () {});

    fetch("live.json", { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (data) {
        renderPlay(data.playing); renderShip(data.shipping); renderFresh(data.fetchedAt);
        if (!loc && data.location && validTz(data.location.tz)) renderLocation(data.location);
      })
      .catch(function () { renderFresh(null); });
  }

  /* ---------- weather ---------- */
  var WMO = {
    0: "clear", 1: "mainly clear", 2: "partly cloudy", 3: "overcast",
    45: "fog", 48: "freezing fog", 51: "light drizzle", 53: "drizzle", 55: "heavy drizzle",
    56: "freezing drizzle", 57: "freezing drizzle", 61: "light rain", 63: "rain", 65: "heavy rain",
    66: "freezing rain", 67: "freezing rain", 71: "light snow", 73: "snow", 75: "heavy snow",
    77: "snow grains", 80: "light showers", 81: "showers", 82: "heavy showers",
    85: "snow showers", 86: "snow showers", 95: "thunderstorm", 96: "thunderstorm", 99: "thunderstorm"
  };
  function isWet(c) { return (c >= 51 && c <= 67) || (c >= 80 && c <= 82) || c >= 95; }
  function isSnow(c) { return (c >= 71 && c <= 77) || c === 85 || c === 86; }
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

  /* The code says what kind of weather it is; `precipitation` says how much of
     it there is. On the code alone a passing drizzle lit the room like a
     downpour, which is the same failure as a hardcoded city — a plausible
     value standing in for the real one. mm in the last hour: a tenth is barely
     falling, four is heavy. Snow is wet light too, just softer and slower. */
  function wetness(cur) {
    var mm = cur.precipitation != null ? cur.precipitation : 0;
    var base = isWet(cur.weather_code) ? 0.40 : (isSnow(cur.weather_code) ? 0.20 : 0);
    if (!base && mm <= 0) return 0;
    return clamp01(base + Math.min(1, Math.pow(mm / 4, 0.6)) * 0.55);
  }

  /* Damp air scatters light before it reaches the wall. Below about 60% the
     air is optically clear and this is nothing; above it the window stops
     having an edge. Fog is its own field and takes over past that. */
  function haziness(cur) {
    if (cur.relative_humidity_2m == null) return 0;
    return clamp01((cur.relative_humidity_2m - 60) / 38);
  }

  function applyWeather(cur) {
    /* Meteorological direction is where the wind comes *from*; the room
       needs the direction it is going. */
    var going = ((cur.wind_direction_10m || 0) + 180) * Math.PI / 180;
    var speed = Math.min(1, (cur.wind_speed_10m || 0) / 40);
    sky = {
      cloud: (cur.cloud_cover != null ? cur.cloud_cover : 0) / 100,
      wet: wetness(cur),
      fog: (cur.weather_code === 45 || cur.weather_code === 48) ? 0.85 : 0,
      haze: haziness(cur),
      wind: [Math.sin(going) * speed, Math.cos(going) * speed]
    };
    if (room) room.setWeather(sky);
    /* Cloud is in the ambient now, so a change in the sky changes the room and
       the page's own tokens — not just the glass. */
    tick();

    var el = $("[data-wx]");
    if (el) {
      var word = WMO[cur.weather_code] || "";
      el.textContent = cur.temperature_2m != null
        ? " · " + Math.round(cur.temperature_2m) + "° " + word
        : (word ? " · " + word : "");
    }
  }

  /* Every field here has a job, and the same rule the Worker is held to
     applies: nothing is requested that nothing renders.
       temperature_2m       → the readout beside the city
       weather_code         → the word, and what kind of wet
       cloud_cover          → the room's ambient, via cloudedRoom()
       wind_speed/direction → which way the wash and the rain drift
       relative_humidity_2m → haze; how far the window's light carries
       precipitation        → how hard it is actually raining */
  var CURRENT = "temperature_2m,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,relative_humidity_2m,precipitation";
  function fetchWx(c) {
    fetch("https://api.open-meteo.com/v1/forecast?current=" + CURRENT + "&latitude=" + c.lat + "&longitude=" + c.lon)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j && j.current) applyWeather(j.current); })
      .catch(function () {});
  }
  var wxCity = null;
  function loadWeather() {
    if (!loc || !loc.city) return;
    if (wxCity === loc.city && coord) { fetchWx(coord); return; }
    fetch("https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=" + encodeURIComponent(loc.city))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.results || !j.results.length) return;
        var g = j.results[0];
        coord = { lat: g.latitude, lon: g.longitude }; wxCity = loc.city;
        /* Only now can the room be lit correctly, so only now is it built.
           Created earlier it would sit at its zero state — an opaque black
           canvas hiding the CSS fallback — for as long as geocoding took,
           and forever if geocoding never answered. */
        ensureRoom();
        applyWash(lastListen);        // the track almost always beat the room here
        tick();
        fetchWx(coord);
      })
      .catch(function () {});
  }

  /* ---------- assets that may not exist yet ---------- */
  function wireAssets() {
    var img = $("[data-portrait]"), face = $("[data-face]");
    if (img && face) {
      img.addEventListener("load", function () { face.hidden = false; });
      img.addEventListener("error", function () { face.remove(); });
      if (img.complete && img.naturalWidth) face.hidden = false;
    }
    var r = $("[data-resume]");
    if (r) r.setAttribute("href", RESUME_URL);

    if (LINKEDIN_URL) {
      var mk = function (parent, cls, k, v) {
        var a = document.createElement("a");
        a.className = cls; a.href = LINKEDIN_URL;
        a.target = "_blank"; a.rel = "noopener";
        if (cls === "line") {
          a.innerHTML = '<span class="line__k mono"></span><span class="line__v"></span>';
          a.firstChild.textContent = k; a.lastChild.textContent = v;
        } else { a.textContent = k; }
        parent.appendChild(a);
      };
      var links = $(".ident__links"); if (links) mk(links, "", "LinkedIn");
      var close = $("[data-contact]"); if (close) mk(close, "line", "LinkedIn", "Profile");
    }
  }

  /* ---------- motion: the cold open ----------
     The room is already correct on the first paint — it does not fade up,
     because the broadcast did not start when you arrived. The one authored
     beat is the ident settling in. */
  function coldOpen() {
    var els = [$(".ident"), $(".plate")].filter(Boolean);
    if (reduced || !els.length) return;
    /* Settles from an already-legible default instead of fading up from
       nothing. A background tab freezes rAF mid-spring, and the credential
       must stay readable if this animation never finishes. */
    animate(els, { opacity: [0.72, 1], y: [12, 0] },
      { delay: stagger(0.10, { startDelay: 0.06 }), type: "spring", stiffness: 420, damping: 36 });
  }

  function bandReveals() {
    if (reduced) return;
    var targets = document.querySelectorAll(".band__head, .seg, .entry, .talk__prose, .talk__spec, .close__h, .close__sub, .close__links");
    var seen = new WeakSet();
    targets.forEach(function (el) {
      el.style.opacity = "0"; el.style.transform = "translateY(16px)";
      inView(el, function () {
        if (seen.has(el)) return; seen.add(el);
        animate(el, { opacity: [0, 1], y: [16, 0] }, { duration: 0.55, ease: [0.2, 0.8, 0.2, 1] });
      }, { amount: 0.2, margin: "0px 0px -10% 0px" });
    });
  }

  /* ---------- start ---------- */
  /* The strip lives in the open room above the fold. Past that the content
     bands are over it, and a bright strip behind an 84%-opaque band is a ghost
     with a hard edge — the artifact this whole change set out to remove. */
  function coverNow() {
    var band = $(".band");
    if (!band) return 0;
    var top = band.getBoundingClientRect().top + window.scrollY;
    return Math.max(0, Math.min(1, window.scrollY / Math.max(top, 1)));
  }
  window.addEventListener("scroll", function () {
    var c = coverNow();
    if (room) room.setCover(c);
    /* The same number, read the other way round. It tells the room how much of
       its light the page has taken and tells the page how much it has been
       given, so the light hands over instead of going out. */
    if (paper) paper.setCover(c);
  }, { passive: true });

  function ensureRoom() {
    if (room || reduced) return;
    room = createRoom($(".room"));   // null if WebGL is unavailable
    /* A page loaded mid-scroll — a refresh, or a #segments deep link — starts
       correct rather than fading the strip out after the first frame. */
    if (room) room.setCover(coverNow());
    /* Only ever built on top of a room that exists. With no WebGL there is no
       canvas to blit and nothing to catch, and the page stays exactly as it is
       rather than growing an empty layer over every band. */
    if (room && room.canvas) {
      paper = createPaperLight($$(".band"), room.canvas);
      if (paper) paper.setCover(coverNow());
    }
  }

  wireAssets();
  setLive(false);
  load();
  setInterval(load, 180000);
  loadListening();
  setInterval(loadListening, 30000);
  setInterval(tick, 1000);
  setInterval(loadWeather, 900000);
  /* Catch up the moment the tab comes back: throttled timers in a hidden tab
     otherwise leave a stale clock on screen for up to a minute. */
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) { tick(); loadListening(); load(); }
  });
  coldOpen();
  bandReveals();
})();
