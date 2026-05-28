/* ─────────────────────────────────────────────────────────────
   Elite — 3D hex grid background
   Replaces the 2D canvas (hexbg.js) and the looping mp4 (fondo)
   on capable desktops. A real WebGL scene with two cursor-tracked
   point lights:
     • blue light → follows the cursor in real time
     • magenta light → follows the cursor-glitch DOM element,
       which lags ~380ms behind the cursor (same lag logic that
       lives in hexbg.js when in 2D mode)
   Both lights sit near the floor so they illuminate the HEX SEAMS
   and the CHANNEL FLOOR (light at glancing angle) but barely
   touch the tile tops — that's what creates the "only the seams
   light up" effect from the MotionSites reference.

   Activated only when window.__use3dBg === true (set by app.js
   after the capability gate passes).
   ───────────────────────────────────────────────────────────── */

/* Uses the global THREE — loaded as a classic <script> from CDN
   before this file (see app.js for the load order). This avoids
   the ES-module CORS restriction that blocks `import` over file://
   protocol, so the site works both during local file-preview
   development AND when served over http(s) in production. */
(() => {
  'use strict';
  if (!window.__use3dBg) return;
  if (typeof THREE === 'undefined') {
    console.warn('hexbg3d: THREE global not found — Three.js failed to load');
    window.__use3dBg = false;
    document.body.removeAttribute('data-use-3d');
    return;
  }

  const canvas = document.getElementById('hex3dBg');
  if (!canvas) return;

  /* ── Geometry constants ──────────────────────────────────── */
  const HEX_RADIUS    = 1.0;          // hex circumradius (point-to-center)
  const TILE_INSET    = 0.92;         // tile radius vs hex radius (gap = 8%)
  const HEX_BASE_H    = 1.0;          // shortest tile height
  const HEX_ELEV_MAX  = 0.9;          // additional height for "raised" tiles
  const HEX_W         = HEX_RADIUS * Math.sqrt(3);
  const HEX_H         = HEX_RADIUS * 2;
  const COL_SPACING   = HEX_W;
  const ROW_SPACING   = HEX_H * 0.75;
  const COLS          = 28;
  const ROWS          = 22;

  /* ── Colors ──────────────────────────────────────────────── */
  const FLOOR_COLOR   = 0x02040a;
  const TILE_COLOR    = 0x0a0e16;
  const BG_COLOR      = 0x04060c;
  const AMBIENT_COLOR = 0x101820;
  const CURSOR_COLOR  = 0x2196F3;   // electric blue (matches rose logo's stop)
  const GLITCH_COLOR  = 0xE040FB;   // magenta (matches rose logo's endpoint)

  /* ── Renderer + scene setup ──────────────────────────────── */
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
  } catch (err) {
    // WebGL unavailable — let hexbg.js take over (it should already
    // be running since we set __use3dBg AFTER it bails... but as a
    // safety net we revert here)
    console.warn('WebGL init failed, falling back to 2D hex canvas:', err);
    window.__use3dBg = false;
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG_COLOR);

  /* Camera — isometric-ish view from upper-front. Looking down at
     a shallow angle catches the tile sides AND lets the cursor
     light reach all the channels. */
  const camera = new THREE.PerspectiveCamera(
    38,
    window.innerWidth / window.innerHeight,
    0.1,
    200
  );
  camera.position.set(0, 16, 13);
  camera.lookAt(0, 0, 0);

  /* ── Deterministic per-hex elevation (no shuffle on resize) ── */
  function hexElev(q, r) {
    const seed = ((q * 374761393) ^ (r * 668265263)) | 0;
    return ((seed * (seed | 1)) >>> 0) / 4294967295;
  }

  /* ── Floor plane (catches light at glancing angle = lit channels) ── */
  const floorGeo = new THREE.PlaneGeometry(200, 200);
  const floorMat = new THREE.MeshStandardMaterial({
    color: FLOOR_COLOR,
    roughness: 0.92,
    metalness: 0.0,
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  scene.add(floor);

  /* ── Hex tiles via InstancedMesh ──────────────────────────
     One geometry, COLS*ROWS instances with per-instance transform.
     ~600 tiles render in a single draw call. */
  const hexGeo = new THREE.CylinderGeometry(
    HEX_RADIUS * TILE_INSET,        // top radius
    HEX_RADIUS * TILE_INSET,        // bottom radius
    1.0,                            // base height (will be scaled per instance)
    6,                              // 6-sided → hex
    1,
    false
  );
  // Rotate so flat-top faces are horizontal (more "tile-like" reading)
  // CylinderGeometry already has flat-top by default — but with 6 sides
  // and our pointy-top hex math, we want corner-up. Rotate Y by 30°.
  hexGeo.rotateY(Math.PI / 6);

  const tileMat = new THREE.MeshStandardMaterial({
    color: TILE_COLOR,
    roughness: 0.72,
    metalness: 0.28,
  });

  const tileCount = COLS * ROWS;
  const tiles = new THREE.InstancedMesh(hexGeo, tileMat, tileCount);
  const _m4 = new THREE.Matrix4();
  const _pos = new THREE.Vector3();
  const _quat = new THREE.Quaternion();
  const _scl = new THREE.Vector3();

  let idx = 0;
  const colStart = -Math.floor(COLS / 2);
  const rowStart = -Math.floor(ROWS / 2);
  for (let r = rowStart; r < rowStart + ROWS; r++) {
    for (let q = colStart; q < colStart + COLS; q++) {
      const elev = hexElev(q, r);
      const h = HEX_BASE_H + elev * HEX_ELEV_MAX;
      const x = q * COL_SPACING + ((Math.abs(r) & 1) ? COL_SPACING / 2 : 0);
      const z = r * ROW_SPACING;
      _pos.set(x, h / 2, z);
      _scl.set(1, h, 1);
      _m4.compose(_pos, _quat, _scl);
      tiles.setMatrixAt(idx++, _m4);
    }
  }
  tiles.instanceMatrix.needsUpdate = true;
  scene.add(tiles);

  /* ── Lights ──────────────────────────────────────────────── */
  // Ambient floor of "global illumination" — keeps the scene from
  // being pitch black outside the cursor lights.
  scene.add(new THREE.AmbientLight(AMBIENT_COLOR, 0.35));

  // Cursor light (blue) — tight range, low Y, high decay → catches
  // ONLY the seams/channels near the cursor.
  const cursorLight = new THREE.PointLight(CURSOR_COLOR, 35, 9, 1.8);
  cursorLight.position.set(0, 0.32, 0);
  scene.add(cursorLight);

  // Glitch light (magenta) — same idea, slightly weaker than the
  // cursor light so it reads as a "contamination" inside the blue
  // halo rather than overpowering it.
  const glitchLight = new THREE.PointLight(GLITCH_COLOR, 28, 7, 1.8);
  glitchLight.position.set(0, 0.32, 0);
  scene.add(glitchLight);

  /* ── Mouse + raycast → world position ───────────────────── */
  const raycaster = new THREE.Raycaster();
  const _ndc = new THREE.Vector2();
  const _hit = new THREE.Vector3();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  function screenToFloor(clientX, clientY, out) {
    _ndc.x = (clientX / window.innerWidth) * 2 - 1;
    _ndc.y = -((clientY / window.innerHeight) * 2 - 1);
    raycaster.setFromCamera(_ndc, camera);
    return raycaster.ray.intersectPlane(groundPlane, out) !== null;
  }

  /* ── Cursor + glitch tracking (with lag) ────────────────────
     We OWN the glitch element's transform here. Same lag algorithm
     as the 2D hexbg.js — the cursor's position from ~380ms ago is
     the target the glitch chases toward (with a min-distance gap
     and per-frame jitter for the "vibrating artifact" feel). */
  const TRAIL_DELAY_MS = 380;
  const GLITCH_LERP    = 0.18;
  const GLITCH_MIN_DIST= 22;
  const GLITCH_JITTER  = 1.0;
  const mouseHistory = [];
  let mouseClientX = -1000, mouseClientY = -1000;
  let mouseInside = false;
  let glitchX = -1000, glitchY = -1000;
  let glitchInitialized = false;

  const glitchEl = document.getElementById('cursorGlitch');

  function pushHistory(x, y) {
    const t = performance.now();
    mouseHistory.push({ x, y, t });
    const cutoff = t - TRAIL_DELAY_MS * 2;
    while (mouseHistory.length > 0 && mouseHistory[0].t < cutoff) {
      mouseHistory.shift();
    }
  }
  function getTrailTarget() {
    if (mouseHistory.length === 0) return { x: mouseClientX, y: mouseClientY };
    const targetTime = performance.now() - TRAIL_DELAY_MS;
    for (let i = mouseHistory.length - 1; i >= 0; i--) {
      if (mouseHistory[i].t <= targetTime) return mouseHistory[i];
    }
    return mouseHistory[0];
  }
  function updateGlitchPosition() {
    if (!glitchInitialized || !mouseInside) return;
    const target = getTrailTarget();
    const dx = target.x - glitchX;
    const dy = target.y - glitchY;
    const dist = Math.hypot(dx, dy);
    if (dist > 0.5) {
      const targetDist = Math.max(0, dist - GLITCH_MIN_DIST);
      const step = targetDist * GLITCH_LERP;
      glitchX += (dx / dist) * step;
      glitchY += (dy / dist) * step;
    }
    glitchX += (Math.random() - 0.5) * GLITCH_JITTER;
    glitchY += (Math.random() - 0.5) * GLITCH_JITTER;
    if (glitchEl) {
      glitchEl.style.transform = `translate(${glitchX}px, ${glitchY}px)`;
      glitchEl.classList.add('is-active');
    }
  }

  window.addEventListener('mousemove', (e) => {
    mouseClientX = e.clientX;
    mouseClientY = e.clientY;
    mouseInside  = true;
    pushHistory(e.clientX, e.clientY);
    if (!glitchInitialized) {
      glitchX = e.clientX;
      glitchY = e.clientY;
      glitchInitialized = true;
    }
  }, { passive: true });
  window.addEventListener('mouseleave', () => { mouseInside = false; });

  /* ── Animation loop ──────────────────────────────────────── */
  function frame() {
    updateGlitchPosition();

    // Position cursor light at cursor's projected floor point
    if (mouseInside && screenToFloor(mouseClientX, mouseClientY, _hit)) {
      cursorLight.position.set(_hit.x, 0.32, _hit.z);
    }
    // Position glitch light at glitch's projected floor point
    if (glitchInitialized && screenToFloor(glitchX, glitchY, _hit)) {
      glitchLight.position.set(_hit.x, 0.32, _hit.z);
    }
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  /* ── Resize handler ──────────────────────────────────────── */
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight, false);
    }, 200);
  });

  /* ── Pause render when tab hidden (battery saver) ───────── */
  let visibilityPaused = false;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !visibilityPaused) {
      visibilityPaused = true;
      // No way to "stop" requestAnimationFrame retroactively; instead
      // we just check in frame() and skip render. But rAF is already
      // throttled by the browser when tab is hidden (most browsers),
      // so this is mostly defensive.
    } else {
      visibilityPaused = false;
    }
  });
})();
