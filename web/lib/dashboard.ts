"use client";

// The member's Custom Dashboard: personal, localStorage-backed BOARDS of "pins" — any chart,
// board, or data view they want quick access to. v2 adds multiple named boards (tabs), a per-pin
// size (column span), and free reordering; it migrates the old flat v1 pin list into a default
// board on first load. Mirrors the slip store (custom event + storage event) so a pin added on any
// page shows here instantly and syncs across tabs. Per-device for now; Supabase sync is a later
// upgrade.
import { useCallback, useEffect, useState } from "react";

import type { ChartSpec } from "@/lib/chartSources"; // type-only: no server code pulled in

export type PinKind = "auditor" | "model" | "props" | "lines" | "sweetspots" | "considerations" | "chart" | "view" | "widget";
export type PinSize = "sm" | "md" | "lg" | "full";   // grid column span: 1 / 2 / 3 / 4

export interface Pin {
  id: string;        // stable + unique (usually the href, or a chart id)
  kind: PinKind;
  label: string;     // what the member sees, e.g. "Pick Auditor · Passing"
  detail?: string;   // secondary line, e.g. "NFL · Week 1"
  href: string;      // where tapping the pin takes them (empty for AI charts / widgets)
  spec?: ChartSpec;  // kind:"chart" — the AI-built chart's data-source spec (re-fetched live)
  widget?: string;   // kind:"widget" — a built-in widget id (e.g. "scoreboard", "bankroll")
  size?: PinSize;    // card width; defaults to "lg"
}

export interface Board { id: string; name: string; pins: Pin[]; }
interface DashState { boards: Board[]; activeId: string; }

const KEY = "statseer.dashboard.v2";
const KEY_V1 = "statseer.dashboard.v1";
const EVT = "statseer:dashboard";

function newId(prefix = "b"): string {
  // No Math.random dependency needed for uniqueness here — a counter off the current boards is
  // enough, but a short token keeps ids stable across renames. Uses time only via performance.
  return `${prefix}_${Date.now().toString(36)}_${(perfSeq++).toString(36)}`;
}
let perfSeq = 0;

function defaultState(pins: Pin[] = []): DashState {
  const id = newId();
  return { boards: [{ id, name: "My Board", pins }], activeId: id };
}

function migrate(): DashState {
  // v1 was a flat Pin[]; wrap it into a starter board.
  try {
    const rawV1 = localStorage.getItem(KEY_V1);
    if (rawV1) {
      const arr = JSON.parse(rawV1);
      if (Array.isArray(arr) && arr.length) return defaultState(arr as Pin[]);
    }
  } catch { /* ignore */ }
  return defaultState();
}

function read(): DashState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return migrate();
    const s = JSON.parse(raw) as DashState;
    if (!s || !Array.isArray(s.boards) || !s.boards.length) return defaultState();
    if (!s.boards.some((b) => b.id === s.activeId)) s.activeId = s.boards[0].id;
    return s;
  } catch { return defaultState(); }
}
function write(s: DashState) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage blocked */ }
  try { window.dispatchEvent(new CustomEvent(EVT)); } catch { /* SSR */ }
}

