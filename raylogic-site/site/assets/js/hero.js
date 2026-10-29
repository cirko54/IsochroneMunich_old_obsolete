// RayLogic – Hero-Animation: rotierende Bestrahlungsfelder (VMAT-artig)
// mit live berechneter Dosisverteilung und Isodosenlinien (Marching Squares).
(() => {
  "use strict";

  const canvas = document.querySelector("[data-hero-canvas]");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const wash = document.createElement("canvas");
  const wctx = wash.getContext("2d");

  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const LEVELS = [0.2, 0.5, 0.8, 0.95];
  const BEAMS = 9;
  const CELL = 7;          // Rasterweite in CSS-px
  const MU = 0.0005;       // Schwächung pro px Tiefe
  const PENUMBRA = 7;      // Halbschatten in px

  let W = 0, H = 0, dpr = 1, cols = 0, rows = 0;
  let field = new Float32Array(0);
  let img = null;
  let colors = {};
  let ready = false, running = false, visible = true, rafId = 0, last = 0;
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };

  const readColors = () => {
    const cs = getComputedStyle(document.documentElement);
    const get = (n) => cs.getPropertyValue(n).trim();
    const rgb = (hex) => {
      const h = hex.replace("#", "");
      const n = parseInt(h.length === 3 ? h.replace(/./g, "$&$&") : h, 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    colors = {
      iso: [get("--iso-20"), get("--iso-50"), get("--iso-80"), get("--iso-95")],
      isoRgb: [get("--iso-20"), get("--iso-50"), get("--iso-80"), get("--iso-95")].map(rgb),
      line: get("--line"),
      muted: get("--muted"),
      accent: get("--accent"),
      light: matchMedia("(prefers-color-scheme: light)").matches,
    };
  };

  const resize = () => {
    const r = canvas.getBoundingClientRect();
    W = Math.max(1, r.width);
    H = Math.max(1, r.height);
    dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    cols = Math.ceil(W / CELL) + 1;
    rows = Math.ceil(H / CELL) + 1;
    field = new Float32Array(cols * rows);
    wash.width = cols;
    wash.height = rows;
    img = wctx.createImageData(cols, rows);
  };

  // Geometrie: Ziel rechts (Desktop) bzw. oben (Mobil), Größe relativ zum Viewport
  const geometry = (t) => {
    const mobile = W < 760;
    const cx = (mobile ? 0.68 : 0.7) * W + pointer.x * 30;
    const cy = (mobile ? 0.2 : 0.5) * H + pointer.y * 30;
    const R = Math.min(W, H) * (mobile ? 0.11 : 0.14);
    const gantry = Math.min(W, H) * (mobile ? 0.36 : 0.42);
    const theta0 = t * 0.00012;
    return { cx, cy, R, gantry, theta0, t };
  };

  // Feldbreite als Funktion des Einstrahlwinkels → irreguläres, "atmendes" Zielvolumen
  const halfWidth = (g, theta) =>
    g.R * (1 + 0.22 * Math.sin(2 * theta + g.t * 0.0004) + 0.1 * Math.sin(3 * theta - g.t * 0.00025));

  // Normierung auf das Isozentrum (dort tragen alle Felder ≈ 1 bei)
  const norm = 1 / BEAMS;

  const computeField = (g) => {
    const beams = [];
    for (let i = 0; i < BEAMS; i++) {
      const th = g.theta0 + (i * Math.PI * 2) / BEAMS;
      beams.push({ ux: Math.cos(th), uy: Math.sin(th), w: halfWidth(g, th) });
    }
    for (let j = 0; j < rows; j++) {
      const dy = j * CELL - g.cy;
      for (let i = 0; i < cols; i++) {
        const dx = i * CELL - g.cx;
        let d = 0;
        for (const b of beams) {
          const lat = Math.abs(dx * b.uy - dy * b.ux);
          if (lat > b.w + PENUMBRA * 6) continue;
          const depth = dx * b.ux + dy * b.uy;
          const prof = 1 / (1 + Math.exp((lat - b.w) / PENUMBRA));
          d += prof * Math.exp(-MU * depth);
        }
        field[j * cols + i] = d * norm;
      }
    }
    return beams;
  };

  const drawWash = () => {
    const data = img.data;
    const [c20, c50, c80, c95] = colors.isoRgb;
    const a = colors.light ? 0.75 : 1;
    for (let k = 0; k < field.length; k++) {
      const v = field[k];
      let c, alpha;
      if (v < 0.2) { c = c20; alpha = v * 0.35; }
      else if (v < 0.5) { c = c20; alpha = 0.07 + (v - 0.2) * 0.25; }
      else if (v < 0.8) { c = c50; alpha = 0.12 + (v - 0.5) * 0.25; }
      else if (v < 0.95) { c = c80; alpha = 0.2; }
      else { c = c95; alpha = 0.26; }
      const o = k * 4;
      data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2];
      data[o + 3] = alpha * 255 * a;
    }
    wctx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(wash, 0, 0, cols * CELL, rows * CELL);
  };

  // Marching Squares mit linearer Interpolation
  const drawIso = (level, color, width) => {
    ctx.beginPath();
    const lerp = (a, b) => (level - a) / (b - a);
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const k = j * cols + i;
        const a = field[k], b = field[k + 1], c = field[k + cols + 1], d = field[k + cols];
        const idx = (a > level) | ((b > level) << 1) | ((c > level) << 2) | ((d > level) << 3);
        if (idx === 0 || idx === 15) continue;
        const x = i * CELL, y = j * CELL;
        const top = [x + CELL * lerp(a, b), y];
        const right = [x + CELL, y + CELL * lerp(b, c)];
        const bottom = [x + CELL * lerp(d, c), y + CELL];
        const left = [x, y + CELL * lerp(a, d)];
        const seg = (p, q) => { ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); };
        switch (idx) {
          case 1: case 14: seg(left, top); break;
          case 2: case 13: seg(top, right); break;
          case 3: case 12: seg(left, right); break;
          case 4: case 11: seg(right, bottom); break;
          case 6: case 9: seg(top, bottom); break;
          case 7: case 8: seg(left, bottom); break;
          case 5: seg(left, top); seg(right, bottom); break;
          case 10: seg(top, right); seg(left, bottom); break;
        }
      }
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  };

  const drawGantry = (g, beams) => {
    ctx.save();
    // Gantry-Ring
    ctx.strokeStyle = colors.line;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 6]);
    ctx.beginPath();
    ctx.arc(g.cx, g.cy, g.gantry, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Quellen auf dem Ring + feine Zentralstrahlen
    for (const b of beams) {
      const sx = g.cx - b.ux * g.gantry;
      const sy = g.cy - b.uy * g.gantry;
      const grad = ctx.createLinearGradient(sx, sy, g.cx, g.cy);
      grad.addColorStop(0, colors.accent);
      grad.addColorStop(1, "transparent");
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = grad;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(g.cx, g.cy);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = colors.accent;
      ctx.beginPath();
      ctx.arc(sx, sy, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Isozentrum-Fadenkreuz
    ctx.strokeStyle = colors.muted;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.moveTo(g.cx - 8, g.cy); ctx.lineTo(g.cx + 8, g.cy);
    ctx.moveTo(g.cx, g.cy - 8); ctx.lineTo(g.cx, g.cy + 8);
    ctx.stroke();
    ctx.restore();
  };

  const drawGrid = () => {
    ctx.save();
    ctx.fillStyle = colors.line;
    const step = 28;
    for (let y = step / 2; y < H; y += step) {
      for (let x = step / 2; x < W; x += step) ctx.fillRect(x, y, 1, 1);
    }
    ctx.restore();
  };

  const render = (t) => {
    pointer.x += (pointer.tx - pointer.x) * 0.05;
    pointer.y += (pointer.ty - pointer.y) * 0.05;
    const g = geometry(t);
    const beams = computeField(g);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    drawGrid();
    drawWash();
    drawGantry(g, beams);
    LEVELS.forEach((lv, i) => drawIso(lv, colors.iso[i], i === 3 ? 1.8 : 1.2));
  };

  const loop = (t) => {
    rafId = requestAnimationFrame(loop);
    if (t - last < 1000 / 40) return; // ~40 fps genügen
    last = t;
    render(t);
  };

  const start = () => {
    if (!ready || running || reduceMotion.matches || !visible || document.hidden) return;
    running = true;
    rafId = requestAnimationFrame(loop);
  };
  const stop = () => { running = false; cancelAnimationFrame(rafId); };

  const init = () => {
    readColors();
    resize();
    render(performance.now());
    canvas.classList.add("is-ready");
    ready = true;
    start();
  };

  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    visible ? start() : stop();
  }).observe(canvas);

  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
  reduceMotion.addEventListener("change", () => { if (!ready) return; stop(); render(performance.now()); start(); });
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => { if (!ready) return; readColors(); render(performance.now()); });

  let resizeTimer;
  addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (!ready) return; resize(); render(performance.now()); }, 120);
  });

  addEventListener("pointermove", (e) => {
    pointer.tx = (e.clientX / innerWidth - 0.5) * 2;
    pointer.ty = (e.clientY / innerHeight - 0.5) * 2;
  }, { passive: true });

  if (document.fonts?.ready) document.fonts.ready.then(init); else init();
})();
