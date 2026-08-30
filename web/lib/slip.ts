"use client";

// One slip across the whole app. Every section that surfaces a pick or a player
// (Game Lines, Player Props, The Model, Fan Analysis) writes into this single
// localStorage-backed store, so a member building a slip while reading never has
// to remember what caught their eye. Islands on the same page (and other tabs)
// stay in sync via a custom event + the storage event.
import { useCallback, useEffect, useState } from "react";

export type SlipKind = "line" | "prop" | "model" | "fan";

export interface SlipItem {
  id: string;          // stable, unique per pick
  kind: SlipKind;
  title: string;       // main label, e.g. "Spread BUF -2.5" / "Josh Allen O 249.5"
  detail?: string;     // secondary, e.g. the matchup or the source
  price?: number;      // american odds (best across books), when the item has a price
  books?: string[];    // best-price sportsbook(s), when known
  byBook?: Record<string, number>;  // EVERY book's american price for this leg — the raw
                                     // material for "best book per leg" + best combined parlay
  fairProb?: number | null;          // Pick Auditor: de-vigged fair probability, for the slip's value flag
}

const KEY = "statseer.slip.v2";
const EVT = "statseer:slip";

// --- Share links: encode the slip into a compact URL-safe string and back. Lets a
// member send their slip; the recipient opens it in StatSeer (installed or browser).
type Packed = { k: SlipKind; t: string; d?: string; p?: number; b?: string[]; bb?: Record<string, number>; fp?: number };

function slug(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);
}

export function encodeSlip(items: SlipItem[]): string {
  const packed: Packed[] = items.map((i) => ({
    k: i.kind, t: i.title,
    ...(i.detail ? { d: i.detail } : {}),
    ...(i.price !== undefined ? { p: i.price } : {}),
    ...(i.books?.length ? { b: i.books } : {}),
    ...(i.byBook && Object.keys(i.byBook).length ? { bb: i.byBook } : {}),
    ...(i.fairProb != null ? { fp: i.fairProb } : {}),
  }));
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(packed))));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeSlip(s: string): SlipItem[] {
  try {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    const arr = JSON.parse(decodeURIComponent(escape(atob(b64)))) as Packed[];
    return arr.map((e, i) => ({
      id: `shared-${i}-${slug(e.t)}`, kind: e.k, title: e.t,
      detail: e.d, price: e.p, books: e.b, byBook: e.bb, fairProb: e.fp ?? null,
    }));
  } catch {
    return [];
  }
}

function read(): SlipItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SlipItem[]) : [];
  } catch {
    return [];
  }
}

function write(items: SlipItem[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* ignore */ }
  try { window.dispatchEvent(new CustomEvent(EVT)); } catch { /* ignore */ }
}

export function useSlip() {
  const [items, setItems] = useState<SlipItem[]>([]);

  useEffect(() => {
    setItems(read());
    const sync = () => setItems(read());
    window.addEventListener(EVT, sync);        // same tab, other islands
    window.addEventListener("storage", sync);  // other tabs
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const has = useCallback((id: string) => items.some((i) => i.id === id), [items]);

  const toggle = useCallback((it: SlipItem) => {
    const cur = read();
    const next = cur.some((i) => i.id === it.id)
      ? cur.filter((i) => i.id !== it.id)
      : [...cur, it];
    write(next);
    setItems(next);
  }, []);

  const remove = useCallback((id: string) => {
    const next = read().filter((i) => i.id !== id);
    write(next);
    setItems(next);
  }, []);

  const clear = useCallback(() => { write([]); setItems([]); }, []);

  // Merge in a set of picks (from a shared slip), skipping any already on the slip.
  const addMany = useCallback((add: SlipItem[]) => {
    const cur = read();
    const ids = new Set(cur.map((i) => i.id));
    const next = [...cur, ...add.filter((i) => !ids.has(i.id))];
    write(next);
    setItems(next);
  }, []);

  return { items, has, toggle, remove, clear, addMany };
}
