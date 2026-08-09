/* ============================================================
   NIGHT SERVICE — light on the page.

   The room is behind the content. The bands are paper laid over it, and
   until now the only thing that happened where they met was that the light
   gave up: uCover fades the strip out as the page scrolls over it, so the
   record's colour dies the moment the reading surface arrives.

   This makes the paper a surface in the room instead. The same rendered
   light, blitted into each band in register with the room behind it, so a
   strip crossing the panel's edge continues across it rather than stopping
   at it. As the page covers the room the light hands over — off the wall,
   onto the page — rather than fading out.

   Nothing is redrawn. This is one texture blit per band per frame from the
   canvas room.js already rendered, not a second pass over the shader. The
   room runs at SCALE 0.66 with powerPreference "low-power" for reasons that
   still apply.

   ---- why it is beneath the ink, and why it only lightens ----

   Both of those are the accessibility argument, not taste.

   Beneath the ink: an overlay above the text lightens the text. Ink sits near
   0.01 relative luminance, and a 16% screen lifts it to ~0.16 — the contrast
   the sweep proves would be gone, silently, on a page that treats that proof
   as checked rather than claimed. Underneath, the paper brightens and the ink
   is untouched, which is also what light does to print: the sheet takes it,
   the ink absorbs it.

   Only lightens: screen cannot lower luminance. Every checked pair is dark on
   paper, and contrast is monotonic in the lighter colour, so raising the paper
   while holding the ink can only raise every ratio. That is what keeps the
   existing sweep valid instead of needing it re-derived — and it is why the
   blend mode is asserted in check-contrast.mjs rather than left as a comment
   for someone to later swap for soft-light, which would quietly invert it.
   ============================================================ */

/* How much of the room's light the paper takes at full handover. Set from
   looking. Past ~0.3 the paper stops reading as paper and starts reading as a
   screen showing the room, which is the wrong side of the line this whole
   world sits on. */
export var LIFT = 0.17;

/* What the paper takes before the page has covered anything. Not zero: a
   sheet on a lit desk is already catching the room. The handover runs from
   here to LIFT, so at rest the effect is present but quiet, and scrolling
   deepens it rather than switching it on. */
export var LIFT_REST = 0.06;

/* Internal resolution, as a fraction of the band's CSS size. The source is
   already a 0.66-scale render of a soft-edged room, so sampling it finer than
   this buys nothing but memory. */
var SCALE = 0.5;

export function createPaperLight(bands, glCanvas) {
  if (!bands || !bands.length || !glCanvas) return null;

  var layers = [];
  for (var i = 0; i < bands.length; i++) {
    var band = bands[i];
    var cv = document.createElement("canvas");
    cv.className = "band__light";
    cv.setAttribute("aria-hidden", "true");
    var ctx = cv.getContext("2d", { alpha: true });
    if (!ctx) return null;
    band.insertBefore(cv, band.firstChild);
    layers.push({ band: band, cv: cv, ctx: ctx, w: 0, h: 0 });
  }

  var cover = 0;
  function setCover(v) { cover = v < 0 ? 0 : v > 1 ? 1 : v; }

  function resize(L) {
    var r = L.band.getBoundingClientRect();
    var w = Math.max(1, Math.round(r.width * SCALE));
    var h = Math.max(1, Math.round(r.height * SCALE));
    if (w !== L.w || h !== L.h) { L.cv.width = w; L.cv.height = h; L.w = w; L.h = h; }
    return r;
  }

  /* The blit. The room canvas covers the viewport, so drawing it at the band's
     negative offset puts its pixels exactly where they would be if the band
     were transparent — which is what makes the light continue across the
     panel's edge instead of restarting inside it. */
  function draw() {
    var vw = window.innerWidth, vh = window.innerHeight;
    var lift = LIFT_REST + (LIFT - LIFT_REST) * cover;
    for (var i = 0; i < layers.length; i++) {
      var L = layers[i];
      var r = resize(L);
      // Off screen entirely — nothing to catch, and nothing to pay for.
      if (r.bottom < 0 || r.top > vh || L.w < 2) { L.cv.style.opacity = "0"; continue; }
      L.cv.style.opacity = String(lift);
      var sx = L.w / r.width, sy = L.h / r.height;
      L.ctx.clearRect(0, 0, L.w, L.h);
      L.ctx.drawImage(glCanvas, -r.left * sx, -r.top * sy, vw * sx, vh * sy);
    }
  }

  var raf = 0;
  function frame() { raf = requestAnimationFrame(frame); draw(); }
  frame();

  return {
    setCover: setCover,
    stop: function () { cancelAnimationFrame(raf); raf = 0; },
    layers: layers
  };
}
