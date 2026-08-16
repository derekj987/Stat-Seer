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
  price?: number;      // american odds, when the item has a price
  books?: string[];    // best-price sportsbook(s), when known
}

const KEY = "statseer.slip.v2";
const EVT = "statseer:slip";

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

  return { items, has, toggle, remove, clear };
}
