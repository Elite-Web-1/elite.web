/* ─────────────────────────────────────────────────────────────
   Elite — Loading screen state machine
   Drives <body> data-* attributes that the CSS reads.
   Phases: waiting → loading → logo-hold → transitioning → hero
   ───────────────────────────────────────────────────────────── */

(() => {
  'use strict';

  const body          = document.body;
  const enterGate     = document.getElementById('enterGate');
  const video         = document.getElementById('introVideo');
  const progressFill  = document.getElementById('progressFill');
  const skipHint      = document.getElementById('skipHint');
  const introLogo     = document.getElementById('introLogo');
  const logoVideo     = document.getElementById('logoVideo');

  // If the markup isn't here, bail out silently.
  if (!enterGate || !video || !introLogo) return;

  /* ── Capability detection ─────────────────────────────────
     We branch on user preferences and device class to avoid
     burning battery / data on hardware that can't (or won't)
     enjoy the full cinematic intro. */
  const PREFERS_REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const IS_MOBILE       = window.matchMedia('(max-width: 900px)').matches;

  /* ── Reduced-motion fast path ─────────────────────────────
     Users who explicitly asked for reduced motion get the final
     hero state immediately. No cinematic, no transforms, no
     looping animations. The CSS killswitch (in styles.css)
     also collapses transition/animation durations so any state
     change is instant. */
  if (PREFERS_REDUCED) {
    // Pause all autoplaying videos
    document.querySelectorAll('video').forEach(v => {
      try {
        v.pause();
        v.removeAttribute('autoplay');
      } catch (_) {}
    });
    // Jump straight to the final HERO state
    body.setAttribute('data-phase', 'hero');
    body.setAttribute('data-logo-visible', 'true');
    body.setAttribute('data-logo-corner', 'true');
    body.setAttribute('data-hero-visible', 'true');
    const nav = document.getElementById('navbar');
    if (nav) nav.classList.add('is-revealed');
    document.documentElement.style.overflow = '';
    return;
  }

  /* ── Mobile data savings ──────────────────────────────────
     The cinematic mp4 is ~4MB. On mobile networks, downloading
     it on page load (preload="auto") burns data on users who
     might leave before clicking. Drop to "metadata" so only the
     few KB of header are fetched until they tap the gate. */
  if (IS_MOBILE) {
    try { video.preload = 'metadata'; } catch (_) {}
  }

  /* ── Detección "low-power" ────────────────────────────────
     Marcamos al body para que CSS pueda decidir reducciones
     adicionales (futuras), y bajamos la calidad del video de
     fondo en redes lentas o dispositivos con poca memoria. */
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const SAVE_DATA   = !!(conn && conn.saveData);
  const SLOW_NET    = !!(conn && /2g|slow-2g/.test(conn.effectiveType || ''));
  const LOW_MEMORY  = (navigator.deviceMemory || 8) <= 2;
  const LOW_CORES   = (navigator.hardwareConcurrency || 8) <= 2;
  const LOW_POWER   = SAVE_DATA || SLOW_NET || LOW_MEMORY || LOW_CORES || IS_MOBILE;

  if (LOW_POWER) {
    body.setAttribute('data-low-power', 'true');
  }
  // En low-power agresivo (red lenta, save-data o memoria baja),
  // ni siquiera intentamos descargar el video del fondo: removemos
  // sus <source>, sacamos autoplay, y dejamos visible el poster.jpg
  // como fondo estático. Ahorro: 12 MB → ~300 KB y cero decode.
  if (SAVE_DATA || SLOW_NET || LOW_MEMORY) {
    const bgVideo = document.getElementById('fondoBg');
    if (bgVideo) {
      try {
        bgVideo.removeAttribute('autoplay');
        bgVideo.preload = 'none';
        // Limpiar todos los <source> internos para que nunca
        // se dispare la descarga del mp4.
        bgVideo.querySelectorAll('source').forEach(s => s.remove());
        bgVideo.removeAttribute('src');
        bgVideo.load(); // fija el estado en el poster
      } catch (_) {}
    }
    const glitchVideo = document.querySelector('.cursor-glitch-video');
    if (glitchVideo) try { glitchVideo.preload = 'none'; } catch (_) {}
  }

  const HAS_HOVER = window.matchMedia('(any-hover: hover)').matches;

  /* ── Cursor spotlight tracking ─────────────────────────────
     A soft radial glow div (#cursorSpotlight) follows the cursor
     and brightens the fondo video underneath via mix-blend-mode:
     screen. We update its position once per animation frame using
     rAF coalescing — many mousemove events per frame collapse into
     a single transform write, so the cost stays flat regardless
     of mouse polling rate.

     Only wired up on devices that can hover (no point on touch).
     También se salta en low-power: el trail recalcula gradientes
     en cada mousemove y eso es lo más caro del runtime. */
  if (HAS_HOVER && !LOW_POWER) {
    const spotlight = document.getElementById('cursorSpotlight');
    const glitchEl  = document.getElementById('cursorGlitch');

    /* ── Tag every text element as a trail target ──────────
       For each h1/h2/h3/p, read the element's resolved color,
       cache it as the "off-cursor" linear-gradient, then add
       .trail-target which flips it to transparent + clipped to
       text. This way the page reads normally when idle and JS
       can paint the trail through every heading and paragraph
       on the page — not just the hero. */
    const trailEls = [];
    document.querySelectorAll('h1, h2, h3, p').forEach((el) => {
      const color = getComputedStyle(el).color;
      const baseBg = `linear-gradient(${color},${color})`;
      el.style.backgroundImage = baseBg;
      el.classList.add('trail-target');
      trailEls.push({ el, baseBg });
    });

    /* ── Shared cursor state ───────────────────────────── */
    const halfW = 260;   // half of #cursorSpotlight's 520px size
    let mx = 0, my = 0;

    /* ── Spotlight follower (rAF coalesced) ────────────── */
    let spotPending = false;
    function applySpotlight() {
      spotPending = false;
      if (spotlight) {
        spotlight.style.transform =
          `translate(${mx - halfW}px, ${my - halfW}px)`;
      }
    }

    /* ── Cursor glitch follower ─────────────────────────
       Chases the cursor's position from ~380ms ago. That delay
       makes the glitch lag behind the freshest part of the blue
       trail, so visually it looks like the glitch is "corrupting"
       the trail into magenta as it catches up. A min gap keeps
       the glitch from overlapping the cursor when both are still. */
    const GLITCH_DELAY    = 540;    // ms behind the cursor (more lag = more visible blue trail before the magenta corruption)
    const GLITCH_LERP     = 0.18;
    const GLITCH_MIN_DIST = 22;
    const GLITCH_JITTER   = 0.8;
    const mouseHist = [];           // {x, y, t} ring for glitch + trail
    let glitchX = -1000, glitchY = -1000;
    let glitchInit = false;
    let glitchRunning = false;

    function getGlitchTarget() {
      if (mouseHist.length === 0) return { x: mx, y: my };
      const tt = performance.now() - GLITCH_DELAY;
      for (let i = mouseHist.length - 1; i >= 0; i--) {
        if (mouseHist[i].t <= tt) return mouseHist[i];
      }
      return mouseHist[0];
    }

    function tickGlitch() {
      glitchRunning = false;
      if (!glitchEl) return;
      const tgt = getGlitchTarget();
      const dx = tgt.x - glitchX;
      const dy = tgt.y - glitchY;
      const dist = Math.hypot(dx, dy);
      let moving = false;
      if (dist > 0.5) {
        const tDist = Math.max(0, dist - GLITCH_MIN_DIST);
        const step = tDist * GLITCH_LERP;
        glitchX += (dx / dist) * step;
        glitchY += (dy / dist) * step;
        glitchX += (Math.random() - 0.5) * GLITCH_JITTER;
        glitchY += (Math.random() - 0.5) * GLITCH_JITTER;
        moving = true;
      }
      glitchEl.style.transform = `translate(${glitchX}px, ${glitchY}px)`;
      if (moving) {
        glitchRunning = true;
        requestAnimationFrame(tickGlitch);
      }
    }

    /* ── Fading trail of colored blobs ─────────────────
       Each cursor sample lives ~1.9s. Color over its lifetime:
         0–18%   solid blue          (clear blue trail before glitch)
         18–28%  blue → magenta lerp (transitions DURING glitch approach)
         28–100% magenta, fading alpha to 0  (~72% of life)
       The 28% boundary is the key one: GLITCH_DELAY (540ms) is
       ~28% of TRAIL_LIFE (1900ms), so by the time the glitch
       reaches a sample, the lerp has just finished and the letter
       under the glitch is fully magenta. Bumping the delay (from
       380 → 540) leaves more of the blue phase visible BEFORE the
       glitch arrives, so the cursor's blue trail reads clearly. */
    const TRAIL_LIFE   = 1900;
    const TRAIL_R      = 95;
    const TRAIL_MAX    = 48;
    const TRAIL_MIN_D2 = 6 * 6;
    const trail = [];
    let lastTx = -9999, lastTy = -9999;
    let trailRunning = false;
    const painted = new Set();      // elements currently showing blobs

    function pushTrail(x, y) {
      if (!trailEls.length) return;
      const dx = x - lastTx, dy = y - lastTy;
      if (dx * dx + dy * dy < TRAIL_MIN_D2) return;
      lastTx = x; lastTy = y;
      trail.push({ x, y, t: performance.now() });
      if (trail.length > TRAIL_MAX) trail.shift();
      if (!trailRunning) {
        trailRunning = true;
        requestAnimationFrame(renderTrail);
      }
    }

    function renderTrail() {
      trailRunning = false;
      const now = performance.now();
      while (trail.length && now - trail[0].t > TRAIL_LIFE) trail.shift();

      if (!trail.length) {
        // Reset everything that was painted last frame to its base color
        for (let i = 0; i < trailEls.length; i++) {
          const item = trailEls[i];
          if (painted.has(item.el)) {
            item.el.style.backgroundImage = item.baseBg;
            painted.delete(item.el);
          }
        }
        return;
      }

      // Build samples once per frame; per-element we just translate
      // (x,y) into element-local coords and AABB-cull.
      const samples = [];
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i < trail.length; i++) {
        const p = trail[i];
        const t = (now - p.t) / TRAIL_LIFE;
        let r, g, b, a;
        if (t < 0.18) {
          r = 33; g = 150; b = 243; a = 1;
        } else if (t < 0.28) {
          const k = (t - 0.18) / 0.10;
          r = 33  + (224 - 33)  * k;
          g = 150 + (64  - 150) * k;
          b = 243 + (251 - 243) * k;
          a = 1;
        } else {
          r = 224; g = 64; b = 251;
          a = 1 - (t - 0.28) / 0.72;
        }
        if (a <= 0) continue;
        const ri = r | 0, gi = g | 0, bi = b | 0;
        samples.push({
          x: p.x, y: p.y,
          cIn:  `rgba(${ri},${gi},${bi},${a.toFixed(3)})`,
          cMid: `rgba(${ri},${gi},${bi},${(a * 0.55).toFixed(3)})`,
          cOut: `rgba(${ri},${gi},${bi},0)`,
        });
        if (p.x - TRAIL_R < minX) minX = p.x - TRAIL_R;
        if (p.y - TRAIL_R < minY) minY = p.y - TRAIL_R;
        if (p.x + TRAIL_R > maxX) maxX = p.x + TRAIL_R;
        if (p.y + TRAIL_R > maxY) maxY = p.y + TRAIL_R;
      }

      for (let i = 0; i < trailEls.length; i++) {
        const item = trailEls[i];
        const el = item.el;
        const rect = el.getBoundingClientRect();
        // Skip empty/offscreen + elements outside the trail's AABB
        if (rect.width === 0 || rect.height === 0 ||
            rect.right < minX  || rect.left > maxX ||
            rect.bottom < minY || rect.top > maxY) {
          if (painted.has(el)) {
            el.style.backgroundImage = item.baseBg;
            painted.delete(el);
          }
          continue;
        }
        let bg = '';
        for (let j = 0; j < samples.length; j++) {
          const s = samples[j];
          const x = (s.x - rect.left) | 0;
          const y = (s.y - rect.top)  | 0;
          // Per-blob AABB cull against this element's bounds
          if (x + TRAIL_R < 0 || y + TRAIL_R < 0 ||
              x - TRAIL_R > rect.width || y - TRAIL_R > rect.height) continue;
          if (bg) bg += ',';
          bg += `radial-gradient(circle ${TRAIL_R}px at ${x}px ${y}px,` +
                `${s.cIn} 0%,${s.cMid} 38%,${s.cOut} 70%)`;
        }
        if (bg) {
          el.style.backgroundImage = bg + ',' + item.baseBg;
          painted.add(el);
        } else if (painted.has(el)) {
          el.style.backgroundImage = item.baseBg;
          painted.delete(el);
        }
      }

      trailRunning = true;
      requestAnimationFrame(renderTrail);
    }

    /* ── Single mousemove dispatch for spotlight + glitch + trail ── */
    window.addEventListener('mousemove', (e) => {
      mx = e.clientX;
      my = e.clientY;

      if (!spotPending) {
        spotPending = true;
        requestAnimationFrame(applySpotlight);
      }

      // History feeds the lagged glitch target
      const now = performance.now();
      mouseHist.push({ x: mx, y: my, t: now });
      const cutoff = now - GLITCH_DELAY * 2;
      while (mouseHist.length && mouseHist[0].t < cutoff) mouseHist.shift();

      if (glitchEl && !glitchInit) {
        glitchX = mx; glitchY = my;
        glitchInit = true;
        glitchEl.classList.add('is-active');
      }
      if (glitchEl && !glitchRunning) {
        glitchRunning = true;
        requestAnimationFrame(tickGlitch);
      }

      pushTrail(mx, my);
    }, { passive: true });
  }


  /* ── Defensive viewport re-evaluation ────────────────────
     Some browsers (and DevTools device emulation in particular)
     report stale window.innerWidth/innerHeight during the very
     first paint. The CSS that uses 100vh / 100dvh / min(100vw, ...)
     gets computed with those stale values, so the rose lands at the
     wrong size until the user resizes. We force a synthetic resize
     event ~250ms after first paint so any viewport-dependent layout
     recomputes against the real, settled dimensions. */
  setTimeout(() => {
    try { window.dispatchEvent(new Event('resize')); } catch (_) {}
  }, 250);

  const PHASE = {
    WAITING:       'waiting',
    LOADING:       'loading',
    LOGO_HOLD:     'logo-hold',
    TRANSITIONING: 'transitioning',
    HERO:          'hero',
  };

  let phase = PHASE.WAITING;
  const setPhase = (p) => { phase = p; body.setAttribute('data-phase', p); };
  const flag = (name, value) => body.setAttribute(`data-${name}`, value ? 'true' : 'false');

  // Initial state
  setPhase(PHASE.WAITING);
  flag('logo-visible', false);
  flag('logo-corner', false);
  flag('skip-visible', false);

  /* ── Click-to-enter starts the cinematic video ─────────── */
  let loadingStartedAt = 0;
  const SKIP_GUARD_MS = 600;

  const startVideo = () => {
    loadingStartedAt = performance.now();
    // Free the gate's video decoder — it's about to be covered by
    // the cinematic anyway, and on low-power phones, having 2-3 video
    // decoders running simultaneously (gate + cinematic + intro logo)
    // can tank the frame rate.
    const gateVideo = enterGate.querySelector('video');
    if (gateVideo) {
      try { gateVideo.pause(); } catch (_) {}
    }
    setPhase(PHASE.LOADING);
    video.currentTime = 0;
    video.muted = false;
    const p = video.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        video.muted = true;
        video.play().catch(() => { /* autoplay blocked → fallback timer handles it */ });
      });
    }
  };

  const skipToHero = () => {
    if (phase !== PHASE.LOADING) return;
    try { video.pause(); } catch (_) {}
    flag('skip-visible', false);
    flag('logo-visible', true);
    setTimeout(() => {
      // Use the same blink transition so skipping looks consistent
      // with the natural flow — no slow rectangle drift.
      blinkToCorner();
      revealHeroContent();
    }, 600);
    setPhase(PHASE.HERO);
    unlockScroll();
  };

  // The gate handles its own click; skip happens on any document click
  // during the LOADING phase (except clicks on real UI elements).
  // stopPropagation prevents the SAME click that starts the video from
  // bubbling up and being interpreted by the doc handler below as "skip".
  enterGate.addEventListener('click', (e) => {
    if (phase === PHASE.WAITING) {
      e.stopPropagation();
      startVideo();
    }
  });

  // Small guard: ignore document clicks for ~600ms after the video starts,
  // in case anything else slips through (touch double-fire, mouseup on the
  // gate's tail, etc.). Without this, a fast double-click could still skip.
  document.addEventListener('click', (e) => {
    if (phase !== PHASE.LOADING) return;
    if (performance.now() - loadingStartedAt < SKIP_GUARD_MS) return;
    // Ignore clicks on links, buttons, etc.
    if (e.target.closest('a, button, input, textarea, select, [role="button"]')) return;
    skipToHero();
  });

  /* ── Video lifecycle ───────────────────────────────────── */
  video.addEventListener('timeupdate', () => {
    if (!video.duration) return;
    progressFill.style.width = `${(video.currentTime / video.duration) * 100}%`;
  });

  video.addEventListener('ended', () => {
    if (phase !== PHASE.LOADING) return;
    setPhase(PHASE.LOGO_HOLD);
  });

  // Show skip hint after 3s into LOADING; arm the "video never
  // ended" safety fallback at the same moment so its countdown
  // starts when the user actually clicks the gate, not on page
  // load. (Counting from page load was breaking long sessions —
  // e.g. while setting up a screen recorder — by cutting the
  // intro short when the budget ran out mid-video.)
  let skipTimer = null;
  let endedSafetyTimer = null;
  const onPhaseEnterLoading = () => {
    skipTimer = setTimeout(() => flag('skip-visible', true), 3000);
    endedSafetyTimer = setTimeout(() => {
      if (phase === PHASE.LOADING) setPhase(PHASE.LOGO_HOLD);
    }, 25000);
  };
  const onPhaseExitLoading = () => {
    if (skipTimer) { clearTimeout(skipTimer); skipTimer = null; }
    if (endedSafetyTimer) { clearTimeout(endedSafetyTimer); endedSafetyTimer = null; }
    flag('skip-visible', false);
  };

  /* ── Reveal the portfolio hero content (right column) ──── */
  const heroContent = document.querySelector('.hero .container');
  const navbar = document.getElementById('navbar');
  const revealHeroContent = () => {
    flag('hero-visible', true);
    if (navbar) navbar.classList.add('is-revealed');
  };

  /* ── "Blink" the rose to its hero-side position ────────
     Instead of animating the transform (which made the rectangular
     frame visible mid-flight), we:
       1. fade out at center over 300ms
       2. while invisible, instantly snap transform + bg-color
       3. fade back in at the corner over 400ms
     The user sees the rose vanish from the center and reappear at
     the side — no rectangle drift in between. */
  function blinkToCorner() {
    if (!introLogo) {
      flag('logo-corner', true);
      return;
    }
    introLogo.style.transition = 'opacity 0.3s ease';
    introLogo.style.opacity = '0';

    setTimeout(() => {
      // While invisible: kill all transitions, snap transform + bg
      introLogo.style.transition = 'transform 0s, opacity 0s, background-color 0s';
      flag('logo-corner', true);
      // Force a synchronous reflow so the snap commits BEFORE we
      // re-enable the opacity transition below (otherwise the
      // browser may batch the rule changes and animate everything
      // together, defeating the snap).
      void introLogo.offsetWidth;
      // Re-enable transitions for the fade-in
      introLogo.style.transition = 'opacity 0.4s ease, background-color 1.6s ease';
      introLogo.style.opacity = '';   // back to CSS default (1)

      // After the fade-in finishes, drop inline transition overrides
      // so CSS rules take over again (for the scroll-fade etc.).
      setTimeout(() => { introLogo.style.transition = ''; }, 500);
    }, 320);
  }

  /* ── Audio fade helper (linear volume ramp) ───────────── */
  let logoAudioRamp = null;
  function rampLogoVolume(toVol, durationMs, onDone) {
    if (!logoVideo) return;
    if (logoAudioRamp) { clearInterval(logoAudioRamp); logoAudioRamp = null; }
    const stepMs = 30;
    const steps = Math.max(1, Math.ceil(durationMs / stepMs));
    const fromVol = Math.max(0, Math.min(1, logoVideo.volume));
    const delta = (toVol - fromVol) / steps;
    let step = 0;
    logoAudioRamp = setInterval(() => {
      step++;
      const v = Math.max(0, Math.min(1, fromVol + delta * step));
      logoVideo.volume = v;
      if (step >= steps) {
        logoVideo.volume = Math.max(0, Math.min(1, toVol));
        clearInterval(logoAudioRamp);
        logoAudioRamp = null;
        if (onDone) onDone();
      }
    }, stepMs);
  }

  /* ── Phase reactions ───────────────────────────────────── */
  const onPhaseChange = (newPhase) => {
    if (newPhase === PHASE.LOADING) {
      onPhaseEnterLoading();
      return;
    }
    onPhaseExitLoading();

    if (newPhase === PHASE.LOGO_HOLD) {
      // Show the rose instantly — no transition on opacity, no black flash.
      flag('logo-visible', true);
      // Reset the logo video to t=0 and start its audio. The video has
      // been looping silently since page load (covered by the gate then
      // by the cinematic), so resetting now gives the audio a clean
      // intro from frame 0 just as the rose becomes visible. The user
      // has already clicked the gate, so browser autoplay-with-sound
      // policies allow this.
      if (logoVideo) {
        try {
          logoVideo.currentTime = 0;
          logoVideo.muted = false;
          logoVideo.volume = 0;
          const p = logoVideo.play();
          if (p && typeof p.catch === 'function') p.catch(() => {});
        } catch (_) { /* no-op */ }
        rampLogoVolume(1.0, 700);
      }
      setTimeout(() => setPhase(PHASE.TRANSITIONING), 2000);
    } else if (newPhase === PHASE.TRANSITIONING) {
      // Blink the rose to its hero-side position (see helper above)
      // instead of the long animated translate-and-scale.
      blinkToCorner();
      // Hero text appears once the rose has reappeared at the side
      // (blink completes around 720ms, hero starts revealing at 900ms).
      setTimeout(() => revealHeroContent(),         900);
      setTimeout(() => setPhase(PHASE.HERO),        1600);
    } else if (newPhase === PHASE.HERO) {
      unlockScroll();
      // Fade out the logo audio as the rose settles into its hero
      // position. By the end of the fade, the video is muted so it
      // keeps looping silently in the background.
      if (logoVideo) {
        rampLogoVolume(0, 900, () => {
          try { logoVideo.muted = true; } catch (_) {}
        });
      }
    }
  };

  // Observe data-phase changes to drive reactions (decoupled from setPhase calls)
  const phaseObserver = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'attributes' && r.attributeName === 'data-phase') {
        onPhaseChange(body.getAttribute('data-phase'));
      }
    }
  });
  phaseObserver.observe(body, { attributes: true, attributeFilter: ['data-phase'] });

  /* ── Scroll lock / unlock ──────────────────────────────── */
  // CSS handles the lock via [body:not([data-phase="hero"])].
  // Once we hit HERO, we also wake up any reveal-on-scroll observers
  // by dispatching a synthetic scroll event.
  const unlockScroll = () => {
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event('scroll'));
    });
  };

  /* ── Fade the rose as the user scrolls past the hero ───── */
  // Once phase=hero, watch the scroll position. The rose (position:fixed)
  // would otherwise sit over the rest of the portfolio. Fade it out
  // smoothly during the first viewport of scrolling. Once fully hidden,
  // also pause the underlying mp4 so its decoder stops eating CPU/GPU.
  const fondoBg = document.getElementById('fondoBg');
  let logoPausedByScroll = false;
  const updateRoseOnScroll = () => {
    if (phase !== PHASE.HERO) return;
    const vh = window.innerHeight;
    const y = window.scrollY;
    const fadeStart = 0;
    const fadeEnd   = vh * 0.6;
    const t = Math.max(0, Math.min(1, (y - fadeStart) / (fadeEnd - fadeStart)));
    const opacity = 1 - t;
    introLogo.style.setProperty('--rose-opacity', opacity.toFixed(3));
    const scrolled = y > fadeEnd * 0.9;
    introLogo.setAttribute('data-scrolled', scrolled ? 'true' : 'false');

    // Pause the logo video once invisible — frees a video decoder.
    if (logoVideo) {
      if (scrolled && !logoPausedByScroll) {
        try { logoVideo.pause(); } catch (_) {}
        logoPausedByScroll = true;
      } else if (!scrolled && logoPausedByScroll) {
        try { logoVideo.play().catch(() => {}); } catch (_) {}
        logoPausedByScroll = false;
      }
    }
  };
  window.addEventListener('scroll', updateRoseOnScroll, { passive: true });

  /* ── Pause background videos when the tab is hidden ────────
     Browsers don't stop decoding looped <video> on background
     tabs reliably; pausing explicitly avoids CPU/battery waste
     when the user switches away. */
  document.addEventListener('visibilitychange', () => {
    const hidden = document.hidden;
    const targets = [fondoBg, logoVideo, document.querySelector('.cursor-glitch-video')];
    for (const v of targets) {
      if (!v) continue;
      if (hidden) {
        try { v.pause(); } catch (_) {}
      } else {
        // Don't auto-resume the logo if it's already scrolled out.
        if (v === logoVideo && logoPausedByScroll) continue;
        try { v.play().catch(() => {}); } catch (_) {}
      }
    }
  });
})();
