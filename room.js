/* ============================================================
   NIGHT SERVICE — the room (WebGL).

   A broadcast booth lit by three real things:
     · the window — position from true solar azimuth, intensity and
       colour from true solar altitude. Weather lands on its glass.
     · the tungsten desk lamp — rises as the sun goes down.
     · the turntable wash — colour thrown by the record now playing.

   Nothing here is drawn as an object. The window is light with a
   soft rectangular falloff, not a picture of a window; drawing the
   frame would be the pastiche this world refuses.

   Returns null when WebGL is unavailable so the caller can fall
   back to the CSS gradient.
   ============================================================ */
import { WASH } from "./light.js";

var VERT =
  "attribute vec2 aPos; varying vec2 vUv;" +
  "void main(){ vUv = aPos*0.5+0.5; gl_Position = vec4(aPos,0.0,1.0); }";

/* The wash constants are the model's, not the shader's. They were written out
   here as literals once and drifted from light.js within a week; scripts/
   check-contrast.mjs then proved a room the shader was not drawing. */
function f(x) { return x.toFixed(5); }

var FRAG = [
  "precision highp float;",
  "varying vec2 vUv;",
  "uniform vec2 uRes; uniform float uTime; uniform vec2 uMouse;",
  "uniform vec2 uWin;",              // window centre, uv space
  "uniform float uWinI;",            // window intensity, 0..1
  "uniform vec3 uLight;",            // colour arriving through the glass
  "uniform vec3 uRoom;",             // ambient wall, cloud already in it
  "uniform vec3 uWarm; uniform float uWarmI;",   // tungsten lamp
  "uniform vec3 uWash; uniform vec3 uWash2; uniform float uWashI;",   // the record's colours
  "uniform float uWashGain;",        // what the sun makes the record pay
  "uniform float uCloud, uWet, uFog, uHaze;",
  "uniform vec2 uWind;",

  "float luma(vec3 c){ return dot(c, vec3(0.299,0.587,0.114)); }",
  "float hash(vec2 p){ p=fract(p*vec2(123.34,345.45)); p+=dot(p,p+34.345); return fract(p.x*p.y); }",
  "float noise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);",
  "  float a=hash(i),b=hash(i+vec2(1.0,0.0)),c=hash(i+vec2(0.0,1.0)),d=hash(i+vec2(1.0,1.0));",
  "  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y); }",
  "float fbm(vec2 p){ float v=0.0,a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p=p*2.03+vec2(1.7,9.2); a*=0.5; } return v; }",

  "void main(){",
  "  vec2 uv = vUv;",
  "  float asp = uRes.x/uRes.y;",
  "  vec2 par = (uMouse-0.5)*0.05;",                       // the room shifts a little as you move
  "  float t = uTime*0.02;",

  /* ---- the wall, brighter toward the ceiling.
     uRoom already carries the weather: cloudedRoom() in light.js flattens and
     cools the ambient before it gets here, because an overcast midday is not a
     sunlit room with a duller window — the whole space goes grey. It is done
     in the model rather than in this shader so the same room the visitor sees
     is the room check-contrast.mjs reads the text against. */
  "  vec3 col = uRoom * mix(0.70, 1.10, smoothstep(0.0, 0.88, uv.y));",

  // ---- light arriving through the glass, muted and dimmed by cloud
  "  vec3 lightCol = uLight;",
  "  lightCol = mix(lightCol, vec3(luma(lightCol)), uCloud*0.60);",
  "  float lightI = uWinI * (1.0 - uCloud*0.34);",

  // ---- the window: a soft rectangle plus a broad spill into the room
  "  vec2 wc = uWin + par;",
  "  vec2 dp = vec2((uv.x-wc.x)*asp, uv.y-wc.y);",
  "  vec2 d  = abs(dp);",
  "  float breath = 1.0 + 0.03*sin(uTime*0.11);",
  "  float pane = (1.0 - smoothstep(0.11, 0.33*breath, d.x)) * (1.0 - smoothstep(0.14, 0.38*breath, d.y));",
  "  float spill = exp(-length(dp) * 1.85);",
  /* Humid air scatters. The spill loses its edge and carries further into the
     room — this is what relative_humidity_2m is for, and it is the difference
     between a clear winter light and the same sun through August air. */
  "  spill = mix(spill, pow(spill, 0.68), uHaze);",
  /* A bright room is already the daylight; adding the window's spill at full
     strength on top of it double-counts and washes the walls out to white.
     Damp the addition by how lit the room already is, so the pane still blows
     out but the room keeps its colour. */
  "  float add = 1.0 - clamp(luma(uRoom)*1.15, 0.0, 0.85);",
  "  float thrown = pane*0.80 + spill*0.55;",
  /* ---- rain, in the room rather than on the glass.
     Streaks on the pane are a picture of rain. What makes a space read as wet
     is that its light stops being still, and that has to happen twice over.

     Water crossing the glass drags the throw, which is what gives the near
     wall its churn — but the throw decays exponentially, so on its own the far
     side of the room stayed dry while it poured. So the same field also scales
     the finished room: the only window in here is being rained on, and the
     whole light level goes with it. One noise, read at two reaches. */
  "  float run = 0.0;",
  "  if (uWet > 0.002) {",
  "    vec2 rq = vec2(dp.x*3.2, dp.y*1.15 - uTime*0.09) + uWind*t*2.0;",
  "    run = (fbm(rq*2.4) - 0.5) * uWet;",
  "    thrown *= 1.0 + run*1.10;",
  "  }",
  "  col += lightCol * thrown * lightI * add;",
  // and the veil of scattered light the damp air itself is lit by
  "  col += lightCol * lightI * uHaze * 0.05;",
  "  col *= 1.0 + run*0.22;",

  // ---- weather, on the glass only
  "  if (pane > 0.002) {",
  "    float g = dot(col, vec3(0.333));",
  "    col = mix(col, mix(col, vec3(g), 0.55) + lightCol*0.05, uFog*pane*0.85);",
  "    vec2 rp = vec2(uv.x*asp, uv.y)*vec2(64.0, 7.0) + vec2(uWind.x*2.2, -1.0)*uTime*1.7;",
  "    float streak = smoothstep(0.87, 1.0, fract(noise(rp)*1.7));",
  "    col += lightCol * streak * uWet * pane * 0.30;",
  "  }",

  // ---- the desk lamp, low and warm, strongest after dark.
  //      Sits right of centre: the plate occupies the left of the viewport, and
  //      a lamp behind it is a light source nobody ever sees.
  //      A flat-topped, long-tailed falloff rather than exp(): an exponential
  //      peaks hard at the centre, which is what made this read as a bright
  //      radial blob instead of a room with a lamp in it.
  "  vec2 lp = vec2(0.74, 0.17);",
  "  float ld = length(vec2((uv.x-lp.x)*asp, uv.y-lp.y));",
  "  float lamp = 1.0 / (1.0 + ld*ld*2.4);",
  "  col += uWarm * lamp * uWarmI * 0.30;",

  // ---- the record's colour, drifting on the wind
  "  vec2 q = vec2((uv.x-0.5)*asp, uv.y-0.5)*1.15 + par*0.6;",
  "  vec2 warp = vec2(fbm(q + vec2(0.0, t)), fbm(q + vec2(4.3, -t*0.9)));",
  "  float field = fbm(q*0.90 + warp*1.2 + uWind*t*1.4);",
  /* A floor under the pool so the record always colours the whole room, with
     the noise varying how strongly rather than whether. */
  "  float pool = " + f(WASH.poolMin) + " + " + f(1 - WASH.poolMin) + "*smoothstep(0.24, 0.90, field);",
  /* Two sleeve colours drift against each other so the wash has internal
     movement instead of one flat cast. */
  "  float blend = smoothstep(0.26, 0.80, fbm(q*1.55 - warp*0.7 + vec2(t*1.2, -t*0.7)));",
  "  vec3 washCol = mix(uWash, uWash2, blend);",
  /* Normalised to unit luminance before tinting. Multiplying the room by a raw
     sleeve colour just darkens it — a navy cover turned the room muddy instead
     of blue. Dividing out the colour's own brightness leaves hue and satura-
     tion, so the room shifts colour while holding its light. */
  "  float wl = max(luma(washCol), 0.05);",
  "  vec3 w = clamp(mix(vec3(1.0), washCol/wl, " + f(WASH.temper) + "), vec3(0.38), vec3(1.75));",
  /* uWashGain is washGain(altitude): the sun is more light than a sleeve is,
     and a tint set to read after dark is invisible at noon.

     It lifts the tint and only the tint. The glow below is additive, and
     additive light on an already-bright room is exactly what blows out —
     gained, a saturated sleeve at midday turned the walls into white swirls
     instead of colouring them. The tint is a ratio and survives daylight
     honestly; the glow is for after dark and stays there. */
  "  col = mix(col, col * w, min(pool * uWashI * uWashGain * " + f(WASH.tint) + ", " + f(WASH.tintMax) + "));",
  "  col += washCol * pool * uWashI * " + f(WASH.add) + ";",

  /* ---- rain again, last: wet air takes the warmth back out of whatever the
     window, the lamp and the record have put in the room. */
  "  col = mix(col, vec3(luma(col)) * vec3(0.90, 0.98, 1.16), uWet*0.20);",

  // ---- the room falls off at the corners, then grain
  "  float vig = smoothstep(1.20, 0.34, length(uv-vec2(0.5,0.46)));",
  "  col *= mix(0.80, 1.05, vig);",
  "  float gr = hash(uv*uRes + fract(uTime));",
  "  col += (gr-0.5)*0.020;",
  "  gl_FragColor = vec4(col, 1.0);",
  "}"
].join("\n");

