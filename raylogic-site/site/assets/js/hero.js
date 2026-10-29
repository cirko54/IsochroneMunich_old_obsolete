// RayLogic – Hero-Animation: Patientenpfad als Warteschlangen-Simulation.
// Patienten fließen durch Stationen. Phase "Ist": verschlungene Wege und ein
// Engpass, an dem sich eine Schlange bildet. Phase "Optimiert": die Wege
// glätten sich, der Engpass wird schneller bedient, die Schlange löst sich auf.
(() => {
  "use strict";

  const canvas = document.querySelector("[data-hero-canvas]");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const phaseEl = document.querySelector("[data-hero-phase]");
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

  const STATIONS = ["Anmeldung", "Diagnostik", "Befundung", "Therapie", "Nachsorge"];
  const BOTTLENECK = 1;
  const PHASE_MS = { ist: 9000, soll: 7000 };
  const SPAWN_MS = 520;
  const SERVICE_MS = { base: 170, ist: 1300, soll: 210 };
  const SPEED = { ist: 150, soll: 230 }; // px/s
  const MAX_PARTICLES = 80;

  let W = 0, H = 0, dpr = 1, mobile = false;
  let nodes = [], segs = [], particles = [], queues = [], busyUntil = [];
  let colors = {};
  let phase = "ist", phaseStart = 0, mess = 1, lastSpawn = 0, simTime = 0;
  let ready = false, running = false, visible = true, rafId = 0, lastFrame = 0;
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };

  // Deterministischer Zufall, damit das "Chaos" bei jedem Laden gleich aussieht
  const rng = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  const tangle = STATIONS.map(() => [rng(), rng(), rng(), rng()]);

  const readColors = () => {
    const cs = getComputedStyle(document.documentElement);
    const get = (n) => cs.getPropertyValue(n).trim();
    colors = {
      accent: get("--accent"),
      accent2: get("--accent-2"),
      text: get("--text"),
      muted: get("--muted"),
      line: get("--line"),
      bg: get("--bg"),
    };
  };

  const resize = () => {
    const r = canvas.getBoundingClientRect();
    W = Math.max(1, r.width);
    H = Math.max(1, r.height);
    dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    mobile = W < 1100;
    layout();
  };

  // Stationen: Desktop rechts als Zickzack nach unten, schmal als Band oben
  const layout = () => {
    const vh = Math.min(H, innerHeight);
    const pos = mobile
      ? [[0.12, 0.13], [0.4, 0.23], [0.7, 0.12], [0.88, 0.27], [0.58, 0.36]]
      : [[0.64, 0.2], [0.88, 0.31], [0.67, 0.5], [0.9, 0.67], [0.68, 0.83]];
    nodes = pos.map(([x, y], i) => ({ bx: x * W, by: y * vh, x: 0, y: 0, pulse: 0, label: STATIONS[i] }));
    queues = nodes.map(() => []);
    busyUntil = nodes.map(() => 0);
    particles = [];
  };

  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  const buildSegments = () => {
    const shift = mobile ? 6 : 14;
    for (const n of nodes) { n.x = n.bx + pointer.x * shift; n.y = n.by + pointer.y * shift; }
    segs = [];
    for (let i = 0; i < nodes.length - 1; i++) {
      const a = nodes[i], b = nodes[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      const s = i % 2 ? 1 : -1;
      const [r1, r2, r3, r4] = tangle[i];
      // ideale, sanfte S-Kurve
      const i1 = [a.x + dx * 0.33 + nx * len * 0.12 * s, a.y + dy * 0.33 + ny * len * 0.12 * s];
      const i2 = [a.x + dx * 0.66 - nx * len * 0.12 * s, a.y + dy * 0.66 - ny * len * 0.12 * s];
      // verschlungener Umweg mit Schleife
      const t1 = [a.x + dx * (0.9 + r1 * 0.5) + nx * len * (0.7 + r2 * 0.5) * s, a.y + dy * (0.9 + r1 * 0.5) + ny * len * (0.7 + r2 * 0.5) * s];
      const t2 = [a.x + dx * (0.1 - r3 * 0.5) - nx * len * (0.6 + r4 * 0.5) * s, a.y + dy * (0.1 - r3 * 0.5) - ny * len * (0.6 + r4 * 0.5) * s];
      const m = ease(mess);
      const c1 = clampPt([lerp(i1[0], t1[0], m), lerp(i1[1], t1[1], m)]);
      const c2 = clampPt([lerp(i2[0], t2[0], m), lerp(i2[1], t2[1], m)]);
      const seg = { p0: [a.x, a.y], c1, c2, p3: [b.x, b.y], len: 0 };
      let prev = seg.p0, L = 0;
      for (let k = 1; k <= 20; k++) { const p = bez(seg, k / 20); L += Math.hypot(p[0] - prev[0], p[1] - prev[1]); prev = p; }
      seg.len = L;
      segs.push(seg);
    }
  };

  // Kontrollpunkte im sichtbaren Bereich halten (Desktop: rechte Hälfte)
  const clampPt = ([x, y]) => {
    const vh = Math.min(H, innerHeight);
    const minX = mobile ? 16 : W * 0.56;
    return [Math.min(W - 24, Math.max(minX, x)), Math.min(vh - 24, Math.max(mobile ? 24 : 90, y))];
  };

  const bez = (s, t) => {
    const u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    return [a * s.p0[0] + b * s.c1[0] + c * s.c2[0] + d * s.p3[0], a * s.p0[1] + b * s.c1[1] + c * s.c2[1] + d * s.p3[1]];
  };

  const setPhase = (p, now) => {
    phase = p;
    phaseStart = now;
    if (phaseEl) {
      phaseEl.dataset.state = p;
      phaseEl.textContent = p === "ist"
        ? `Ist-Ablauf · Engpass ${STATIONS[BOTTLENECK]}`
        : "Optimierter Ablauf · Wartezeit sinkt";
    }
  };

  const step = (now, dt) => {
    if (now - phaseStart > PHASE_MS[phase]) setPhase(phase === "ist" ? "soll" : "ist", now);
    const target = phase === "ist" ? 1 : 0;
    mess += (target - mess) * Math.min(1, dt / 900);

    // Neue Patienten
    if (now - lastSpawn > SPAWN_MS && particles.length < MAX_PARTICLES) {
      lastSpawn = now;
      const p = { state: "wait", node: 0, seg: 0, t: 0, x: nodes[0].x - 30, y: nodes[0].y, a: 0 };
      particles.push(p);
      queues[0].push(p);
    }

    // Stationen bedienen (je ein Platz)
    for (let k = 0; k < nodes.length; k++) {
      if (now < busyUntil[k] || !queues[k].length) continue;
      const p = queues[k].shift();
      let svc = SERVICE_MS.base;
      if (k === BOTTLENECK) svc = lerp(SERVICE_MS.soll, SERVICE_MS.ist, mess);
      busyUntil[k] = now + svc;
      p.state = "serve";
      p.until = now + svc;
      nodes[k].pulse = 1;
    }

    const speed = lerp(SPEED.soll, SPEED.ist, mess);
    for (const p of particles) {
      if (p.state === "serve" && now >= p.until) {
        if (p.node === nodes.length - 1) { p.state = "out"; p.vx = 40; p.vy = 18; }
        else { p.state = "move"; p.seg = p.node; p.t = 0; }
      }
      if (p.state === "move") {
        const s = segs[p.seg];
        p.t += (speed * dt) / 1000 / Math.max(1, s.len);
        if (p.t >= 1) { p.state = "wait"; p.node = p.seg + 1; queues[p.node].push(p); }
      }
    }

    // Zielpositionen und Darstellung
    for (const p of particles) {
      let tx, ty;
      if (p.state === "move") {
        [tx, ty] = bez(segs[p.seg], p.t);
        p.x = tx; p.y = ty;
      } else if (p.state === "wait" || p.state === "serve") {
        const n = nodes[p.node];
        const qi = p.state === "serve" ? -1 : queues[p.node].indexOf(p);
        if (qi < 0) { tx = n.x; ty = n.y; }
        else {
          const ang = qi * 2.39996 + simTime * 0.0004;
          const r = 15 + 5 * Math.sqrt(qi);
          tx = n.x + Math.cos(ang) * r; ty = n.y + Math.sin(ang) * r;
        }
        p.x += (tx - p.x) * Math.min(1, dt / 120);
        p.y += (ty - p.y) * Math.min(1, dt / 120);
      } else if (p.state === "out") {
        p.x += (p.vx * dt) / 1000; p.y += (p.vy * dt) / 1000;
        p.a -= dt / 700;
      }
      if (p.state !== "out") p.a = Math.min(1, p.a + dt / 400);
    }
    particles = particles.filter((p) => p.state !== "out" || p.a > 0);
    for (const n of nodes) n.pulse = Math.max(0, n.pulse - dt / 500);
  };

  const draw = () => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // dezentes Punktraster
    ctx.fillStyle = colors.line;
    for (let y = 14; y < H; y += 28) for (let x = 14; x < W; x += 28) ctx.fillRect(x, y, 1, 1);

    // Wege
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = colors.accent2;
    ctx.globalAlpha = 0.55;
    for (const s of segs) {
      ctx.beginPath();
      ctx.moveTo(s.p0[0], s.p0[1]);
      ctx.bezierCurveTo(s.c1[0], s.c1[1], s.c2[0], s.c2[1], s.p3[0], s.p3[1]);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Patienten in Bewegung mit kurzer Spur
    for (const p of particles) {
      if (p.state !== "move") continue;
      const s = segs[p.seg];
      const tail = bez(s, Math.max(0, p.t - 18 / Math.max(1, s.len)));
      ctx.globalAlpha = 0.35 * p.a;
      ctx.strokeStyle = colors.accent;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(tail[0], tail[1]); ctx.lineTo(p.x, p.y); ctx.stroke();
    }

    // Stationen
    ctx.font = `500 ${mobile ? 10 : 12}px "JetBrains Mono", ui-monospace, monospace`;
    ctx.textBaseline = "middle";
    nodes.forEach((n, k) => {
      const q = queues[k].length;
      if (q >= 3) {
        const r = 22 + 5 * Math.sqrt(q);
        const g = ctx.createRadialGradient(n.x, n.y, 4, n.x, n.y, r + 14);
        g.addColorStop(0, colors.accent);
        g.addColorStop(1, "transparent");
        ctx.globalAlpha = Math.min(0.35, 0.06 * q);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(n.x, n.y, r + 14, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = colors.bg;
      ctx.strokeStyle = colors.accent;
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(n.x, n.y, 8 + n.pulse * 3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = colors.accent;
      ctx.beginPath(); ctx.arc(n.x, n.y, 3, 0, Math.PI * 2); ctx.fill();

      const right = n.x < W - 110;
      ctx.textAlign = right ? "left" : "right";
      ctx.fillStyle = colors.muted;
      ctx.fillText(n.label, n.x + (right ? 16 : -16), n.y - (mobile ? 16 : 18));
    });

    // Patienten
    for (const p of particles) {
      const waiting = p.state === "wait";
      ctx.globalAlpha = p.a * (waiting ? 0.95 : 1);
      ctx.fillStyle = waiting ? colors.text : colors.accent;
      ctx.beginPath(); ctx.arc(p.x, p.y, waiting ? 2.6 : 3.1, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  };

  const frame = (now) => {
    const dt = Math.min(50, now - lastFrame || 16);
    lastFrame = now;
    simTime += dt;
    pointer.x += (pointer.tx - pointer.x) * 0.05;
    pointer.y += (pointer.ty - pointer.y) * 0.05;
    buildSegments();
    step(simTime, dt);
    draw();
  };

  const loop = (now) => { rafId = requestAnimationFrame(loop); frame(now); };

  // Statisches Bild für reduzierte Bewegung: optimierten Zustand vorsimulieren
  const renderStatic = () => {
    setPhase("soll", 0);
    mess = 0;
    for (let i = 0; i < 400; i++) { simTime += 16; buildSegments(); step(simTime, 16); }
    draw();
  };

  // Einige Sekunden vorsimulieren, damit schon das erste Bild Patienten und Schlange zeigt
  const prewarm = () => {
    for (let i = 0; i < 300; i++) { simTime += 16; buildSegments(); step(simTime, 16); }
  };

  const start = () => {
    if (!ready || running || reduceMotion.matches || !visible || document.hidden) return;
    running = true;
    lastFrame = performance.now();
    rafId = requestAnimationFrame(loop);
  };
  const stop = () => { running = false; cancelAnimationFrame(rafId); };

  const init = () => {
    readColors();
    resize();
    setPhase("ist", 0);
    if (reduceMotion.matches) renderStatic(); else { prewarm(); draw(); }
    canvas.classList.add("is-ready");
    ready = true;
    start();
  };

  new IntersectionObserver(([e]) => { visible = e.isIntersecting; visible ? start() : stop(); }).observe(canvas);
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
  reduceMotion.addEventListener("change", () => { if (!ready) return; stop(); if (reduceMotion.matches) renderStatic(); else start(); });
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => { if (!ready) return; readColors(); draw(); });
  new MutationObserver(() => { if (ready) { readColors(); draw(); } })
    .observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  let resizeTimer;
  addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!ready) return;
      resize(); setPhase("ist", simTime);
      if (reduceMotion.matches) renderStatic(); else { prewarm(); draw(); }
    }, 150);
  });

  addEventListener("pointermove", (e) => {
    pointer.tx = (e.clientX / innerWidth - 0.5) * 2;
    pointer.ty = (e.clientY / innerHeight - 0.5) * 2;
  }, { passive: true });

  if (document.fonts?.ready) document.fonts.ready.then(init); else init();
})();
