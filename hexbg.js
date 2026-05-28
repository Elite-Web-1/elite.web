/* ─────────────────────────────────────────────────────────────
   Elite — Animated hex grid background + cursor glitch
   Canvas spans the whole document (position:absolute). Each section
   visually has its own portion of the continuous hex lattice behind it.

   Two interactive elements paint on the grid:
     • Cursor halo (blue) — gentle reach around the mouse.
     • Cursor glitch (magenta) — small square that lags behind the
       cursor with a minimum-distance constraint and "stains" the
       grid magenta wherever it passes. The magenta fades back to
       blue faster than the brightness decays, so the trail returns
       to the base color cleanly.

   Per frame we only redraw the visible viewport slice → constant
   cost regardless of page length.
   ───────────────────────────────────────────────────────────── */

(() => {
  'use strict';

  // 3D mode active → hexbg3d.js owns the background AND the
  // cursor-glitch element. Bail out completely to avoid running
  // two renderers + double-writing the glitch transform.
  if (window.__use3dBg) return;

  const canvas   = document.getElementById('hexBg');
  const glitchEl = document.getElementById('cursorGlitch');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  /* ── Capability detection ─────────────────────────────────
     Cheap matchMedia probes for: explicit reduced-motion
     preference, mobile-class viewport, and pointer hardware
     (touch-only devices have `any-hover: none`). We use these
     to scale the animation down — or skip it entirely — so the
     fan doesn't spin up on phones / older laptops. */
  const PREFERS_REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const IS_MOBILE       = window.matchMedia('(max-width: 900px)').matches;
  const HAS_HOVER       = window.matchMedia('(any-hover: hover)').matches;

  // ── Config ───────────────────────────────────────────────
  // Larger hexes on mobile → fewer cells to maintain and fewer
  // edges to iterate per frame for cursor/glitch proximity tests.
  const HEX_SIZE        = IS_MOBILE ? 52 : 36;
  const BASE_COLOR      = 'rgba(150, 160, 190, 0.05)';
  // Blue: #2196F3 — the rose logo's blue stop, vibrant for neon feel.
  const BLUE_R = 33, BLUE_G = 150, BLUE_B = 243;
  // Magenta: #E040FB — the rose logo's gradient endpoint.
  const VIO_R  = 224, VIO_G = 64,  VIO_B  = 251;

  const WALKER_SPEED    = 1.35;     // edges per second
  // Shorter trails — ~85% drop per second instead of ~30%, so the
  // blue cursor trail and the magenta glitch trail only "linger" for
  // about a second after touching an edge.
  const DECAY           = 0.965;
  // Magenta now lasts almost as long as the line itself so the
  // color shift is actually readable instead of flashing past.
  const VIOLET_DECAY    = 0.965;
  const MIN_INTENSITY   = 0.02;

  // The cursor halo is smaller than the glitch halo so the cursor
  // feels like a "focused dot" of blue light while the glitch leaves
  // a broader, more intrusive magenta stain.
  const CURSOR_RADIUS   = 50;       // blue cursor halo reach (smaller, focused)
  const CURSOR_STRENGTH = 0.7;

  const GLITCH_RADIUS   = 75;       // magenta glitch reach (broader)
  const GLITCH_STRENGTH = 1.0;      // saturated boost — edges directly under the glitch go full magenta
  // The glitch chases a DELAYED cursor position (~380ms ago) — that's
  // where the freshest part of the blue trail is. The lerp is high
  // (0.18) on purpose so the glitch *tracks the delayed target tightly*
  // along curves instead of cutting through their interior — that's
  // what makes it visibly follow the trail's actual path (circles,
  // arcs, S-curves), not just sit somewhere "behind".
  const TRAIL_DELAY_MS  = 380;
  const GLITCH_LERP     = 0.18;
  const GLITCH_MIN_DIST = 22;       // minimum gap from the delayed target
  const GLITCH_JITTER   = 1.0;

  // ── State ────────────────────────────────────────────────
  let W = 0, H = 0;
  let vertices  = [];      // { x, y, edges: [] }
  let edges     = [];      // { v1, v2, intensity, violet }
  let hexCenters = [];     // { x, y } — needed to render filled tiles
  let walkers   = [];
  let numWalkers = 9;
  let baseLayer = null;
  let lastTime  = 0;
  let resizeTimer = null;
  let pendingResize = false;

  // Mouse position. clientX/Y = viewport coords (where the cursor IS).
  // We derive doc-space coords as needed (clientY + scrollY).
  let mouseClientX = -1000, mouseClientY = -1000;
  let mouseInside = false;

  // Cursor position history (viewport coords + timestamp). The glitch
  // chases an entry from ~TRAIL_DELAY_MS ago — that's where the blue
  // trail "head" lives, so it looks like the glitch is hunting the trail.
  const mouseHistory = [];

  // Glitch position (viewport coords). Starts off-screen until first move.
  let glitchX = -1000, glitchY = -1000;
  let glitchInitialized = false;

  /* ── Point→segment distance ────────────────────────────── */
  function distToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - ax, py - ay);
    let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  /* ── Mouse / touch tracking ────────────────────────────── */
  function pushHistory(x, y) {
    const t = performance.now();
    mouseHistory.push({ x, y, t });
    // Prune entries older than 2× the delay (keeps the array small)
    const cutoff = t - TRAIL_DELAY_MS * 2;
    while (mouseHistory.length > 0 && mouseHistory[0].t < cutoff) {
      mouseHistory.shift();
    }
  }

  // Skip mouse tracking entirely on touch-only devices — there's no
  // hover cursor to follow, and listening to global mousemove on
  // touch screens just wastes CPU (phantom events from touch input).
  if (HAS_HOVER) {
  window.addEventListener('mousemove', (e) => {
    mouseClientX = e.clientX;
    mouseClientY = e.clientY;
    mouseInside  = true;
    pushHistory(e.clientX, e.clientY);
    if (!glitchInitialized) {
      // Snap the glitch to the cursor on first move so it doesn't
      // race in from the off-screen origin (-1000, -1000).
      glitchX = e.clientX;
      glitchY = e.clientY;
      glitchInitialized = true;
    }
  }, { passive: true });
  window.addEventListener('mouseleave', () => { mouseInside = false; });
  } /* end if (HAS_HOVER) — touch handlers below still work on all devices */
  window.addEventListener('touchmove', (e) => {
    if (e.touches.length > 0) {
      mouseClientX = e.touches[0].clientX;
      mouseClientY = e.touches[0].clientY;
      mouseInside  = true;
      pushHistory(mouseClientX, mouseClientY);
      if (!glitchInitialized) {
        glitchX = mouseClientX;
        glitchY = mouseClientY;
        glitchInitialized = true;
      }
    }
  }, { passive: true });
  window.addEventListener('touchend', () => {
    setTimeout(() => { mouseInside = false; }, 250);
  });

  /* ── Get the cursor's position from ~TRAIL_DELAY_MS ago ── */
  function getTrailTarget() {
    if (mouseHistory.length === 0) {
      return { x: mouseClientX, y: mouseClientY };
    }
    const targetTime = performance.now() - TRAIL_DELAY_MS;
    // Walk back from newest to find the most recent entry at-or-before
    // the target time. (History is small, ~30-60 entries max.)
    for (let i = mouseHistory.length - 1; i >= 0; i--) {
      if (mouseHistory[i].t <= targetTime) {
        return mouseHistory[i];
      }
    }
    // All entries are newer than the target — fall back to the oldest
    return mouseHistory[0];
  }

  /* ── Document height ───────────────────────────────────── */
  function getDocHeight() {
    return Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight,
      window.innerHeight
    );
  }

  /* ── Build hex lattice across the full document ────────── */
  function buildGrid() {
    vertices = [];
    edges = [];
    hexCenters = [];
    const vMap = new Map();
    const eMap = new Map();
    const hexW = HEX_SIZE * Math.sqrt(3);
    const hexH = HEX_SIZE * 2;
    const colSpacing = hexW;
    const rowSpacing = hexH * 0.75;
    const cols = Math.ceil(W / colSpacing) + 4;
    const rows = Math.ceil(H / rowSpacing) + 4;

    for (let r = -2; r < rows; r++) {
      for (let q = -2; q < cols; q++) {
        const cx = q * colSpacing + ((r & 1) ? colSpacing / 2 : 0);
        const cy = r * rowSpacing;
        hexCenters.push({ x: cx, y: cy });
        const hv = new Array(6);
        for (let i = 0; i < 6; i++) {
          const angle = (Math.PI / 3) * i - Math.PI / 2;
          const vx = cx + HEX_SIZE * Math.cos(angle);
          const vy = cy + HEX_SIZE * Math.sin(angle);
          const key = `${Math.round(vx * 10)}:${Math.round(vy * 10)}`;
          let idx = vMap.get(key);
          if (idx === undefined) {
            idx = vertices.length;
            vertices.push({ x: vx, y: vy, edges: [] });
            vMap.set(key, idx);
          }
          hv[i] = idx;
        }
        for (let i = 0; i < 6; i++) {
          const a = hv[i];
          const b = hv[(i + 1) % 6];
          const eKey = a < b ? `${a}:${b}` : `${b}:${a}`;
          if (eMap.has(eKey)) continue;
          const eIdx = edges.length;
          edges.push({ v1: a, v2: b, intensity: 0, violet: 0 });
          eMap.set(eKey, eIdx);
          vertices[a].edges.push(eIdx);
          vertices[b].edges.push(eIdx);
        }
      }
    }
  }

  /* ── Pre-render filled hex tiles (3D plate look) ────────
     Each hexagon is rendered as a SOLID polygon inset by ~8%
     from the full hex boundary, with a vertical linear gradient
     (top brighter, bottom near-black) so it reads as a slightly-
     raised plate catching light from above.

     Tiles also vary by per-hex ELEVATION (a deterministic 0-1
     hash of their position): "high" hexes interpolate toward
     brighter tile colors, "low" hexes toward almost-pure-channel
     so they read as recessed below the surface. Result: the
     surface looks like stacked plates at slightly different
     heights, just like the reference image.

     Overall the palette is intentionally dark — the hex grid is
     ambient texture, not the visual focus (which is the page
     content and the walker trails). */
  const TILE_INSET    = 0.92;
  const CHANNEL_COLOR = '#02040c';

  // Two color presets lerped per-hex by `elevation` (0..1).
  // HIGH = raised tile catching light, LOW = recessed tile in shadow.
  const HIGH_TOP    = [24, 28, 40];
  const HIGH_MID    = [13, 16, 24];
  const HIGH_BOTTOM = [5,  7,  12];
  const LOW_TOP     = [7,  9,  14];
  const LOW_MID     = [4,  6,  10];
  const LOW_BOTTOM  = [2,  3,  6];

  // Deterministic pseudo-random 0..1 from a 2D position. Same hex
  // center always returns the same value, so resizing the canvas
  // doesn't shuffle the elevation pattern.
  function hexElevation(x, y) {
    const seed = ((x * 374761393) ^ (y * 668265263)) | 0;
    const mixed = (seed * (seed | 1)) >>> 0;
    return mixed / 4294967295;
  }

  // 5-stop lerp helper for the color presets
  function lerpColor(low, high, t) {
    return [
      Math.round(low[0] + (high[0] - low[0]) * t),
      Math.round(low[1] + (high[1] - low[1]) * t),
      Math.round(low[2] + (high[2] - low[2]) * t),
    ];
  }

  function renderBaseLayer() {
    const dpr = effectiveDPR();
    baseLayer = document.createElement('canvas');
    baseLayer.width  = W * dpr;
    baseLayer.height = H * dpr;
    const bctx = baseLayer.getContext('2d');
    bctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Flood-fill the channel color so seams read as recessed dark.
    bctx.fillStyle = CHANNEL_COLOR;
    bctx.fillRect(0, 0, W, H);

    const r = HEX_SIZE * TILE_INSET;
    bctx.lineWidth = 1;
    bctx.lineJoin = 'round';

    for (const c of hexCenters) {
      // Per-hex elevation (deterministic) → varies brightness so the
      // grid reads as plates at different stacked heights.
      const elev = hexElevation(Math.round(c.x), Math.round(c.y));
      const top    = lerpColor(LOW_TOP,    HIGH_TOP,    elev);
      const mid    = lerpColor(LOW_MID,    HIGH_MID,    elev);
      const bottom = lerpColor(LOW_BOTTOM, HIGH_BOTTOM, elev);

      // Build hex path (pointy-top)
      bctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 2;
        const x = c.x + r * Math.cos(angle);
        const y = c.y + r * Math.sin(angle);
        if (i === 0) bctx.moveTo(x, y);
        else bctx.lineTo(x, y);
      }
      bctx.closePath();

      // Vertical gradient gives each tile its faux-3D plate shading
      const grad = bctx.createLinearGradient(c.x, c.y - r, c.x, c.y + r);
      grad.addColorStop(0,   `rgba(${top[0]},${top[1]},${top[2]},1)`);
      grad.addColorStop(0.5, `rgba(${mid[0]},${mid[1]},${mid[2]},1)`);
      grad.addColorStop(1,   `rgba(${bottom[0]},${bottom[1]},${bottom[2]},1)`);
      bctx.fillStyle = grad;
      bctx.fill();

      // Rim light intensity also scales with elevation — raised tiles
      // catch a touch more ambient blue, recessed tiles get nothing.
      const rimAlpha = 0.02 + elev * 0.05;   // 0.02 → 0.07
      bctx.strokeStyle = `rgba(80, 105, 150, ${rimAlpha})`;
      bctx.stroke();
    }
  }

  function spawnWalkers() {
    walkers = [];
    for (let i = 0; i < numWalkers; i++) {
      const edgeIdx = Math.floor(Math.random() * edges.length);
      const edge = edges[edgeIdx];
      walkers.push({
        edge: edgeIdx,
        fromV: Math.random() < 0.5 ? edge.v1 : edge.v2,
        progress: Math.random(),
      });
    }
  }

  function effectiveDPR() {
    const native = window.devicePixelRatio || 1;
    const maxArea = 12 * 1024 * 1024;
    let dpr = Math.min(native, 2);
    while (W * H * dpr * dpr > maxArea && dpr > 1) dpr -= 0.25;
    return Math.max(1, dpr);
  }

  function resize() {
    pendingResize = false;
    W = window.innerWidth;
    H = getDocHeight();
    const viewports = H / window.innerHeight;
    // Desktop: more walkers for richer ambient activity.
    // Mobile: fewer to keep CPU/battery happy.
    if (IS_MOBILE) {
      numWalkers = Math.min(10, Math.max(5, Math.round(4 + viewports * 1.2)));
    } else {
      numWalkers = Math.min(28, Math.max(14, Math.round(10 + viewports * 3)));
    }
    const dpr = effectiveDPR();
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildGrid();
    renderBaseLayer();
    spawnWalkers();
  }

  function scheduleResize(delay = 200) {
    if (pendingResize) return;
    pendingResize = true;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, delay);
  }

  /* ── Update glitch position (chase the BLUE TRAIL, not the cursor) ── */
  function updateGlitch() {
    if (!glitchInitialized || !mouseInside) return;

    // Target = where the cursor was TRAIL_DELAY_MS ago. That position
    // is sitting on the freshest part of the blue trail, so the glitch
    // visually appears to be chasing the trail head, trying to corrupt
    // its color into magenta as it goes.
    const target = getTrailTarget();
    const dx = target.x - glitchX;
    const dy = target.y - glitchY;
    const dist = Math.hypot(dx, dy);

    // Move toward the target, but cap the "effective distance" so the
    // glitch never gets closer than GLITCH_MIN_DIST. When the cursor
    // stops, the delayed target catches up to the current cursor and
    // the glitch settles at exactly that gap.
    if (dist > 0.5) {
      const targetDist = Math.max(0, dist - GLITCH_MIN_DIST);
      const step = targetDist * GLITCH_LERP;
      glitchX += (dx / dist) * step;
      glitchY += (dy / dist) * step;
    }
    // Tiny sub-pixel jitter for the glitch aesthetic
    glitchX += (Math.random() - 0.5) * GLITCH_JITTER;
    glitchY += (Math.random() - 0.5) * GLITCH_JITTER;

    // Reflect to DOM
    if (glitchEl) {
      glitchEl.style.transform = `translate(${glitchX}px, ${glitchY}px)`;
      glitchEl.classList.add('is-active');
    }
  }

  /* ── Per-frame update ──────────────────────────────────── */
  function update(dt) {
    // Walkers
    for (const w of walkers) {
      w.progress += dt * WALKER_SPEED;
      while (w.progress >= 1) {
        w.progress -= 1;
        const edge = edges[w.edge];
        const arrivedAt = (edge.v1 === w.fromV) ? edge.v2 : edge.v1;
        const cands = vertices[arrivedAt].edges.filter(idx => idx !== w.edge);
        if (cands.length === 0) {
          w.fromV = arrivedAt;
        } else {
          w.edge = cands[(Math.random() * cands.length) | 0];
          w.fromV = arrivedAt;
        }
      }
      edges[w.edge].intensity = 1;
    }

    // Cursor halo (blue) — uses document-space cursor coords
    if (mouseInside) {
      const cx = mouseClientX;
      const cy = mouseClientY + window.scrollY;
      const reach = CURSOR_RADIUS + HEX_SIZE;
      for (const e of edges) {
        const a = vertices[e.v1], b = vertices[e.v2];
        const midX = (a.x + b.x) * 0.5;
        const midY = (a.y + b.y) * 0.5;
        if (Math.abs(midX - cx) > reach) continue;
        if (Math.abs(midY - cy) > reach) continue;
        const d = distToSegment(cx, cy, a.x, a.y, b.x, b.y);
        if (d < CURSOR_RADIUS) {
          const k = 1 - d / CURSOR_RADIUS;
          const boost = CURSOR_STRENGTH * k * k;
          if (boost > e.intensity) e.intensity = boost;
        }
      }
    }

    // Glitch halo (magenta) — also document-space (glitch is viewport)
    if (glitchInitialized && mouseInside) {
      const gx = glitchX;
      const gy = glitchY + window.scrollY;
      const reach = GLITCH_RADIUS + HEX_SIZE;
      for (const e of edges) {
        const a = vertices[e.v1], b = vertices[e.v2];
        const midX = (a.x + b.x) * 0.5;
        const midY = (a.y + b.y) * 0.5;
        if (Math.abs(midX - gx) > reach) continue;
        if (Math.abs(midY - gy) > reach) continue;
        const d = distToSegment(gx, gy, a.x, a.y, b.x, b.y);
        if (d < GLITCH_RADIUS) {
          const k = 1 - d / GLITCH_RADIUS;
          const k2 = k * k;
          const boost = GLITCH_STRENGTH * k2;
          if (boost > e.intensity) e.intensity = boost;
          if (k2 > e.violet)       e.violet    = k2;
        }
      }
    }

    // Decay (intensity slower, violet faster so the magenta trail
    // washes back toward blue while the line itself stays lit longer)
    for (const e of edges) {
      if (e.intensity > 0) {
        e.intensity *= DECAY;
        if (e.intensity < MIN_INTENSITY) e.intensity = 0;
      }
      if (e.violet > 0) {
        e.violet *= VIOLET_DECAY;
        if (e.violet < MIN_INTENSITY) e.violet = 0;
      }
    }
  }

  /* ── Draw frame (viewport slice only) ──────────────────── */
  function draw() {
    const sy = window.scrollY;
    const vh = window.innerHeight;
    const top = sy - 50;
    const bot = sy + vh + 50;

    ctx.clearRect(0, top, W, bot - top);
    if (baseLayer) {
      const dpr = effectiveDPR();
      ctx.drawImage(
        baseLayer,
        0, top * dpr, W * dpr, (bot - top) * dpr,
        0, top,       W,       bot - top
      );
    }

    ctx.lineCap = 'round';
    for (const e of edges) {
      const i = e.intensity;
      if (i < MIN_INTENSITY) continue;
      const a = vertices[e.v1], b = vertices[e.v2];
      const maxY = Math.max(a.y, b.y);
      const minY = Math.min(a.y, b.y);
      if (maxY < top || minY > bot) continue;

      // Blend blue → magenta with a non-linear curve so the magenta
      // is visible at moderate violet values (not just at peak).
      // sqrt(0.25) = 0.5, so a quarter-violet already reads as half-magenta.
      const v  = e.violet;
      const vc = Math.sqrt(v);
      const r  = (BLUE_R + (VIO_R - BLUE_R) * vc) | 0;
      const g  = (BLUE_G + (VIO_G - BLUE_G) * vc) | 0;
      const b2 = (BLUE_B + (VIO_B - BLUE_B) * vc) | 0;

      // Neon two-pass: wide soft halo first, then a bright core line.
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);

      // Halo pass
      ctx.lineWidth = 2.4;
      ctx.shadowBlur = 16 * i;
      ctx.shadowColor = `rgba(${r}, ${g}, ${b2}, ${0.85 * i})`;
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b2}, ${0.45 * i})`;
      ctx.stroke();

      // Bright core pass — shifted toward white for the neon-tube look,
      // BUT we dial back the green/blue boost when the edge is magenta,
      // otherwise the white-shift washes the magenta out toward pink-pale.
      ctx.shadowBlur = 0;
      ctx.lineWidth = 1;
      const whiteShift = 1 - vc * 0.75;   // 1 when blue, 0.25 when full magenta
      const cr = Math.min(255, r + 50 * whiteShift);
      const cg = Math.min(255, g + 50 * whiteShift);
      const cb = Math.min(255, b2 + 30 * whiteShift);
      ctx.strokeStyle = `rgba(${cr}, ${cg}, ${cb}, ${0.95 * i})`;
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }

  /* ── Animation loop ────────────────────────────────────── */
  // Frame budget for mobile (33ms ≈ 30fps): the cinematic effect
  // doesn't need 60fps and capping leaves headroom for the rose
  // video, the page's reveal-on-scroll, etc.
  const FRAME_BUDGET = IS_MOBILE ? 33 : 0;
  function frame(now) {
    const dt = lastTime ? Math.min((now - lastTime) / 1000, 0.1) : 0;
    // Throttle: if we're under budget since last paint, skip.
    if (FRAME_BUDGET > 0 && lastTime && (now - lastTime) < FRAME_BUDGET) {
      requestAnimationFrame(frame);
      return;
    }
    lastTime = now;
    updateGlitch();
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  /* ── Static-only renderer (reduced motion) ─────────────── */
  // Draws the gray lattice once into the visible canvas slice and
  // returns. No walkers, no glitch, no per-frame loop.
  function renderStaticOnly() {
    resize();  // builds grid + base layer, sizes the canvas
    const sy = window.scrollY;
    const vh = window.innerHeight;
    const top = sy - 50;
    const bot = sy + vh + 50;
    ctx.clearRect(0, top, W, bot - top);
    if (baseLayer) {
      const dpr = effectiveDPR();
      ctx.drawImage(
        baseLayer,
        0, top * dpr, W * dpr, (bot - top) * dpr,
        0, top,       W,       bot - top
      );
    }
    // On scroll, repaint the new visible slice (static lattice still
    // needs to be drawn for the new viewport position).
    window.addEventListener('scroll', () => {
      const sy2 = window.scrollY;
      const top2 = sy2 - 50, bot2 = sy2 + vh + 50;
      ctx.clearRect(0, top2, W, bot2 - top2);
      if (baseLayer) {
        const dpr2 = effectiveDPR();
        ctx.drawImage(
          baseLayer,
          0, top2 * dpr2, W * dpr2, (bot2 - top2) * dpr2,
          0, top2,        W,        bot2 - top2
        );
      }
    }, { passive: true });
  }

  /* ── Boot ──────────────────────────────────────────────── */
  if (PREFERS_REDUCED) {
    // Static lattice only — no animation loop, no walkers, no glitch
    renderStaticOnly();
    return;
  }
  resize();
  window.addEventListener('resize', () => scheduleResize(200));
  // Phone rotation → reflow with the new aspect.
  window.addEventListener('orientationchange', () => scheduleResize(300));
  // Tab regains focus → recompute in case the viewport changed while
  // we weren't visible (DevTools emulator quirks, OS-level resize, etc).
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) scheduleResize(150);
  });
  // Defensive recompute ~250ms after first paint — catches cases
  // where initial window.innerWidth/innerHeight were stale (DevTools
  // device emulation often reports the desktop size before the
  // emulator settles, leaving the canvas sized for the wrong viewport).
  setTimeout(() => scheduleResize(0), 250);
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(() => scheduleResize(300));
    ro.observe(document.body);
  }
  requestAnimationFrame(frame);
})();
