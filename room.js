/* ============================================================
   NIGHT SERVICE — the room (WebGL).

   A broadcast booth lit by three real things:
     · the window — position from true solar azimuth, intensity and
       colour from true solar altitude. Weather lands on its glass.
     · the tungsten desk lamp — rises as the sun goes down.
     · the prism — a still strip of split light, cast by whichever of
       the other two is lighting the room, carrying the colours of the
       record now playing. Plus a weak motionless lean in the walls,
       which is what the record is while the strip is absent.

   Nothing here is drawn as an object. The window is light with a
   soft rectangular falloff, not a picture of a window; drawing the
   frame would be the pastiche this world refuses. The prism is never
   depicted either — only what it does to the light that reaches it.

   Returns null when WebGL is unavailable so the caller can fall
   back to the CSS gradient.
   ============================================================ */
import { WASH, STRIP, orderByHue } from "./light.js";

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
  "uniform vec3 uWash; uniform vec3 uWash2; uniform vec3 uWash3;",   // the sleeve, hue-ordered across the strip
  "uniform vec3 uLean; uniform float uWashI;",   // the sleeve's dominant colour, and whether a record is on
  "uniform float uCover;",           // how much of the room the page has scrolled over
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

  /* ---- the record, as a lean in the walls.
     Normalised to unit luminance before tinting. Multiplying the room by a raw
     sleeve colour just darkens it — a navy cover turned the room muddy instead
     of blue. Dividing out the colour's own brightness leaves hue and satura-
     tion, so the room shifts colour while holding its light.

     The divisor guards against zero and nothing else. It clamped at 0.05 until
     a sweep caught what that cost: a sleeve darker than luma 0.05 had its
     ratios flattened toward 1, so dark covers dimmed the room instead of
     colouring it — the exact opposite of the paragraph above. light.js carries
     the full diagnosis. The clamp below already bounds the near-black case the
     floor was guarding.

     Flat and motionless on purpose. This is the record's standing presence,
     felt rather than seen; the strip is what it actually looks like. What used
     to be here was an fbm field drifting on the wind, and viewport-scale
     colour moving behind text is impossible to stop reading. */
  "  float ll = max(luma(uLean), 0.0001);",
  "  vec3 lw = clamp(mix(vec3(1.0), uLean/ll, " + f(WASH.temper) + "), vec3(0.38), vec3(1.75));",
  "  col = mix(col, col*lw, uWashI * " + f(WASH.lean) + ");",

  /* ---- and as a strip of split light.
     Something with a bevelled edge is sitting in the room's light. The record
     is what that light breaks into: the three colours across the strip's width
     are the sleeve's own, laid warm edge to cool edge by orderByHue(). What
     reads as refraction is separation, not a manufactured spectrum.

     There is no uTime term in here, and there must not be. A bright band on a
     wall is furniture; a moving field is weather, and the eye cannot stop
     reading weather. That is what the old wash got wrong. */
  "  float sun = uWinI * (1.0 - uCloud);",
  "  float lampw = uWarmI * " + f(STRIP.LAMP_W) + ";",
  "  float stripI = uWashI * max(sun, lampw) * (1.0 - uCover);",
  "  if (stripI > 0.002) {",
  /* Cast by whichever source is actually lighting the room, so the handoff
     from window to lamp happens on its own through dusk with nothing
     scheduling it. */
  "    float toLamp = lampw / (sun + lampw + 1e-4);",
  "    vec2 src = mix(uWin, lp, toLamp);",
  /* The cast angle rotates with the window's position, so the strip sweeps as
     the sun crosses — a second clock, as the window already is. */
  "    float ang = mix(" + f(-STRIP.ANG) + ", " + f(STRIP.ANG) + ", uWin.x);",
  "    vec2 dir = vec2(cos(ang), sin(ang));",
  "    vec2 nrm = vec2(-dir.y, dir.x);",
  /* Thrown away from the caster: down from the window, up from the lamp. The
     same toLamp that chose the source chooses the side, so the strip crosses
     the wall as the room hands over at dusk rather than jumping. */
  "    vec2 sc0 = src + nrm * mix(" + f(-STRIP.THROW) + ", " + f(STRIP.THROW) + ", toLamp);",
  /* …held clear of the plate. A morning window is behind the plate and so is
     what it casts; see STRIP.CLEAR for what this costs and why it is paid. */
  "    sc0.x = max(sc0.x, " + f(STRIP.CLEAR) + ");",
  /* The pointer moves it last, so the clamp above cannot flatten the sideways
     component — and so the lamp gets parallax too, which it did not when this
     rode on uWin and toLamp faded it to nothing after dark. */
  "    sc0 += par * vec2(" + f(STRIP.PAR_X) + ", " + f(STRIP.PAR_Y) + ");",
  "    vec2 sp = vec2((uv.x-sc0.x)*asp, uv.y-sc0.y);",
  "    float across = dot(sp, nrm), along = dot(sp, dir);",
  /* A flat-topped plateau, not a gaussian: a gaussian peaks at the centre,
     which would leave the two edge colours dim and defeat the separation the
     whole strip exists to show. */
  "    float plateau = 1.0 - smoothstep(" + f(STRIP.W * 0.55) + ", " + f(STRIP.W) + ", abs(across));",
  "    float taper = 1.0 - smoothstep(" + f(STRIP.L * 0.45) + ", " + f(STRIP.L) + ", abs(along));",
  /* Caustic nodes — a real strip is not evenly lit along its length. Static:
     the noise is read at a fixed position, never advanced. */
  "    float nodes = " + f(STRIP.NODE_FLOOR) + " + " + f(STRIP.NODE_VAR) + "*noise(vec2(along*" + f(STRIP.NODE_FREQ) + ", 3.7));",
  /* The spectral axis is the strip's width, not its length. Blends between
     the stops are mixes of two cover colours, so nothing outside the sleeve's
     own palette is ever drawn. */
  "    float s = clamp(across/" + f(STRIP.W) + "*0.5 + 0.5, 0.0, 1.0);",
  "    vec3 sc = s < 0.5 ? mix(uWash, uWash2, s*2.0) : mix(uWash2, uWash3, (s-0.5)*2.0);",
  /* Divided by its own luminance raised to NORM, so a dark record throws a
     dark strip. At NORM = 1 this was full normalisation and every sleeve threw
     the same amount of light — a dark near-neutral cover arrived on the wall
     as pale grey, which reads as nothing to do with the record. See
     STRIP.NORM; light.js/stripColor() is the same maths, and the sweep holds
     it to being monotonic in the sleeve's own brightness.

     Then a per-channel ceiling, because normalising is not unit channels — a
     saturated red reaches 3.34 in red and would blow the wall out. The divisor
     guards against zero and nothing else; it clamped at 0.05 in an earlier
     draft, which made dark sleeves dim the room instead of colouring it. */
  /* The shared neutral comes out first — see STRIP.PURITY. Without it a dark
     cool sleeve added light that desaturated the warm wall and the band landed
     paler than the room around it. What is left is the sleeve's own hue, only
     purer, which is what a prism returns. */
  "    sc -= min(min(sc.r, sc.g), sc.b) * " + f(STRIP.PURITY) + ";",
  "    sc = min(sc / pow(max(luma(sc), 0.0001), " + f(STRIP.NORM) + "), vec3(" + f(STRIP.CH_MAX) + "));",
  "    col += sc * plateau * taper * nodes * stripI * " + f(STRIP.GAIN) + ";",
  "  }",

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
    wash2: u("uWash2"), wash3: u("uWash3"), lean: u("uLean"), cover: u("uCover"),
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
    warm: [0, 0, 0], warmI: 0, wash: [0, 0, 0], wash2: [0, 0, 0], wash3: [0, 0, 0],
    lean: [0, 0, 0], washI: 0, cover: 0,
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
    if (immediate) cur = JSON.parse(JSON.stringify(tgt));
  }
  function setWeather(w) {
    tgt.cloud = w.cloud || 0; tgt.wet = w.wet || 0;
    tgt.fog = w.fog || 0; tgt.haze = w.haze || 0;
    if (w.wind) tgt.wind = w.wind.slice();
  }
  /* null → no usable colour in the sleeve; decay back to the room's own light.

     Two orderings, because they answer different questions. The lean wants the
     cover's *dominant* colour, which is the order albumPalette returns. The
     strip wants them laid warm edge to cool edge, which is orderByHue's. */
  function setWash(colors, amount) {
    if (!colors || !colors.length) { tgt.washI = 0; return; }
    var o = orderByHue(colors);
    tgt.lean = colors[0].slice();
    tgt.wash = o[0].slice();
    tgt.wash2 = (o[1] || o[0]).slice();
    tgt.wash3 = (o[2] || o[1] || o[0]).slice();
    tgt.washI = typeof amount === "number" ? amount : 1;
  }

  /* How much of the room the page has scrolled over. The strip fades out under
     the content bands rather than ghosting through them at BAND_ALPHA and
     being cut by a band edge — which is what made the old wash read as glass. */
  function setCover(v) { tgt.cover = v < 0 ? 0 : v > 1 ? 1 : v; }

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
    ease3(cur.wash3, tgt.wash3, 0.03); ease3(cur.lean, tgt.lean, 0.03);
    cur.winI = ease(cur.winI, tgt.winI, 0.035);
    cur.warmI = ease(cur.warmI, tgt.warmI, 0.035);
    cur.washI = ease(cur.washI, tgt.washI, 0.035);     // the record fades in and out slowly
    /* Faster than the sun eases, because this one tracks the scrollbar. */
    cur.cover = ease(cur.cover, tgt.cover, 0.15);
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
    gl.uniform3fv(U.wash3, cur.wash3);
    gl.uniform3fv(U.lean, cur.lean);
    gl.uniform1f(U.cover, cur.cover);
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

  return { setLight: setLight, setWeather: setWeather, setWash: setWash, setCover: setCover, canvas: canvas };
}
