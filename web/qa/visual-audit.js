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

  // ---- 8. Text bleeding out of its bubble (pill / badge / chip / tag) --------
  // A "bubble" is a small rounded element with a fill or border. If its content extent
  // (scrollWidth/Height) exceeds its box, the text spills past the rounded edge — the mobile
  // "text bleeding over bubbles" bug. Content extent catches overflow even when overflow:visible.
  const RADII = ["borderTopLeftRadius", "borderTopRightRadius", "borderBottomLeftRadius", "borderBottomRightRadius"];
  for (const el of document.querySelectorAll(
    "[class*='badge'],[class*='chip'],[class*='pill'],[class*='tag'],[class*='bubble'],[class*='count'],[class*='crumb']," +
    "[class*='dot'],[class*='mark'],[class*='flag'],[class*='dayhdr'],[class*='daybadge'],[class*='hb-bar__'],span,small,b,em,time,li")) {
    if (cap(findings, "bubble-overflow")) break;
    if (!vis(el)) continue;
    const s = getComputedStyle(el);
    const br = Math.max(...RADII.map((k) => parseFloat(s[k]) || 0));
    const hasBg = (parseRGB(s.backgroundColor) || { a: 0 }).a > 0.1;
    const hasBorder = ["borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth"].some((k) => parseFloat(s[k]) > 0.5);
    if (br < 6 || !(hasBg || hasBorder)) continue;         // must actually look like a bubble (pills use ~6-7px radii)
    const r = rectOf(el);
    if (r.height < 6 || r.height > 64 || r.width > 460 || !onScreenish(r)) continue; // pill-sized, not a card
    const t = (el.textContent || "").trim(); if (t.length < 1) continue;
    // scrollWidth misses content that overflows an overflow:visible box (a chip squished by a
    // fixed-layout table column, text bleeding past the pill border). Measure the text's real ink
    // extent with a Range and compare it to the content-box edges — that catches the visible bleed.
    let inkR = 0, inkL = 0;
    try {
      const range = document.createRange(); range.selectNodeContents(el);
      const tr = range.getBoundingClientRect();
      const padR = parseFloat(s.paddingRight) || 0, bR = parseFloat(s.borderRightWidth) || 0;
      const padL = parseFloat(s.paddingLeft) || 0, bL = parseFloat(s.borderLeftWidth) || 0;
      inkR = tr.right - (r.right - padR - bR);
      inkL = (r.left + padL + bL) - tr.left;
    } catch { /* detached */ }
    const ox = Math.max(el.scrollWidth - el.clientWidth, Math.round(inkR), Math.round(inkL));
    const oy = el.scrollHeight - el.clientHeight;
    if (ox > 2 || oy > 3) {
      const dir = [ox > 2 ? `${ox}px past edge` : "", oy > 3 ? `${oy}px tall` : ""].filter(Boolean).join(" + ");
      add("bubble-overflow", "high", el, `text overflows its bubble (${dir}) — "${t.slice(0, 32)}"`, { box: `${Math.round(r.width)}x${Math.round(r.height)}` });
    }
  }

  // ---- 9. Split group headers — a capped list rendered as two sub-lists (first N + the rest in a
  // separate table/details) duplicates a day/group header and strands the collapse control mid-list.
  // The signature is the same group header appearing twice inside one board. Only visible when the
  // list is EXPANDED, so expand collapsibles before running (see the skill's pre-step).
  {
    const byBoard = new Map();
    for (const h of document.querySelectorAll(".gday, [class*='dayhdr'], [class*='dayhead'], [class*='dayhdr']")) {
      if (cap(findings, "split-group")) break;
      if (!vis(h)) continue;
      const board = h.closest("[data-embedchart], .hb-panel, .imptable, .daygrid, .hb-body");
      if (!board) continue;
      const txt = (h.textContent || "").trim().replace(/\s+/g, " ");
      if (!txt) continue;
      let set = byBoard.get(board); if (!set) byBoard.set(board, (set = new Set()));
      if (set.has(txt)) add("split-group", "medium", h, `group header "${txt.slice(0, 28)}" repeats within one board — a capped list split across two sub-tables (collapse control ends up mid-list)?`);
      else set.add(txt);
    }
  }

  // ---- 10. Main content not centred in the viewport ---------------------------
  // A fixed sidebar reserved via padding centres content in the REMAINING space, which reads as
  // "the whole page shifted right". Flags a content column whose centre is well off the viewport's.
  {
    const main = document.querySelector(".siteshift main, main");
    if (main && vis(main)) {
      const r = rectOf(main);
      const off = Math.round((r.left + r.right) / 2 - vw / 2);
      // Only meaningful if there IS spare room — a column wider than the viewport can't be centred.
      if (Math.abs(off) > 40 && r.width < vw - 40) {
        add("off-center-content", "medium", main, `content centre is ${off > 0 ? "+" : ""}${off}px from viewport centre (left gap ${Math.round(r.left)}, right gap ${Math.round(vw - r.right)})`);
      }
    }
  }

  // ---- 11. Grid dead space from auto-fill phantom tracks -----------------------
  // `repeat(auto-fill, …)` keeps empty tracks when there are fewer items than columns, leaving a
  // block of dead space (use auto-fit to collapse them). Detect: more tracks than laid-out children.
  for (const el of document.querySelectorAll("*")) {
    if (cap(findings, "grid-dead-space")) break;
    if (!vis(el)) continue;
    const s = getComputedStyle(el);
    if (s.display !== "grid") continue;
    const tracks = (s.gridTemplateColumns || "").trim().split(/\s+/).filter(Boolean).length;
    if (tracks < 2) continue;
    const kids = [...el.children].filter((k) => vis(k));
    if (!kids.length || kids.length >= tracks) continue;
    const r = rectOf(el); if (r.width < 200 || !onScreenish(r)) continue;
    // Only flag when the empty tracks amount to real visible space.
    const wasted = Math.round(r.width * ((tracks - kids.length) / tracks));
    if (wasted > 160) {
      add("grid-dead-space", "medium", el, `${kids.length} item(s) in a ${tracks}-track grid — ~${wasted}px of empty tracks (auto-fill instead of auto-fit?)`);
    }
  }

  // ---- 12. Chart alignment: truncated text beside dead space -------------------
  // Derek's standing rule — whenever a chart changes, check alignment. The signature of the props
  // board bug: a cell ellipsizes its text while its own row still has unused width.
  for (const el of document.querySelectorAll("[class*='__player'],[class*='__name'],[class*='__title'],td,th,[class*='cell']")) {
    if (cap(findings, "chart-truncated-with-space")) break;
    if (!vis(el)) continue;
    if (el.scrollWidth <= el.clientWidth + 2) continue;      // not truncated
    const row = el.closest("tr,li,[class*='row'],[class*='__list']>*");
    if (!row || !vis(row)) continue;
    const rr = rectOf(row);
    const used = [...row.children].filter(vis).reduce((a, c) => a + rectOf(c).width, 0);
    const spare = Math.round(rr.width - used);
    if (spare > 60) {
      add("chart-truncated-with-space", "medium", el,
        `text is ellipsized ("${(el.textContent || "").trim().slice(0, 24)}") while its row has ~${spare}px unused — widen the column`);
    }
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