export function useDashboard() {
  const [state, setState] = useState<DashState>(() => ({ boards: [], activeId: "" }));

  useEffect(() => {
    setState(read());
    const sync = () => setState(read());
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener(EVT, sync); window.removeEventListener("storage", sync); };
  }, []);

  const commit = useCallback((next: DashState) => { write(next); setState(next); }, []);
  const mutate = useCallback((fn: (s: DashState) => DashState) => { commit(fn(read())); }, [commit]);

  const boards = state.boards;
  const activeId = state.activeId;
  const active = boards.find((b) => b.id === activeId) ?? boards[0];
  const pins = active?.pins ?? [];

  // Pinned ANYWHERE (so a ＋ button reads "pinned" regardless of which board holds it).
  const has = useCallback((id: string) => boards.some((b) => b.pins.some((p) => p.id === id)), [boards]);

  // Toggle from any page: remove wherever it lives, or add to the active board.
  const toggle = useCallback((pin: Pin) => mutate((s) => {
    const exists = s.boards.some((b) => b.pins.some((p) => p.id === pin.id));
    if (exists) {
      return { ...s, boards: s.boards.map((b) => ({ ...b, pins: b.pins.filter((p) => p.id !== pin.id) })) };
    }
    const aid = s.boards.some((b) => b.id === s.activeId) ? s.activeId : s.boards[0].id;
    return { ...s, boards: s.boards.map((b) => b.id === aid ? { ...b, pins: [...b.pins, pin] } : b) };
  }), [mutate]);

  const remove = useCallback((id: string) => mutate((s) => ({
    ...s, boards: s.boards.map((b) => ({ ...b, pins: b.pins.filter((p) => p.id !== id) })),
  })), [mutate]);

  const setSize = useCallback((id: string, size: PinSize) => mutate((s) => ({
    ...s, boards: s.boards.map((b) => ({ ...b, pins: b.pins.map((p) => p.id === id ? { ...p, size } : p) })),
  })), [mutate]);

  // Reorder within the ACTIVE board: move the pin at `from` to `to`.
  const reorder = useCallback((from: number, to: number) => mutate((s) => ({
    ...s, boards: s.boards.map((b) => {
      if (b.id !== (s.boards.some((x) => x.id === s.activeId) ? s.activeId : s.boards[0].id)) return b;
      const arr = [...b.pins];
      if (from < 0 || from >= arr.length || to < 0 || to >= arr.length) return b;
      const [moved] = arr.splice(from, 1);
      arr.splice(to, 0, moved);
      return { ...b, pins: arr };
    }),
  })), [mutate]);

  // Move a pin to another board (by id).
  const moveToBoard = useCallback((pinId: string, boardId: string) => mutate((s) => {
    let moved: Pin | undefined;
    const stripped = s.boards.map((b) => {
      const keep = b.pins.filter((p) => { if (p.id === pinId) { moved = p; return false; } return true; });
      return { ...b, pins: keep };
    });
    if (!moved) return s;
    return { ...s, boards: stripped.map((b) => b.id === boardId ? { ...b, pins: [...b.pins, moved as Pin] } : b) };
  }), [mutate]);

  // Add a NEW pin to a specific board (no-op if it's already pinned anywhere — use moveToBoard
  // to relocate an existing pin). Powers the board-picker on the ＋ Add-to-dashboard button.
  const addToBoard = useCallback((pin: Pin, boardId: string) => mutate((s) => {
    if (s.boards.some((b) => b.pins.some((p) => p.id === pin.id))) return s;
    return { ...s, boards: s.boards.map((b) => b.id === boardId ? { ...b, pins: [...b.pins, pin] } : b) };
  }), [mutate]);

  // Create a fresh board holding just this pin, and make it active.
  const addToNewBoard = useCallback((pin: Pin, name?: string) => mutate((s) => {
    const id = newId();
    const nm = (name || `Board ${s.boards.length + 1}`).slice(0, 40);
    const boards = s.boards.map((b) => ({ ...b, pins: b.pins.filter((p) => p.id !== pin.id) }));
    return { boards: [...boards, { id, name: nm, pins: [pin] }], activeId: id };
  }), [mutate]);

  /** The board id currently holding a pin (or null) — for showing where a pin already lives. */
  const boardOf = useCallback((id: string) => boards.find((b) => b.pins.some((p) => p.id === id))?.id ?? null, [boards]);

  const setActive = useCallback((id: string) => mutate((s) => ({ ...s, activeId: id })), [mutate]);

  const addBoard = useCallback((name?: string) => mutate((s) => {
    const id = newId();
    const nm = (name || `Board ${s.boards.length + 1}`).slice(0, 40);
    return { boards: [...s.boards, { id, name: nm, pins: [] }], activeId: id };
  }), [mutate]);

  const renameBoard = useCallback((id: string, name: string) => mutate((s) => ({
    ...s, boards: s.boards.map((b) => b.id === id ? { ...b, name: name.slice(0, 40) || b.name } : b),
  })), [mutate]);

  const deleteBoard = useCallback((id: string) => mutate((s) => {
    if (s.boards.length <= 1) return { ...s, boards: [{ ...s.boards[0], pins: [] }] }; // never zero boards
    const boards = s.boards.filter((b) => b.id !== id);
    const activeId = s.activeId === id ? boards[0].id : s.activeId;
    return { boards, activeId };
  }), [mutate]);

  return {
    boards, activeId, active, pins,
    has, boardOf, toggle, remove, setSize, reorder, moveToBoard, addToBoard, addToNewBoard,
    setActive, addBoard, renameBoard, deleteBoard,
  };
}
