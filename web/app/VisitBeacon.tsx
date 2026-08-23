"use client";

// Counts one site visit per browser session. Fires a single fire-and-forget POST to
// /api/visit on first load, guarded by sessionStorage so navigating around the app
// doesn't inflate the number. Renders nothing.
import { useEffect } from "react";

export default function VisitBeacon() {
  useEffect(() => {
    try {
      if (sessionStorage.getItem("ss_visit")) return;
      sessionStorage.setItem("ss_visit", "1");
      fetch("/api/visit", { method: "POST", keepalive: true }).catch(() => {});
    } catch { /* storage blocked — skip */ }
  }, []);
  return null;
}
