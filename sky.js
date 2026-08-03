/* ============================================================
   NOW — living sky (WebGL).
   A morphing grainy gradient field: domain-warped flow noise →
   a color ramp built from the time-of-day palette → in-shader
   film grain. A slow "breath" pulse animates on its own; the
   cursor drives depth parallax between near and far noise layers.
   Colors cross-fade when the phase changes. Returns null if WebGL
   is unavailable so the caller can fall back to the CSS gradient.
   ============================================================ */

var VERT =
  "attribute vec2 aPos; varying vec2 vUv;" +
  "void main(){ vUv = aPos*0.5+0.5; gl_Position = vec4(aPos,0.0,1.0); }";

var FRAG = [
  "precision highp float;",
  "varying vec2 vUv;",
  "uniform vec2 uRes; uniform float uTime; uniform vec2 uMouse;",
  "uniform vec3 uC0, uC1, uC2;",
  "uniform float uCloud, uWet, uFog;",   // weather: cloud cover, wetness, fog (0..1)
  "float hash(vec2 p){ p=fract(p*vec2(123.34,345.45)); p+=dot(p,p+34.345); return fract(p.x*p.y); }",
  "float noise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);",
  "  float a=hash(i),b=hash(i+vec2(1.0,0.0)),c=hash(i+vec2(0.0,1.0)),d=hash(i+vec2(1.0,1.0));",
  "  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y); }",
  "float fbm(vec2 p){ float v=0.0,a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p=p*2.03+vec2(1.7,9.2); a*=0.5; } return v; }",
  "void main(){",
  "  vec2 uv = vUv;",
  "  float aspect = uRes.x/uRes.y;",
  "  vec2 p = vec2(uv.x*aspect, uv.y);",
  "  vec2 m = uMouse - 0.5;",
  "  float t = uTime*0.025;",
  "  float breath = 1.0 + 0.05*sin(uTime*0.16);",                 // autonomous breathing
  "  vec2 q = p*breath*1.1;",
  "  vec2 warp = vec2( fbm(q + vec2(0.0, t)), fbm(q + vec2(4.3, -t*0.9)) );",   // the morph
  "  float nNear = fbm(q*1.25 + warp*1.3 - m*0.14 + t*0.6);",   // near layer: parallax x mouse
  "  float nFar  = fbm(q*0.60 + warp*0.5 - m*0.05 - t*0.4);",   // far layer: less parallax
  "  float field = mix(nFar, nNear, 0.6);",
  "  vec3 col = mix(uC0, uC1, smoothstep(0.15, 0.95, field));",
  "  float bloom = pow(smoothstep(0.62, 1.0, nNear), 2.0);",    // warm accent pockets
  "  col = mix(col, uC2, bloom*0.45);",
  "  float vig = smoothstep(1.15, 0.35, length(uv-0.5));",       // soft vignette
  "  col *= mix(0.82, 1.06, vig);",
  // weather (subtle, color only) layered over the time-of-day color
  "  float L = dot(col, vec3(0.299,0.587,0.114));",
  "  col = mix(col, vec3(L), uCloud*0.55);",                     // overcast → desaturate
  "  col *= (1.0 - uCloud*0.12);",                               //          → slightly dim
  "  col = mix(col, col*vec3(0.62,0.66,0.72), uWet*0.5);",       // rain → cool it
  "  col *= (1.0 - uWet*0.08);",
  "  col = mix(col, mix(col, vec3(0.70,0.72,0.75), 0.5), uFog*0.6);", // fog → pale haze
  "  float g = hash(uv*uRes + fract(uTime));",                   // light film grain (reduced)
  "  col += (g-0.5)*0.02;",
  "  gl_FragColor = vec4(col, 1.0);",
  "}"
].join("\n");

export function createSky(host) {
  if (!host) return null;
  var canvas = document.createElement("canvas");
  canvas.className = "sky__gl";
  var gl = canvas.getContext("webgl", { antialias: false, alpha: false, depth: false, powerPreference: "low-power" })
        || canvas.getContext("experimental-webgl");
  if (!gl) return null;

  function sh(type, src) {
    var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn("sky shader:", gl.getShaderInfoLog(s)); return null; }
    return s;
  }
  var vs = sh(gl.VERTEX_SHADER, VERT), fs = sh(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;
  var prog = gl.createProgram();
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.warn("sky link:", gl.getProgramInfoLog(prog)); return null; }
  gl.useProgram(prog);

  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  var aPos = gl.getAttribLocation(prog, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  var U = {
    res: gl.getUniformLocation(prog, "uRes"), time: gl.getUniformLocation(prog, "uTime"),
    mouse: gl.getUniformLocation(prog, "uMouse"),
    c0: gl.getUniformLocation(prog, "uC0"), c1: gl.getUniformLocation(prog, "uC1"), c2: gl.getUniformLocation(prog, "uC2"),
    cloud: gl.getUniformLocation(prog, "uCloud"), wet: gl.getUniformLocation(prog, "uWet"), fog: gl.getUniformLocation(prog, "uFog")
  };

  host.insertBefore(canvas, host.firstChild);   // behind grain/vignette/motes; over the CSS fallback

  var SCALE = 0.66;   // soft blobs read fine at low internal resolution → cheap
  function resize() {
    var w = host.clientWidth || window.innerWidth, h = host.clientHeight || window.innerHeight;
    canvas.width = Math.max(2, Math.round(w * SCALE));
    canvas.height = Math.max(2, Math.round(h * SCALE));
    canvas.style.width = w + "px"; canvas.style.height = h + "px";
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  resize();
  window.addEventListener("resize", resize);

  var cur = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], tgt = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  function setPhase(cols, immediate) {
    tgt = [cols[0].slice(), cols[1].slice(), cols[2].slice()];
    if (immediate) cur = [tgt[0].slice(), tgt[1].slice(), tgt[2].slice()];
  }

  var wCur = { cloud: 0, wet: 0, fog: 0 }, wTgt = { cloud: 0, wet: 0, fog: 0 };
  function setWeather(w) {
    wTgt.cloud = w.cloud || 0; wTgt.wet = w.wet || 0; wTgt.fog = w.fog || 0;
  }

  var mx = 0.5, my = 0.5, tmx = 0.5, tmy = 0.5;
  window.addEventListener("pointermove", function (e) {
    tmx = e.clientX / window.innerWidth;
    tmy = 1.0 - e.clientY / window.innerHeight;
  }, { passive: true });

  var start = performance.now();
  function frame(now) {
    var t = (now - start) / 1000;
    for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) cur[i][j] += (tgt[i][j] - cur[i][j]) * 0.04; // color crossfade
    mx += (tmx - mx) * 0.06; my += (tmy - my) * 0.06;                                                    // smoothed parallax
    wCur.cloud += (wTgt.cloud - wCur.cloud) * 0.03;                                                       // weather eases in
    wCur.wet += (wTgt.wet - wCur.wet) * 0.03;
    wCur.fog += (wTgt.fog - wCur.fog) * 0.03;
    gl.uniform2f(U.res, canvas.width, canvas.height);
    gl.uniform1f(U.time, t);
    gl.uniform2f(U.mouse, mx, my);
    gl.uniform3fv(U.c0, cur[0]); gl.uniform3fv(U.c1, cur[1]); gl.uniform3fv(U.c2, cur[2]);
    gl.uniform1f(U.cloud, wCur.cloud); gl.uniform1f(U.wet, wCur.wet); gl.uniform1f(U.fog, wCur.fog);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return { setPhase: setPhase, setWeather: setWeather, canvas: canvas };
}
