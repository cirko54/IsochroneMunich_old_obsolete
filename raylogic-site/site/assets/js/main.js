// RayLogic – UI-Interaktionen (ohne Abhängigkeiten)
(() => {
  "use strict";

  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = matchMedia("(hover: hover) and (pointer: fine)").matches;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  // ---------- Header: Glas-Effekt ab Scroll, beim Runterscrollen ausblenden ----------
  const header = $("[data-header]");
  const progress = $(".progress");
  const nativeProgress = CSS.supports("animation-timeline: scroll()");
  let lastY = scrollY;
  let ticking = false;

  const onScroll = () => {
    const y = scrollY;
    header.classList.toggle("is-scrolled", y > 12);
    const navOpen = header.querySelector(".nav.is-open");
    header.classList.toggle("is-hidden", !navOpen && y > 400 && y > lastY + 2);
    if (y < lastY - 2 || y < 400) header.classList.remove("is-hidden");
    lastY = y;
    if (!nativeProgress && progress) {
      const max = document.documentElement.scrollHeight - innerHeight;
      progress.style.setProperty("--p", max > 0 ? (y / max).toFixed(4) : 0);
    }
    ticking = false;
  };
  addEventListener("scroll", () => {
    if (!ticking) { requestAnimationFrame(onScroll); ticking = true; }
  }, { passive: true });
  onScroll();

  // ---------- Mobile Navigation ----------
  const toggle = $("[data-nav-toggle]");
  const nav = $("[data-nav]");
  const setNav = (open) => {
    toggle.setAttribute("aria-expanded", String(open));
    nav.classList.toggle("is-open", open);
  };
  toggle?.addEventListener("click", () => setNav(toggle.getAttribute("aria-expanded") !== "true"));
  nav?.addEventListener("click", (e) => { if (e.target.closest("a")) setNav(false); });
  addEventListener("keydown", (e) => { if (e.key === "Escape") setNav(false); });

  // ---------- Aktiver Navigationspunkt ----------
  const navLinks = new Map($$(".nav a[href^='#']").map((a) => [a.hash.slice(1), a]));
  const sectionIO = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      navLinks.forEach((a) => a.classList.remove("is-active"));
      navLinks.get(e.target.id)?.classList.add("is-active");
    }
  }, { rootMargin: "-45% 0px -50% 0px" });
  navLinks.forEach((_, id) => { const s = document.getElementById(id); if (s) sectionIO.observe(s); });

  // ---------- Überschrift wortweise animieren ----------
  for (const el of $$("[data-split]")) {
    let i = 0;
    const walk = (node) => {
      for (const child of [...node.childNodes]) {
        if (child.nodeType === Node.TEXT_NODE) {
          const frag = document.createDocumentFragment();
          for (const part of child.textContent.split(/(\s+)/)) {
            if (!part) continue;
            if (/^\s+$/.test(part)) { frag.append(" "); continue; }
            const outer = document.createElement("span");
            outer.className = "split-word";
            const inner = document.createElement("span");
            inner.style.setProperty("--i", i++);
            inner.textContent = part;
            outer.append(inner);
            frag.append(outer);
          }
          child.replaceWith(frag);
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          walk(child);
        }
      }
    };
    walk(el);
    el.setAttribute("aria-label", el.textContent.replace(/\s+/g, " ").trim());
  }

  // ---------- Scroll-Reveal mit Staffelung ----------
  const revealIO = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add("is-visible");
      revealIO.unobserve(e.target);
    }
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });

  const groups = new Map();
  for (const el of $$(".reveal")) {
    const parent = el.parentElement;
    const idx = groups.get(parent) ?? 0;
    groups.set(parent, idx + 1);
    el.style.setProperty("--d", `${Math.min(idx, 6) * 90}ms`);
    revealIO.observe(el);
  }
  for (const el of $$("[data-steps]")) revealIO.observe(el);

  // ---------- Zähler ----------
  const fmt = new Intl.NumberFormat("de-DE");
  const countIO = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      countIO.unobserve(e.target);
      const el = e.target;
      const target = Number(el.dataset.count);
      const suffix = el.dataset.suffix ?? "";
      if (reduceMotion) { el.textContent = fmt.format(target) + suffix; continue; }
      const t0 = performance.now();
      const dur = 1600;
      const step = (t) => {
        const p = Math.min(1, (t - t0) / dur);
        const eased = 1 - Math.pow(1 - p, 4);
        el.textContent = fmt.format(Math.round(target * eased)) + suffix;
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
  }, { threshold: 0.6 });
  $$("[data-count]").forEach((el) => countIO.observe(el));

  // ---------- Spotlight unter dem Mauszeiger ----------
  if (finePointer) {
    for (const el of $$("[data-spotlight]")) {
      el.addEventListener("pointermove", (e) => {
        const r = el.getBoundingClientRect();
        el.style.setProperty("--x", `${e.clientX - r.left}px`);
        el.style.setProperty("--y", `${e.clientY - r.top}px`);
      });
    }
  }

  // ---------- Magnetische Buttons ----------
  if (finePointer && !reduceMotion) {
    for (const el of $$("[data-magnetic]")) {
      el.addEventListener("pointermove", (e) => {
        const r = el.getBoundingClientRect();
        const dx = (e.clientX - (r.left + r.width / 2)) * 0.25;
        const dy = (e.clientY - (r.top + r.height / 2)) * 0.35;
        el.style.setProperty("--mx", `${dx}px`);
        el.style.setProperty("--my", `${dy}px`);
      });
      el.addEventListener("pointerleave", () => {
        el.style.setProperty("--mx", "0px");
        el.style.setProperty("--my", "0px");
      });
    }
  }

  // ---------- Jahr im Footer ----------
  $$("[data-year]").forEach((el) => { el.textContent = new Date().getFullYear(); });
})();
