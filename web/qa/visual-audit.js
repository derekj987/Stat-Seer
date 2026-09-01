/*
 * StatSeer visual audit — pasteable browser probe.
 *
 * Runs entirely in the page (no deps) and returns JSON describing the layout/visual bug classes
 * Derek keeps catching by eye: horizontal overflow, unequal card heights in a row, elements that
 * collapsed to zero size, clipped text, invisible/low-contrast text (the filled-bar-blank family),
 * buttons whose clicks are intercepted by an overlay (the "move button doesn't work" family), and
 * broken images.
 *
 * Usage: the `visual-audit` skill pastes this whole file into the browser javascript_tool on each
 * page in the checklist; the trailing IIFE is the returned value. Console errors and network 4xx/5xx
 * are collected separately by the skill (read_console_messages / read_network_requests) — they can't
 * be read from inside the page.
 *
 * Tunables via window.__SS_AUDIT_CFG (all optional): { rowHeightTol, contrastMin, maxPerType }.
 */
(() => {
  const CFG = Object.assign(
    { rowHeightTol: 16, sameRowTol: 10, contrastMin: 2.0, maxPerType: 12, minText: 1 },
    (typeof window !== "undefined" && window.__SS_AUDIT_CFG) || {},
  );
  const vw = window.innerWidth, vh = window.innerHeight;
  const findings = [];
  const add = (type, severity, el, detail, extra) =>
    findings.push(Object.assign({ type, severity, sel: selOf(el), detail }, extra || {}));

  // ---- helpers ---------------------------------------------------------------
  const vis = (el) => {
    // checkVisibility() accounts for display:none / visibility:hidden / opacity:0 anywhere up the
    // ancestor chain — critical so elements inside a hidden container (the desktop-hidden Dock, a
    // collapsed mobile subnav) aren't mis-flagged as visible-but-zero-size.
    if (el.checkVisibility) return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true });
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false;
    return el.offsetParent !== null || s.position === "fixed";
  };
  const rectOf = (el) => el.getBoundingClientRect();
  const onScreenish = (r) => r.bottom > -50 && r.top < vh + 50; // within a screen of the viewport
  function selOf(el) {
    if (!el || el === document.body) return "body";
    const parts = [];
    let n = el, depth = 0;
    while (n && n.nodeType === 1 && n !== document.body && depth < 4) {
      let p = n.tagName.toLowerCase();
      if (n.id) { p += "#" + n.id; parts.unshift(p); break; }
      const cls = (n.getAttribute("class") || "").trim().split(/\s+/).filter(Boolean).slice(0, 2);
      if (cls.length) p += "." + cls.join(".");
      const sibs = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName) : [];
      if (sibs.length > 1) p += `:nth(${sibs.indexOf(n) + 1})`;
      parts.unshift(p); n = n.parentElement; depth++;
    }
    return parts.join(" > ");
  }
  // relative luminance + contrast ratio
  const lum = (r, g, b) => {
    const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const parseRGB = (s) => {
    const m = (s || "").match(/rgba?\(([^)]+)\)/); if (!m) return null;
    const p = m[1].split(",").map((x) => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p[3] == null ? 1 : p[3] };
  };
  function effectiveBg(el) {
    let n = el;
    while (n && n.nodeType === 1) {
      const cs = getComputedStyle(n);
      // Over a background-image / gradient we can't read the pixels behind the text, so a solid-color
      // contrast check would be bogus (nav name over the hero image, a card over a photo). Bail out.
      if (cs.backgroundImage && cs.backgroundImage !== "none") return null;
      const c = parseRGB(cs.backgroundColor);
      if (c && c.a > 0.1) return c;
      n = n.parentElement;
    }
    return null; // no opaque background anywhere up the chain → text likely sits over imagery; skip
  }
  const contrast = (c1, c2) => {
    const l1 = lum(c1.r, c1.g, c1.b), l2 = lum(c2.r, c2.g, c2.b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const directText = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join("").trim();
  const cap = (arr, t) => arr.filter((f) => f.type === t).length >= CFG.maxPerType;

  // ---- 1. Horizontal page overflow ------------------------------------------
  const doc = document.scrollingElement || document.documentElement;
  if (doc.scrollWidth > vw + 2) {
    const offenders = [];
    for (const el of document.body.querySelectorAll("*")) {
      if (!vis(el)) continue;
      const r = rectOf(el);
      if (r.width === 0) continue;
      if (r.right > vw + 2 && r.width <= vw + 40) offenders.push({ el, past: Math.round(r.right - vw) });
    }
    offenders.sort((a, b) => b.past - a.past);
    add("page-overflow-x", "high", doc, `page scrollWidth ${doc.scrollWidth} > viewport ${vw} (+${doc.scrollWidth - vw}px)`,
      { offenders: offenders.slice(0, 5).map((o) => ({ sel: selOf(o.el), pastPx: o.past })) });
  }

  // ---- 2. Unequal heights among cards sharing a row -------------------------
  const rowContainers = document.querySelectorAll(
    ".daygrid, .grid, .propstack, .chealth, .bank__stats, .cards, [class*='grid']");
  for (const c of rowContainers) {
    if (cap(findings, "unequal-row-height")) break;
    const kids = [...c.children].filter((k) => vis(k) && rectOf(k).height > 0);
    if (kids.length < 2) continue;
    // group by row via rounded top
    const rows = new Map();
    for (const k of kids) {
      const top = Math.round(rectOf(k).top / CFG.sameRowTol) * CFG.sameRowTol;
      (rows.get(top) || rows.set(top, []).get(top)).push(k);
    }
    for (const group of rows.values()) {
      if (group.length < 2) continue;
      const hs = group.map((k) => Math.round(rectOf(k).height));
      const spread = Math.max(...hs) - Math.min(...hs);
      if (spread > CFG.rowHeightTol) {
        add("unequal-row-height", "medium", c, `${group.length} siblings in a row differ by ${spread}px`, { heights: hs });
        break; // one finding per container is enough
      }
    }
  }

  // ---- 3. Zero-size elements that clearly intend to be visible ---------------
  for (const el of document.querySelectorAll("button, a, img, svg, [class*='badge'], [class*='ring'], [class*='dot'], [class*='avatar']")) {
    if (cap(findings, "zero-size")) break;
    if (!vis(el)) continue;
    if (el.hasAttribute("hidden") || el.getAttribute("aria-hidden") === "true") continue;
    const tag = el.tagName.toLowerCase();
    const hasContent = tag === "img" || tag === "svg" || directText(el).length >= CFG.minText || el.querySelector("img,svg");
    if (!hasContent) continue;
    const r = rectOf(el);
    if ((r.width < 1 || r.height < 1)) add("zero-size", "medium", el, `${tag} is visible but ${Math.round(r.width)}×${Math.round(r.height)}px`);
  }

  // ---- 4. Clipped text (single-line ellipsis cutting content) ---------------
  for (const el of document.querySelectorAll("*")) {
    if (cap(findings, "clipped-text")) break;
    if (!vis(el)) continue;
    const t = directText(el); if (t.length < 3) continue;
    const s = getComputedStyle(el);
    if (s.overflow === "visible" && s.overflowX === "visible") continue;
    const r = rectOf(el); if (!onScreenish(r)) continue;
    if (el.scrollWidth > el.clientWidth + 2 && (s.whiteSpace === "nowrap" || s.textOverflow === "ellipsis")) {
      add("clipped-text", "low", el, `text clipped: scrollW ${el.scrollWidth} > clientW ${el.clientWidth} ("${t.slice(0, 30)}")`);
    }
  }

  // ---- 5. Invisible / very low-contrast text --------------------------------
  for (const el of document.querySelectorAll("*")) {
    if (cap(findings, "low-contrast-text")) break;
    if (!vis(el)) continue;
    const t = directText(el); if (t.length < 2) continue;
    const r = rectOf(el); if (r.width < 2 || r.height < 2 || !onScreenish(r)) continue;
    const fg = parseRGB(getComputedStyle(el).color); if (!fg || fg.a < 0.1) continue;
    const bg = effectiveBg(el); if (!bg) continue; // text over an image — can't assess reliably
    const ratio = contrast(fg, bg);
    if (ratio < CFG.contrastMin) add("low-contrast-text", ratio < 1.25 ? "high" : "medium", el,
      `contrast ${ratio.toFixed(2)} ("${t.slice(0, 30)}")`);
  }

  // ---- 6. Interactive controls whose clicks are intercepted -----------------
  for (const el of document.querySelectorAll("button, a[href], [role='button'], summary, label[for]")) {
    if (cap(findings, "click-intercepted")) break;
    if (!vis(el) || el.disabled) continue;
    const r = rectOf(el);
    if (r.width < 6 || r.height < 6) continue;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (cx < 0 || cy < 0 || cx > vw || cy > vh) continue; // must be in the viewport to hit-test
    const hit = document.elementFromPoint(cx, cy);
    if (!hit) continue;
    if (hit !== el && !el.contains(hit) && !hit.contains(el)) {
      add("click-intercepted", "high", el, `center covered by ${selOf(hit)} — clicks may not reach it`);
    }
    if (getComputedStyle(el).pointerEvents === "none") add("click-intercepted", "high", el, "pointer-events:none");
  }

  // ---- 7. Broken images ------------------------------------------------------
  for (const img of document.querySelectorAll("img")) {
    if (cap(findings, "broken-image")) break;
    if (img.getAttribute("src") && img.complete && img.naturalWidth === 0) add("broken-image", "high", img, `failed to load: ${img.getAttribute("src")}`);
  }

  const bySev = { high: 0, medium: 0, low: 0 };
  for (const f of findings) bySev[f.severity] = (bySev[f.severity] || 0) + 1;
  return JSON.stringify({
    url: location.pathname + location.search,
    viewport: `${vw}x${vh}`,
    theme: document.documentElement.getAttribute("data-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark(system)" : "light(system)"),
    counts: bySev,
    findings,
  }, null, 1);
})();
