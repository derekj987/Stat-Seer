"use client";

// The member's Custom Dashboard: a personal, localStorage-backed set of "pins" — any chart,
// board, or data view they want quick access to. Mirrors the slip store (custom event +
// storage event) so a pin added on one page shows on the dashboard tab instantly, and syncs
// across tabs. Per-device for now (like the slip); a Supabase-backed sync is a later upgrade.
import { useCallback, useEffect, useState } from "react";

import type { ChartSpec } from "@/lib/chartSources"; // type-only: no server code pulled in

export type PinKind = "auditor" | "model" | "props" | "lines" | "sweetspots" | "considerations" | "chart" | "view";

export interface Pin {
  id: string;        // stable + unique (usually the href, or a chart id)
  kind: PinKind;
  label: string;     // what the member sees, e.g. "Pick Auditor · Passing"
  detail?: string;   // secondary line, e.g. "NFL · Week 1"
  href: string;      // where tapping the pin takes them (empty for AI charts)
  spec?: ChartSpec;  // kind:"chart" — the AI-built chart's data-source spec (re-fetched live)
}

const KEY = "statseer.dashboard.v1";
const EVT = "statseer:dashboard";

function read(): Pin[] {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function write(pins: Pin[]) {
  try { localStorage.setItem(KEY, JSON.stringify(pins)); } catch { /* storage blocked */ }
  try { window.dispatchEvent(new CustomEvent(EVT)); } catch { /* SSR */ }
}

export function useDashboard() {
  const [pins, setPins] = useState<Pin[]>([]);

  useEffect(() => {
    setPins(read());
    const sync = () => setPins(read());
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener(EVT, sync); window.removeEventListener("storage", sync); };
  }, []);

  const has = useCallback((id: string) => pins.some((p) => p.id === id), [pins]);

  const toggle = useCallback((pin: Pin) => {
    const cur = read();
    const next = cur.some((p) => p.id === pin.id) ? cur.filter((p) => p.id !== pin.id) : [...cur, pin];
    write(next);
    setPins(next);
  }, []);

  const remove = useCallback((id: string) => {
    const next = read().filter((p) => p.id !== id);
    write(next);
    setPins(next);
  }, []);

  const clear = useCallback(() => { write([]); setPins([]); }, []);

  return { pins, has, toggle, remove, clear };
}