export function createRoom(host) {
  if (!host) return null;
  var canvas = document.createElement("canvas");
  canvas.className = "room__gl";
  var gl = canvas.getContext("webgl", { antialias: false, alpha: false, depth: false, powerPreference: "low-power" })
        || canvas.getContext("experimental-webgl");
  if (!gl) return null;

  function sh(type, src) {
    var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn("room shader:", gl.getShaderInfoLog(s)); return null; }
    return s;
  }
  var vs = sh(gl.VERTEX_SHADER, VERT), fs = sh(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;
  var prog = gl.createProgram();
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.warn("room link:", gl.getProgramInfoLog(prog)); return null; }
  gl.useProgram(prog);

  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  var aPos = gl.getAttribLocation(prog, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  function u(n) { return gl.getUniformLocation(prog, n); }
  var U = {
    res: u("uRes"), time: u("uTime"), mouse: u("uMouse"),
    win: u("uWin"), winI: u("uWinI"), light: u("uLight"), room: u("uRoom"),
    warm: u("uWarm"), warmI: u("uWarmI"), wash: u("uWash"), washI: u("uWashI"),
    wash2: u("uWash2"), washGain: u("uWashGain"),
    cloud: u("uCloud"), wet: u("uWet"), fog: u("uFog"), haze: u("uHaze"), wind: u("uWind")
  };

  /* Appended last, and the CSS layers are switched off, because .room__fallback
     always carries a gradient. Inserting the canvas first put an opaque div on
     top of it and hid the entire shader. */
  host.appendChild(canvas);
  host.classList.add("has-gl");

  var SCALE = 0.66;   // soft light reads fine at low internal resolution
  function resize() {
    var w = host.clientWidth || window.innerWidth, h = host.clientHeight || window.innerHeight;
    canvas.width = Math.max(2, Math.round(w * SCALE));
    canvas.height = Math.max(2, Math.round(h * SCALE));
    canvas.style.width = w + "px"; canvas.style.height = h + "px";
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  resize();
  window.addEventListener("resize", resize);

  /* Everything eases toward a target. The sun really does move, so nothing
     here ever snaps except the very first frame. */
  var cur = {
    win: [0.5, 0.6], winI: 0, light: [0, 0, 0], room: [0, 0, 0],
    warm: [0, 0, 0], warmI: 0, wash: [0, 0, 0], wash2: [0, 0, 0], washI: 0, washGain: 1,
    cloud: 0, wet: 0, fog: 0, haze: 0, wind: [0, 0]
  };
  var tgt = JSON.parse(JSON.stringify(cur));

  function setLight(s, immediate) {
    if (s.win) tgt.win = s.win.slice();
    if (s.light) tgt.light = s.light.slice();
    if (s.room) tgt.room = s.room.slice();
    if (s.warm) tgt.warm = s.warm.slice();
    if (typeof s.winI === "number") tgt.winI = s.winI;
    if (typeof s.warmI === "number") tgt.warmI = s.warmI;
    if (typeof s.washGain === "number") tgt.washGain = s.washGain;
    if (immediate) cur = JSON.parse(JSON.stringify(tgt));
  }
  function setWeather(w) {
    tgt.cloud = w.cloud || 0; tgt.wet = w.wet || 0;
    tgt.fog = w.fog || 0; tgt.haze = w.haze || 0;
    if (w.wind) tgt.wind = w.wind.slice();
  }
  /* null → no usable colour in the sleeve; decay back to the room's own light. */
  function setWash(colors, amount) {
    if (!colors || !colors.length) { tgt.washI = 0; return; }
    tgt.wash = colors[0].slice();
    tgt.wash2 = (colors[1] || colors[0]).slice();
    tgt.washI = typeof amount === "number" ? amount : 1;
  }

  var mx = 0.5, my = 0.5, tmx = 0.5, tmy = 0.5;
  window.addEventListener("pointermove", function (e) {
    tmx = e.clientX / window.innerWidth;
    tmy = 1.0 - e.clientY / window.innerHeight;
  }, { passive: true });

  function ease(a, b, k) { return a + (b - a) * k; }
  function ease3(a, b, k) { for (var i = 0; i < 3; i++) a[i] = ease(a[i], b[i], k); }
  function ease2(a, b, k) { for (var i = 0; i < 2; i++) a[i] = ease(a[i], b[i], k); }

  var lit = false;
  var start = performance.now();
  function frame(now) {
    var t = (now - start) / 1000;
    ease2(cur.win, tgt.win, 0.03);
    ease3(cur.light, tgt.light, 0.035); ease3(cur.room, tgt.room, 0.035);
    ease3(cur.warm, tgt.warm, 0.035);
    ease3(cur.wash, tgt.wash, 0.03); ease3(cur.wash2, tgt.wash2, 0.03);
    cur.winI = ease(cur.winI, tgt.winI, 0.035);
    cur.warmI = ease(cur.warmI, tgt.warmI, 0.035);
    cur.washI = ease(cur.washI, tgt.washI, 0.035);     // the record fades in and out slowly
    cur.washGain = ease(cur.washGain, tgt.washGain, 0.035);
    cur.cloud = ease(cur.cloud, tgt.cloud, 0.03);
    cur.wet = ease(cur.wet, tgt.wet, 0.03);
    cur.fog = ease(cur.fog, tgt.fog, 0.03);
    cur.haze = ease(cur.haze, tgt.haze, 0.03);
    ease2(cur.wind, tgt.wind, 0.02);
    mx = ease(mx, tmx, 0.06); my = ease(my, tmy, 0.06);

    gl.uniform2f(U.res, canvas.width, canvas.height);
    gl.uniform1f(U.time, t);
    gl.uniform2f(U.mouse, mx, my);
    gl.uniform2fv(U.win, cur.win);
    gl.uniform1f(U.winI, cur.winI);
    gl.uniform3fv(U.light, cur.light);
    gl.uniform3fv(U.room, cur.room);
    gl.uniform3fv(U.warm, cur.warm);
    gl.uniform1f(U.warmI, cur.warmI);
    gl.uniform3fv(U.wash, cur.wash);
    gl.uniform3fv(U.wash2, cur.wash2);
    gl.uniform1f(U.washI, cur.washI);
    gl.uniform1f(U.washGain, cur.washGain);
    gl.uniform1f(U.cloud, cur.cloud);
    gl.uniform1f(U.wet, cur.wet);
    gl.uniform1f(U.fog, cur.fog);
    gl.uniform1f(U.haze, cur.haze);
    gl.uniform2fv(U.wind, cur.wind);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    /* Only after a frame actually exists, or the crossfade would reveal an
       empty canvas. */
    if (!lit) { lit = true; host.classList.add("is-lit"); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return { setLight: setLight, setWeather: setWeather, setWash: setWash, canvas: canvas };
}
