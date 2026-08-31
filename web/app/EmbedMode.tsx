"use client";

// When a page is loaded with ?embed=1 (i.e. inside a Custom Dashboard card's iframe), strip the
// site chrome (nav, footer, masthead) via a data-embed flag on <html>, and continuously report the
// content height to the parent so the dashboard can size the frame to the whole chart — no scrollbars.
import { useEffect } from "react";

export default function EmbedMode() {
  useEffect(() => {
    let embed = false;
    try { embed = new URLSearchParams(window.location.search).get("embed") === "1"; } catch { /* ignore */ }
    if (!embed) return;
    document.documentElement.setAttribute("data-embed", "1");

    const post = () => {
      try {
        const h = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
        window.parent?.postMessage({ type: "ss-embed-height", height: h }, "*");
      } catch { /* cross-origin / no parent */ }
    };
    post();
    const t = setInterval(post, 600);
    window.addEventListener("load", post);
    window.addEventListener("resize", post);
    let ro: ResizeObserver | null = null;
    try { ro = new ResizeObserver(post); ro.observe(document.body); } catch { /* older browsers */ }
    return () => {
      clearInterval(t);
      window.removeEventListener("load", post);
      window.removeEventListener("resize", post);
      ro?.disconnect();
    };
  }, []);

  return null;
}
