"use client";

// When a page is loaded with ?embed=1 (inside a Custom Dashboard card's iframe):
//  • strip the site chrome via data-embed on <html>,
//  • ?only=<id> shows just the one [data-embedchart="<id>"] chart (so two charts on a page pin
//    separately),
//  • collapse to a compact PREVIEW (~2 cards) with a "Show all" dropdown, so a pinned chart isn't
//    tall by default,
//  • continuously report height to the parent so the frame sizes to the content.
import { useEffect } from "react";

const PREVIEW_CAP = 430; // px — roughly the first two game cards

export default function EmbedMode() {
  useEffect(() => {
    let embed = false, only: string | null = null;
    try {
      const p = new URLSearchParams(window.location.search);
      embed = p.get("embed") === "1";
      only = p.get("only");
    } catch { /* ignore */ }
    if (!embed) return;
    document.documentElement.setAttribute("data-embed", "1");

    const post = () => {
      try {
        const h = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
        window.parent?.postMessage({ type: "ss-embed-height", height: h }, "*");
      } catch { /* cross-origin / no parent */ }
    };

    // Show only the requested chart, if the page hosts more than one. This must be RE-APPLIED, not
    // run once: the auth gate mounts the page content after this effect fires, so a one-shot filter
    // would run against a DOM that doesn't have the charts yet and leave both visible. We re-run it
    // on an interval + whenever the DOM mutates (below), so the non-matching chart is hidden as soon
    // as it appears and stays hidden across re-renders.
    const applyOnly = () => {
      if (!only) return;
      document.querySelectorAll<HTMLElement>("[data-embedchart]").forEach((el) => {
        el.style.display = el.getAttribute("data-embedchart") === only ? "" : "none";
      });
    };
    applyOnly();

    // Collapse to a preview (~2 cards) + a "Show all" toggle, once content has laid out.
    let capped = false;
    const applyCap = () => {
      if (capped) return;
      const main = document.querySelector<HTMLElement>("main.wrap") || document.body;
      if (!main || main.scrollHeight <= PREVIEW_CAP + 90) return;
      capped = true;
      main.style.maxHeight = PREVIEW_CAP + "px";
      main.style.overflow = "hidden";
      main.style.position = "relative";
      const fade = document.createElement("div");
      fade.className = "embed-fade";
      main.appendChild(fade);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "embed-showall";
      btn.textContent = "Show all ▾";
      btn.addEventListener("click", () => {
        main.style.maxHeight = "none";
        main.style.overflow = "visible";
        fade.remove();
        btn.remove();
        post();
      });
      main.insertAdjacentElement("afterend", btn);
      post();
    };

    post();
    const capTimer = setTimeout(applyCap, 350);
    const t = setInterval(() => { applyOnly(); post(); }, 600);
    window.addEventListener("load", () => { applyOnly(); applyCap(); post(); });
    window.addEventListener("resize", post);
    let ro: ResizeObserver | null = null;
    try { ro = new ResizeObserver(post); ro.observe(document.body); } catch { /* older browsers */ }
    // Catch the gate-mounted content the instant it appears (childList only, so applyOnly's own
    // style writes don't retrigger it).
    let mo: MutationObserver | null = null;
    if (only) {
      try { mo = new MutationObserver(() => applyOnly()); mo.observe(document.body, { childList: true, subtree: true }); } catch { /* older browsers */ }
    }
    return () => {
      clearTimeout(capTimer);
      clearInterval(t);
      window.removeEventListener("resize", post);
      ro?.disconnect();
      mo?.disconnect();
    };
  }, []);

  return null;
}
