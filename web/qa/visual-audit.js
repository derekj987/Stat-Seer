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
    // A fixed/sticky bar is painted OVER content that is not its ancestor — the transparent site nav
    // sits above the hero image, which is its SIBLING. Walking ancestors alone therefore reads the
    // bar's own colour and reports cream-on-white for text that actually renders over a dark photo.
    // Hit-test what is really stacked underneath instead, and bail if any of it is imagery.
    // The overlap test is NOT limited to fixed/sticky ancestors. A hero lockup is an ordinary
    // in-flow child sitting over a SIBLING <img>: nothing in its ancestor chain is positioned, and
    // nothing carries a background, so the colour walk fell through to the page background and
    // reported cream-on-cream at contrast 1.07 for ".lp-hero__wmtag" — text that is plainly legible
    // over a dark photo. Test the element's own rect against imagery whatever its position.
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      // Geometric overlap, NOT elementsFromPoint: the hero banner sets pointer-events:none for its
      // scrim, so hit-testing walks straight past the image and reports the bar's own colour for
      // text that actually renders over a dark photo. Overlap doesn't care about pointer events.
      for (const img of document.querySelectorAll("img,picture,video,canvas,[class*='hero'],[class*='banner']")) {
        if (img.contains(el) || img === el || !vis(img)) continue;
        const q = img.getBoundingClientRect();
        if (q.width < 40 || q.height < 20) continue;
        const over = Math.min(q.right, r.right) - Math.max(q.left, r.left) > 0
                  && Math.min(q.bottom, r.bottom) - Math.max(q.top, r.top) > 0;
        if (over) return null;                  // real backdrop is imagery — can't assess
      }
    }
    // 🚨 A TRANSLUCENT background must be COMPOSITED, not treated as opaque. This used to return
    // any background with alpha > 0.1 as-is, using its raw rgb — so `color-mix(in srgb, #0a7d3c
    // 13%, transparent)` (the .pmmatch pills, and the same pattern on several badges) reported the
    // pill's own text colour as its background and scored contrast 1.00: "invisible text" that is
    // perfectly legible. Collect the layers, then alpha-blend down to the first opaque one.
    let n = el;
    const layers = [];
    while (n && n.nodeType === 1) {
      const cs = getComputedStyle(n);
      // Over a background-image / gradient we can't read the pixels behind the text, so a solid-color
      // contrast check would be bogus (nav name over the hero image, a card over a photo). Bail out.
      if (cs.backgroundImage && cs.backgroundImage !== "none") return null;
      const c = parseRGB(cs.backgroundColor);
      if (c && c.a > 0.01) {
        layers.push(c);
        if (c.a >= 0.99) break;                 // reached something opaque
      }
      n = n.parentElement;
    }
    if (!layers.length || layers[layers.length - 1].a < 0.99) return null;
    let out = layers.pop();                     // the opaque base
    while (layers.length) {                     // then paint each translucent layer over it
      const t = layers.pop();
      out = { r: t.r * t.a + out.r * (1 - t.a),
              g: t.g * t.a + out.g * (1 - t.a),
              b: t.b * t.a + out.b * (1 - t.a), a: 1 };
    }
    return out;
    // (falls through to null above when no opaque background exists → text likely over imagery)
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
    // An element scrolled out of a horizontal scroller (the week nav, the sport strip, the category
    // pills) still reports a rect at its unscrolled position, so hit-testing that point finds
    // whatever is painted there — the right rail, in practice. That is not an intercepted click,
    // it is a clipped element you are supposed to scroll to. Skip anything a scrolling ancestor
    // has clipped out of view; this reported 4 FALSE high-severity findings on every page.
    // Test the POINT being hit-tested, not the whole rect. A half-scrolled item is partly visible,
    // so a whole-rect test says "not clipped" while the centre we probe sits in the hidden half and
    // elementFromPoint returns the page behind. That is what the live rails did on a 551px-tall
    // window: "Notifications" and "Message Us" spanned y 502-580 inside a rail ending at 535, and
    // both were reported as covered by .siteshift. They are scrolled, not covered.
    let clipped = false;
    for (let a = el.parentElement; a && a !== document.body && !clipped; a = a.parentElement) {
      const as = getComputedStyle(a);
      if (!/auto|scroll|hidden/.test(as.overflowX + as.overflowY)) continue;
      const ar = rectOf(a);
      if (cx < ar.left || cx > ar.right || cy < ar.top || cy > ar.bottom) clipped = true;
    }
    if (clipped) continue;
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
    // A CENTERING grid (`1fr auto 1fr` with the child placed in column 2) has empty outer tracks on
    // purpose — they are the spacers that centre it. auto-fill dead space is the opposite: children
    // flow into whatever tracks exist. Explicit placement tells them apart, and without this every
    // page reported .pageweekrow and .subnavrow as ~250-510px of dead space.
    if (kids.some((k) => getComputedStyle(k).gridColumnStart !== "auto")) continue;
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

  // ---- 13. Repeated row label — the "double names" bug ------------------------
  // Consecutive rows whose FIRST cell repeats the same text read as duplicated rows even when the
  // rest of the row differs (the Value Finder props board showed a player's Over and Under rows with
  // his name on both). Fix is to group: blank the label on the continuation row. Only flagged when
  // the rows genuinely differ elsewhere — identical rows are a real duplicate, not a grouping miss.
  {
    const containers = new Set();
    for (const r of document.querySelectorAll("tbody, ul, ol, [class*='__list'], [class*='rows']")) {
      if (vis(r)) containers.add(r);
    }
    for (const c of containers) {
      if (cap(findings, "repeated-row-label")) break;
      const rows = [...c.children].filter(vis);
      if (rows.length < 2) continue;
      const labelOf = (row) => {
        const cell = row.querySelector("td,th,li,span,div");
        return cell ? (cell.textContent || "").trim() : "";
      };
      const fullOf = (row) => (row.textContent || "").replace(/\s+/g, " ").trim();
      for (let i = 1; i < rows.length; i++) {
        const a = labelOf(rows[i - 1]), b = labelOf(rows[i]);
        if (!b || a !== b) continue;
        if (fullOf(rows[i - 1]) === fullOf(rows[i])) continue;   // truly identical row — different bug
        add("repeated-row-label", "medium", rows[i],
          `row label "${b.slice(0, 28)}" repeats on consecutive rows that otherwise differ — group it (blank the continuation) so it doesn't read as a duplicate`);
        break;   // one finding per container is enough
      }
    }
  }

  // ---- 14. Header/nav rows that don't share the page's alignment ---------------
  // A stack of nav rows (week badge, flow steps, subnav, category pills) should agree: all centred or
  // all left. One `display:inline-flex` row among centred siblings parks itself at the left edge and
  // reads as broken. Compares each row's centre to the median of its siblings.
  {
    const bars = [...document.querySelectorAll(
      ".catnav, .subnav, .subnavrow, .pageweek, .flow, .flowsteps, .weeknav, .teamnav, .pinrow")].filter(vis);
    if (bars.length >= 3) {
      const main = document.querySelector(".siteshift main, main");
      if (main && vis(main)) {
        const mr = rectOf(main), mc = (mr.left + mr.right) / 2;
        const offs = bars.map((b) => { const r = rectOf(b); return { b, off: (r.left + r.right) / 2 - mc, w: r.width }; })
          .filter((x) => x.w > 40 && x.w < mr.width - 40);   // full-width rows can't be "off-centre"
        if (offs.length >= 3) {
          const med = offs.map((x) => x.off).sort((a, b) => a - b)[Math.floor(offs.length / 2)];
          for (const x of offs) {
            if (cap(findings, "nav-alignment-mismatch")) break;
            if (Math.abs(x.off - med) > 60) {
              add("nav-alignment-mismatch", "medium", x.b,
                `this row sits ${Math.round(x.off - med)}px off the alignment its sibling nav rows share (inline-flex without auto margins?)`);
            }
          }
        }
      }
    }
  }

  // ---- 15. Full-bleed element that doesn't reach the viewport edges ------------
  // A banner/hero escapes its container's gutters with negative margins + an over-100% width. If a
  // gutter is later added on one side and the element doesn't cancel it too, the art stops short and
  // leaves a strip of page background. Intent is inferred from a negative horizontal margin or a
  // width that exceeds 100% — both mean "deliberately wider than my parent".
  for (const el of document.querySelectorAll("[class*='hero'],[class*='banner'],[class*='bleed'],[class*='full'],header,section")) {
    if (cap(findings, "full-bleed-short")) break;
    if (!vis(el)) continue;
    const s = getComputedStyle(el);
    const ml = parseFloat(s.marginLeft) || 0, mr = parseFloat(s.marginRight) || 0;
    const wantsBleed = ml < -8 || mr < -8 || /calc\(.*\+/.test(s.width);
    if (!wantsBleed) continue;
    const r = rectOf(el);
    if (r.width < 200 || !onScreenish(r)) continue;
    // Measure against the LAYOUT viewport, not window.innerWidth: innerWidth counts the classic
    // scrollbar, so a hero that correctly reaches the edge reads as ~15px short on any page long
    // enough to scroll. Same correction the rail-symmetry check already makes.
    const layoutW = document.documentElement.clientWidth || vw;
    const left = Math.round(r.left), right = Math.round(layoutW - r.right);
    if (left > 4 || right > 4) {
      add("full-bleed-short", "medium", el,
        `full-bleed element stops short of the viewport (left gap ${left}px, right gap ${right}px) — a container gutter it doesn't cancel?`);
    }
  }

  // ---- 16. Table overflowing its own scroll container (desktop) ----------------
  // A chart that needs a horizontal scrollbar on a wide screen is usually a column-budget bug: the
  // per-column width rules don't cover every column (e.g. 4 widths declared for a 5-column table), so
  // the extras fall outside 100%, the table overflows and the first column scrolls out of sight.
  // Horizontal scroll on a PHONE is often deliberate ("swipe for totals"), so only check wide views.
  if (vw >= 1000) {
    for (const wrap of document.querySelectorAll("[class*='formwrap'],[class*='wrap'],[class*='scroll'],div")) {
      if (cap(findings, "table-overflows-container")) break;
      if (!vis(wrap)) continue;
      const s = getComputedStyle(wrap);
      if (!/auto|scroll/.test(s.overflowX)) continue;
      const over = wrap.scrollWidth - wrap.clientWidth;
      if (over <= 8) continue;
      const table = wrap.querySelector("table, [role='table'], [class*='table']");
      if (!table) continue;
      const cols = table.querySelector("tr") ? table.querySelector("tr").children.length : 0;
      add("table-overflows-container", "medium", wrap,
        `table overflows its container by ${over}px at ${vw}px wide${cols ? ` (${cols} columns)` : ""} — do the per-column widths cover every column and sum to 100%?`);
    }
  }

  // ---- 17. Side rails: mirror symmetry, even spacing, overflow ----------------
  // The Member Rail (left) and Bettor's Rail (right) are meant to be mirror images: same width, same
  // top, and the same gap to their own edge of the viewport. They share one CSS class, so a mismatch
  // means something side-specific (a gutter, a width override) drifted.
  {
    const rails = [...document.querySelectorAll(".leftrail")].filter(vis);
    const L = rails.find((r) => r.classList.contains("leftrail--left"));
    const R = rails.find((r) => r.classList.contains("leftrail--right"));
    if (L && R) {
      const a = rectOf(L), b = rectOf(R);
      // Measure the right gap against the LAYOUT viewport, not window.innerWidth: innerWidth counts
      // the classic scrollbar, but a position:fixed rail is laid out inside the scrollbar, so a
      // correctly mirrored pair reads as ~15px asymmetric on any page long enough to scroll.
      const layoutW = document.documentElement.clientWidth || vw;
      const leftGap = Math.round(a.left), rightGap = Math.round(layoutW - b.right);
      if (Math.abs(leftGap - rightGap) > 2) {
        add("rail-asymmetry", "medium", R,
          `rails aren't mirrored: left rail sits ${leftGap}px from the left edge, right rail ${rightGap}px from the right`);
      }
      if (Math.abs(a.width - b.width) > 2) {
        add("rail-asymmetry", "medium", R,
          `rails differ in width (${Math.round(a.width)}px vs ${Math.round(b.width)}px) — they share .leftrail, so a side-specific override drifted`);
      }
      if (Math.abs(a.top - b.top) > 2) {
        add("rail-asymmetry", "low", R,
          `rails start at different heights (${Math.round(a.top)}px vs ${Math.round(b.top)}px)`);
      }
    }
    for (const rail of rails) {
      // Rows must be evenly spaced: one row height and one gap for every item, whatever the icon size.
      const items = [...rail.querySelectorAll(".leftrail__it")].filter(vis).map(rectOf);
      if (items.length >= 3) {
        const hs = items.map((r) => Math.round(r.height));
        if (Math.max(...hs) - Math.min(...hs) > 3) {
          add("rail-uneven-rows", "low", rail,
            `rail rows differ in height (${Math.min(...hs)}–${Math.max(...hs)}px) — rows should share one icon size + padding`);
        }
        const gaps = [];
        for (let i = 1; i < items.length; i++) gaps.push(Math.round(items[i].top - items[i - 1].bottom));
        // A divider (merged rail) legitimately adds one bigger gap, so allow a single outlier.
        const sorted = [...gaps].sort((x, y) => x - y);
        const spread = sorted[sorted.length - 2] - sorted[0];
        if (gaps.length >= 3 && spread > 4) {
          add("rail-uneven-rows", "low", rail, `rail row gaps are uneven (${gaps.join(", ")}px)`);
        }
      }
      // A rail taller than its own max-height hides items behind a scrollbar.
      if (rail.scrollHeight - rail.clientHeight > 8) {
        add("rail-overflows", "medium", rail,
          `rail content is ${rail.scrollHeight - rail.clientHeight}px taller than the rail — items are hidden behind a scroll`);
      }
      // The rail must not overlap the content column it reserves a gutter for.
      const main = document.querySelector(".siteshift main, main.wrap, .wrap");
      if (main && vis(main)) {
        const m = rectOf(main), r = rectOf(rail);
        const overlap = Math.min(m.right, r.right) - Math.max(m.left, r.left);
        if (overlap > 2) {
          add("rail-overlaps-content", "high", rail,
            `rail overlaps the content column by ${Math.round(overlap)}px — the reserved gutter is narrower than the rail`);
        }
      }
    }
  }

  // ---- 18. An open disclosure whose control is stranded mid-content --------------
  // A <summary> keeps its source position, so an expanded "Show N more" leaves its Collapse control
  // with rows above AND below it, reading as a control dropped into the middle of the chart. The fix
  // is the flex-order trick (.hb-more / .hb-showmore[open]): container flex-column, content order:1,
  // summary order:2. Only meaningful once the disclosure is open, so expand before probing.
  for (const d of document.querySelectorAll("details[open]")) {
    if (cap(findings, "stranded-disclosure")) break;
    const sum = d.querySelector(":scope > summary");
    if (!sum || !vis(sum) || !vis(d)) continue;
    const sibs = [...d.children].filter((c) => c !== sum && vis(c)).map(rectOf).filter((r) => r.height > 0);
    if (sibs.length < 2) continue;                       // nothing meaningful revealed
    const s = rectOf(sum);
    const above = sibs.filter((r) => r.bottom <= s.top + 2).length;
    const below = sibs.filter((r) => r.top >= s.bottom - 2).length;
    if (above > 0 && below > 0) {
      add("stranded-disclosure", "medium", sum,
        `an open disclosure's control sits mid-content (${above} block(s) above, ${below} below) — give it order:2 in a flex-column so it follows what it revealed`);
    }
  }

  // ---- 19. Chart header arrangement ------------------------------------------
  // Every chart header must read the same way: title (+count) and the scroll tooltip together on the
  // LEFT, "Add to dashboard" hard RIGHT, chevron last. Panels write these children in different
  // source orders, so the arrangement is enforced by flex `order` in CSS — which means a new panel
  // silently inherits it, and a regression shows up as a pin stranded mid-header (the usual cause is
  // a SECOND `margin-left:auto` in the row splitting the free space).
  for (const bar of document.querySelectorAll(".hb-bar")) {
    if (cap(findings, "chart-header-order")) break;
    if (!vis(bar)) continue;
    const b = rectOf(bar);
    if (b.width < 120) continue;
    const title = bar.querySelector(".hb-bar__title");
    const pin = bar.querySelector(".pinbtn-wrap");
    const tip = bar.querySelector(".tip");
    const chev = bar.querySelector(".hb-bar__chev");
    if (pin && vis(pin)) {
      const p = rectOf(pin);
      // The pin should hug the right edge — allow room for the chevron beside it.
      const gapRight = b.right - p.right;
      if (gapRight > 90) {
        add("chart-header-order", "medium", pin,
          `"Add to dashboard" sits ${Math.round(gapRight)}px from the header's right edge — is a second margin-left:auto splitting the free space?`);
      }
      if (title && vis(title) && tip && vis(tip)) {
        // The scroll belongs beside the title, not out past the pin.
        if (rectOf(tip).left > p.left) {
          add("chart-header-order", "low", tip,
            "the scroll tooltip renders to the RIGHT of the dashboard button — it should sit next to the title");
        }
      }
    }
    if (chev && vis(chev) && b.right - rectOf(chev).right > 40) {
      add("chart-header-order", "low", chev,
        `the chevron is ${Math.round(b.right - rectOf(chev).right)}px from the header's right edge`);
    }
  }

  // ---- 20. Long item lists must be capped behind the standard dropdown --------
  // Boards cap a long list and hide the tail behind .hb-showmore. An uncapped list runs the card to
  // full length and buries everything below it. Player-prop markets cap at 3 PLAYERS (not rows) —
  // counted in players because a player usually occupies two rows, his Over and his Under.
  // STRUCTURAL, not selector-bound. This used to match only `[class*='__list']`, which meant it
  // caught .propq__list and missed every board built as a table of .pmrow--data — the MLB lineup
  // and strikeout panels shipped 210 and 53 uncapped rows and this check said nothing. Derek
  // spotted it by eye, which is exactly the job the probe is supposed to take over.
  // A "long list" is now ANY container holding many sibling elements that share a class: that is
  // what a repeated row IS, whatever the class happens to be called.
  const longLists = new Set();
  for (const el of document.querySelectorAll("div,ul,ol,tbody,section")) {
    const kids = [...el.children].filter(vis);
    if (kids.length <= 8) continue;
    // The signature is the MOST COMMON child class, not the first child's. Taking kids[0] read the
    // HEADER row of a table — whose class differs from every data row beneath it — so a 54-row
    // board scored 1/54 and passed. That is how this check reported clean on a page with 53
    // uncapped rows on it.
    const counts = new Map();
    for (const k of kids) {
      const c = k.getAttribute("class") || k.tagName;
      counts.set(c, (counts.get(c) || 0) + 1);
    }
    const top = Math.max(...counts.values());
    // A header or footer row is allowed to differ; 70% of children sharing one class still means
    // "this is a list of rows".
    if (top / kids.length >= 0.7 && top > 8) longLists.add(el);
  }
  // Keep only the INNERMOST container of each nest, so one long table is not reported once per
  // ancestor as well.
  for (const list of longLists) {
    if (cap(findings, "uncapped-long-list")) break;
    if ([...longLists].some((o) => o !== list && list.contains(o))) continue;
    const items = [...list.children].filter(vis);
    // A horizontally-scrolling picker is not a "long list" — the week nav (18 weeks), the sport
    // strip and the category pills are meant to be swiped, and a "show more" on them would be
    // absurd. Skip a list that is inside a <nav> or that scrolls sideways on purpose.
    if (list.closest("nav") || /auto|scroll/.test(getComputedStyle(list).overflowX)) continue;
    // A dropdown ABOVE this list counts as capped. Checking only list.parentElement was too
    // narrow: the hb-moretbl checkbox usually sits a level or two up (the scroller wraps the
    // table, the checkbox wraps the scroller), so a correctly-capped board still reported
    // uncapped. Walk up a few levels instead of assuming one shape of markup.
    //
    // MUST test the ancestor ITSELF as well as its descendants. querySelector only looks DOWN, so
    // an ancestor that IS the control never matched its own selector -- and `<details
    // class="hb-showmore">` wrapping the table is the single most common capped shape in this app.
    // That one missing `matches()` reported three correctly-capped boards as uncapped (/props,
    // /audit, and both tables on /ncaaf/model) while staying silent on anything genuinely broken.
    let capped = false;
    const CAPSEL = ".hb-showmore, .hb-more, .hb-moretbl__chk";
    for (let a = list.parentElement, d = 0; a && d < 4 && !capped; a = a.parentElement, d++) {
      if (a.matches?.(CAPSEL) || a.querySelector(CAPSEL)) capped = true;
    }
    if (capped) continue;
    add("uncapped-long-list", "low", list,
      `${items.length} rows rendered with no "show more" control — should this cap behind the standard dropdown?`);
  }

  // ---- 20b. A chart's column HEADER must line up with the data underneath ------
  // Derek: "the chart headers are misaligned on the data they are representing." Every MLB board
  // had it. The cause is one missing class: .pmrow{display:flex} is the base and .pmrow--data adds
  // display:grid, so a header written as `pmrow pmrow--head` (without --data) stays FLEX. The grid
  // template is still declared on it and still computes -- getComputedStyle happily returns
  // "minmax(210px, 1.7fr) ..." on a flex box -- so reading the CSS proves nothing. Only the
  // rendered geometry tells the truth.
  //
  // This is the reason the check compares LEFT EDGES rather than styles: it is agnostic about why
  // a header drifted (wrong display, a column-count mismatch, a stray colspan) and catches all of
  // them. Tolerance is 2px for sub-pixel rounding.
  for (const tbl of document.querySelectorAll('[role="table"], table')) {
    if (!vis(tbl)) continue;
    const head = tbl.querySelector('[class*="--head"], thead tr');
    const rows = [...tbl.querySelectorAll('[class*="--data"], tbody tr')].filter(
      (r) => r !== head && vis(r) && !r.classList.contains("hb-row--more"));
    if (!head || !vis(head) || !rows.length) continue;
    const cells = (r) => [...r.children].filter((c) => c.getBoundingClientRect().width > 0 ||
                                                       c.getBoundingClientRect().height > 0);
    const hc = cells(head), dc = cells(rows[0]);
    // Different cell COUNTS is a different bug (a column budget that doesn't cover every column);
    // don't double-report it here.
    if (hc.length !== dc.length || hc.length < 2) continue;
    const off = hc.map((c, i) =>
      Math.round(c.getBoundingClientRect().left - dc[i].getBoundingClientRect().left));
    const worst = Math.max(...off.map(Math.abs));
    if (worst <= 2) continue;
    add("chart-header-misaligned", "high", tbl,
      `column header does not line up with its data — worst offset ${worst}px ` +
      `(header display:${getComputedStyle(head).display}, data display:${getComputedStyle(rows[0]).display})`,
      { offsets: off });
  }

  // ---- 20c. A data column whose value never changes is telling the reader nothing ----
  // The MLB board carried a "run line" column fed by football's consensus-spread logic. Baseball's
  // run line is a fixed +/-1.5 on EVERY game, so the column printed -1.5 down almost every row and
  // read as "we make everyone a big favourite" while actually carrying no information at all.
  //
  // Deliberately narrow, because plenty of columns repeat legitimately (a status column that says
  // "projected" for every row is fine, and so is a short board): only NUMERIC columns, only on
  // boards with enough rows to judge, and only when nearly every value is identical.
  for (const tbl of document.querySelectorAll('[role="table"], table')) {
    if (!vis(tbl)) continue;
    const head = tbl.querySelector('[class*="--head"], thead tr');
    const rows = [...tbl.querySelectorAll('[class*="--data"], tbody tr')].filter(
      (r) => r !== head && vis(r));
    if (rows.length < 8) continue;
    const width = Math.max(...rows.map((r) => r.children.length));
    for (let c = 0; c < width; c++) {
      const vals = rows.map((r) => (r.children[c]?.textContent || "").trim())
        .filter((t) => t && t !== "—");
      if (vals.length < 8) continue;
      // Numeric only. A repeated WORD is usually a legitimate status; a repeated NUMBER in a
      // column of prices or lines is a column that cannot be doing its job.
      if (!vals.every((v) => /^[+\-−]?\d+(\.\d+)?%?$/.test(v))) continue;
      const uniq = new Set(vals);
      if (uniq.size > 2) continue;
      const label = head ? (head.children[c]?.textContent || "").trim() : `column ${c + 1}`;
      add("column-no-variance", "medium", tbl,
        `"${label}" holds only ${uniq.size} distinct value(s) across ${vals.length} rows ` +
        `(${[...uniq].join(", ")}) — the column may not carry the information it appears to`);
      if (cap(findings, "column-no-variance")) break;
    }
  }

  // ---- 20d. A popover must be anchored to something, and land near its trigger ----
  // The scroll "?" (Tip) reveals an absolutely-positioned bubble. `.tip` was position:static so the
  // bubble could stretch across a positioned ROW above it — which worked only while every Tip
  // happened to sit inside such a row. When the Model page's Tip moved into WeekBadge's aside,
  // which is not positioned, `absolute` fell through to the INITIAL CONTAINING BLOCK: the bubble
  // rendered 1425px wide at left:0, far from the scroll, and the control simply stopped working.
  //
  // Nothing threw and nothing looked wrong until you clicked, which is why this needs a probe.
  // Measure the OPENED bubble against its trigger rather than reading CSS: force it visible, take
  // both rects, restore. Works for any popover following the same trigger/bubble shape.
  const POPOVERS = [
    { root: ".tip", trigger: ".tip__icon, .tip__seal", bubble: ".tip__bubble", chk: ".tip__chk" },
  ];
  for (const spec of POPOVERS) {
    for (const root of document.querySelectorAll(spec.root)) {
      const trig = root.querySelector(spec.trigger);
      const bub = root.querySelector(spec.bubble);
      if (!trig || !bub || !vis(trig)) continue;
      const chk = spec.chk ? root.querySelector(spec.chk) : null;
      const was = chk ? chk.checked : null;
      const forced = bub.style.cssText;
      if (chk) chk.checked = true;
      // Belt and braces: some popovers reveal via :hover, which cannot be simulated here.
      bub.style.opacity = "1"; bub.style.visibility = "visible";
      const br = bub.getBoundingClientRect(), tr = trig.getBoundingClientRect();
      // Which ancestor actually positions it? null = the initial containing block = the bug.
      let anchored = false;
      for (let a = bub.parentElement; a; a = a.parentElement) {
        if (getComputedStyle(a).position !== "static") { anchored = true; break; }
      }
      const dx = Math.round(Math.abs((br.left + br.width / 2) - (tr.left + tr.width / 2)));
      const docW = document.documentElement.clientWidth;
      bub.style.cssText = forced;
      if (chk) chk.checked = was;
      if (!anchored) {
        add("popover-unanchored", "high", root,
          `${spec.root} bubble has NO positioned ancestor — it is laid out against the page, ` +
          `${Math.round(br.width)}px wide at left ${Math.round(br.left)}px, ` +
          `${dx}px from the control that opens it`);
      } else if (dx > 500 || br.width > docW - 8) {
        add("popover-unanchored", "medium", root,
          `${spec.root} bubble opens ${dx}px from its trigger (width ${Math.round(br.width)}px) — ` +
          `it should appear beside the control, not across the page`);
      }
      if (cap(findings, "popover-unanchored")) break;
    }
  }

  // ---- 21. A split grouped list must not open on a blank label ----------------
  // Grouped lists blank a repeated leading label (a player's second row). If such a list is later
  // SPLIT across a "show more" boundary, the first hidden row inherits the blank and the dropdown
  // opens on a nameless row. `cont` has to be recomputed per segment, not sliced.
  for (const list of document.querySelectorAll(".propq__list, tbody")) {
    if (cap(findings, "orphaned-continuation")) break;
    if (!vis(list)) continue;
    const rows = [...list.children].filter(vis);
    if (!rows.length) continue;
    const lead = rows[0].querySelector(".propq__player, .hb-l, td, span");
    if (!lead) continue;
    const txt = (lead.textContent || "").trim();
    if (txt !== "") continue;
    // Only a real finding when the list holds more rows that DO have labels — an all-blank column
    // is a different (intentional) design.
    if (rows.slice(1).some((r) => {
      const c = r.querySelector(".propq__player, .hb-l, td, span");
      return c && (c.textContent || "").trim() !== "";
    })) {
      add("orphaned-continuation", "medium", rows[0],
        "this list's FIRST row has a blank leading label — a grouped list was sliced instead of recomputing the continuation flag per segment");
    }
  }

  // ---- 22. A board where NO data is visible until you click ------------------
  // Capping a list at "the first 3" only helps if those 3 are on screen. When every game card on a
  // board is a COLLAPSED <details>, the cap buys nothing: the reader still pays a click per game
  // before seeing a single price, and a board of 16 games reads as 16 empty rows. Flag a board whose
  // per-item cards are all closed. Deliberately not per-card — one collapsed card among open ones is
  // just a card the reader shut.
  {
    const groups = {};
    for (const d of document.querySelectorAll("details")) {
      if (!vis(d)) continue;
      const cls = (d.className || "").toString().split(/\s+/).filter(Boolean);
      // Only per-item cards: skip page furniture (panels, methodology, the show-more control itself).
      const key = cls.find((c) => /game$/i.test(c) || /^(propgame|augame|pmgame)$/i.test(c));
      if (!key) continue;
      (groups[key] = groups[key] || []).push(d);
    }
    for (const key of Object.keys(groups)) {
      if (cap(findings, "all-cards-collapsed")) break;
      const all = groups[key];
      if (all.length < 3) continue;                       // too few to call it a board
      const open = all.filter((d) => d.open).length;
      if (open === 0) {
        add("all-cards-collapsed", "medium", all[0],
          `all ${all.length} .${key} cards on this board are collapsed — nothing is readable without a click per game; open them by default so the per-card cap is actually visible`);
      }
    }
  }

  // ---- 23. The column header repeated inside one board ------------------------
  // A board that renders one <table> per day group emits a <thead> per group, so the column row
  // ("Game / Market Spread / Market O/U / …") reappears under every date — and again wherever a day
  // is split at the show-more cap. It reads as several charts chopped up rather than one, which is
  // the reported bug. The column header belongs ONCE, at the top of the board; the per-column widths
  // are declared on td as well as th, so a headerless continuation table still lines up.
  for (const board of document.querySelectorAll(".hb-panel, .hb-body, main, section")) {
    if (cap(findings, "repeated-column-header")) break;
    if (!vis(board)) continue;
    // Only look at the innermost board that owns these tables, so one finding isn't reported again
    // for every ancestor.
    const tables = [...board.querySelectorAll("table")].filter(vis);
    if (tables.length < 2) continue;
    if ([...board.querySelectorAll(".hb-panel, .hb-body")].some((n) => n !== board && n.querySelectorAll("table").length === tables.length)) continue;
    // A container holding SEVERAL panels is not one board. /ncaaf/model stacks three charts ("AP
    // Top 25 Matchups", "Full Model", "Where We Differ Most"), each correctly drawing its own
    // column header once — reported as one board repeating its header 3x, because no single
    // descendant panel owned all the tables. Only the innermost panel counts as a chart.
    if (board.querySelector(".hb-panel")) continue;
    const seen = new Map();
    for (const t of tables) {
      const head = t.querySelector("thead");
      if (!head || !vis(head)) continue;
      const key = (head.textContent || "").replace(/\s+/g, " ").trim();
      if (!key) continue;
      seen.set(key, (seen.get(key) || 0) + 1);
    }
    for (const [key, n] of seen) {
      if (n > 1) {
        add("repeated-column-header", "medium", board,
          `the column header repeats ${n}x inside one board ("${key.slice(0, 60)}") — render it on the first day group only`);
        break;
      }
    }
  }

  // ---- 24. Content drawn OUTSIDE the card that is supposed to contain it -------
  // A table built as `display:flex; flex-direction:column; align-items:stretch` sizes each row to the
  // CONTAINER's width, not the content's. Put overflow-x:auto on that same element and the container
  // IS the phone — so a row's border box stops at the viewport while its grid tracks carry on past
  // it. The row does not scroll; it spills out of its own card. Measured on /model at 375px: the
  // .impgame border box was 301px around 554px of content, so MODEL SPREAD / MODEL TOTAL drew
  // outside the card's right edge. The fix is overflow-x on a WRAPPER plus min-width:min-content.
  //
  // Deliberately looks at the CARD, not the scroller: a scroll container is *meant* to have
  // scrollWidth > clientWidth. The bug is a bordered/filled box that clips nothing yet is narrower
  // than what it draws around.
  for (const el of document.querySelectorAll(".impgame,.refrow,.aurow,.improw,[class*='row'],[class*='card']")) {
    if (cap(findings, "content-escapes-card")) break;
    if (!vis(el)) continue;
    const r = rectOf(el);
    if (r.width < 60 || !onScreenish(r)) continue;
    const s = getComputedStyle(el);
    // Only boxes that visually assert a boundary — a plain wrapper overflowing is someone else's job.
    const bordered = parseFloat(s.borderTopWidth) > 0 || parseFloat(s.borderLeftWidth) > 0
      || (s.backgroundColor && s.backgroundColor !== "rgba(0, 0, 0, 0)");
    if (!bordered) continue;
    if (/auto|scroll|hidden/.test(s.overflowX)) continue;   // it clips or scrolls: not this bug
    const over = el.scrollWidth - el.clientWidth;
    if (over <= 2) continue;
    add("content-escapes-card", "high", el,
      `content is ${over}px wider than the card drawn around it (${Math.round(r.width)}px box vs ${el.scrollWidth}px of content) — the last columns render OUTSIDE the border instead of scrolling. Move overflow-x to a wrapper and give the flex column min-width:min-content.`);
  }

  // ---- 25. One chart rendered as TWO independently-scrolling tables ------------
  // The sibling of split-group. /considerations rendered the referee crews as slice(0,6) in one
  // .reftable and slice(6) in a SECOND .reftable inside a <details>. Both carried overflow-x, so one
  // chart had two horizontal scrollbars — scrolling the top half left the bottom half where it was —
  // and the second table had no header row, so its columns were unlabelled once scrolled.
  // Cap by hiding rows INSIDE the one table (the hb-moretbl checkbox pattern), never by slicing it.
  const TBL = [".reftable", ".imptable", ".autbl", ".charttbl", ".pmtable--data"];
  for (const panel of document.querySelectorAll(".ctxsec, .hb-panel, .hb-body, section")) {
    if (cap(findings, "chart-split-scrollers")) break;
    if (!vis(panel)) continue;
    for (const cls of TBL) {
      const tabs = [...panel.querySelectorAll(cls)].filter(vis);
      if (tabs.length < 2) continue;
      // Report the innermost panel that owns them, so one bug isn't re-reported per ancestor.
      if ([...panel.querySelectorAll(".ctxsec, .hb-panel, .hb-body")]
            .some((n) => n !== panel && n.querySelectorAll(cls).length === tabs.length)) continue;
      const scrollers = tabs.filter((t) => {
        const o = getComputedStyle(t).overflowX;
        return /auto|scroll/.test(o) || /auto|scroll/.test(getComputedStyle(t.parentElement || t).overflowX);
      }).length;
      const headless = tabs.filter((t) => !t.querySelector("[class*='--head'], thead")).length;
      // A SPLIT chart leaves its continuation without a header — that is the signature, and it is
      // what made the referee table's bottom half unreadable. Many tables that EACH carry a header
      // are many charts, which is the correct design for a per-item card board: /audit renders one
      // .autbl per game and was reported as "one chart in 16 pieces". If a header is genuinely
      // duplicated across a split, `repeated-column-header` catches that instead.
      if (headless === 0) continue;
      add("chart-split-scrollers", scrollers > 1 ? "high" : "medium", panel,
        `one chart is rendered as ${tabs.length} separate ${cls} tables (${scrollers} of them scroll sideways independently, ${headless} have no header row) — cap by hiding rows inside the ONE table with the hb-moretbl pattern`);
      break;
    }
  }

  // ---- 26. A panel whose content uses only part of its width --------------------
  // The opposite of `content-escapes-card`: instead of overflowing, the content stops well short
  // and the panel reads as half-empty. Usually a `max-width` in ch on the copy — correct for line
  // length, wrong as the only rule in a 1100px panel, because nothing else uses the space.
  // Reported on the homepage "Let's talk numbers" body: copy capped at 54ch inside a ~1100px card
  // left the entire right half blank.
  //
  // The fix is never "widen the paragraph" — 1100px of text is ~140ch and unreadable. Fill the
  // width with LAYOUT (columns, or copy beside art/CTA) and keep the measure.
  if (vw >= 1000) {
    for (const body of document.querySelectorAll("[class*='__body'],.hb-body,[class*='panel'] > div")) {
      if (cap(findings, "panel-half-empty")) break;
      if (!vis(body)) continue;
      const br = rectOf(body);
      if (br.width < 500 || !onScreenish(br)) continue;
      const cs = getComputedStyle(body);
      // Only single-column stacks: a grid/flex ROW is already using the width by design.
      if (cs.display === "flex" && !/column/.test(cs.flexDirection)) continue;
      if (cs.display === "grid" && (cs.gridTemplateColumns || "").trim().split(/\s+/).length > 1) continue;
      const inner = br.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      if (inner < 400) continue;
      const kids = [...body.children].filter((k) => vis(k) && directText(k).length > 0);
      if (kids.length < 2) continue;                       // a lone element proves nothing
      // Measure where the INK stops, not where the boxes stop. A block-level <h2> or a flex CTA
      // row is full-width by definition even when its text ends a third of the way across, so
      // comparing child widths reports 100% used on the very panel that looks half empty — this
      // check silently passed its own regression test until it measured text rects instead.
      const left = br.left + parseFloat(cs.paddingLeft);
      let right = -Infinity;
      const walk = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        if (!n.textContent.trim()) continue;
        const rng = document.createRange(); rng.selectNodeContents(n);
        for (const q of rng.getClientRects()) if (q.width > 0) right = Math.max(right, q.right);
      }
      for (const k of body.querySelectorAll("img,svg,video,canvas,input,select")) {
        if (!vis(k)) continue; const q = rectOf(k); if (q.width > 0) right = Math.max(right, q.right);
      }
      if (right === -Infinity) continue;
      const used = right - left;
      const frac = used / inner;
      const spare = Math.round(inner - used);
      if (frac < 0.65 && spare > 250) {
        add("panel-half-empty", "medium", body,
          `content uses ${Math.round(frac * 100)}% of this panel's width — ${spare}px sits empty at ${vw}px. Fill it with layout (two columns, or copy beside the CTA/art); do NOT just widen the text.`);
      }
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
