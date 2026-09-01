"use client";

// Personal bankroll + CLV tracker — per-member, localStorage-backed (like the slip / dashboard;
// a Supabase-backed table is a later upgrade). Logs each bet and tracks the honest metrics:
// record, staked, profit/loss (in $ and units), ROI, win%, and — the differentiator — closing-line
// value (did you beat the number the market closed at). CLV is the best proxy for long-term edge,
// which fits StatSeer's verifiable-trust angle: members can check their OWN edge, not just ours.
import { useCallback, useEffect, useState } from "react";

export type BetResult = "pending" | "won" | "lost" | "push";

export interface Bet {
  id: string;
  pick: string;                 // free-text description, e.g. "Chiefs -3.5"
  book?: string;                // sportsbook name (optional)
  odds: number;                 // AMERICAN odds you got (e.g. -110, +150)
  stake: number;                // $ risked
  closeOdds?: number | null;    // AMERICAN closing odds (optional) — powers CLV
  result: BetResult;
  placedAt: string;             // ISO date string
}

export interface BankrollSettings { startBankroll: number; unit: number; }
interface BankState { bets: Bet[]; settings: BankrollSettings; }

const KEY = "statseer.bankroll.v1";
const EVT = "statseer:bankroll";
const DEFAULTS: BankrollSettings = { startBankroll: 1000, unit: 25 };

/** American → decimal odds. */
export function toDecimal(american: number): number {
  if (!american) return 1;
  return american >= 0 ? 1 + american / 100 : 1 + 100 / Math.abs(american);
}
/** Profit (not including the returned stake) on a settled bet; 0 for push/pending. */
export function betProfit(b: Bet): number {
  if (b.result === "won") return b.stake * (toDecimal(b.odds) - 1);
  if (b.result === "lost") return -b.stake;
  return 0;
}
/** Closing-line value %: your price vs the closing price. Positive = you beat the close. */
export function betCLV(b: Bet): number | null {
  if (b.closeOdds == null || !b.closeOdds) return null;
  const you = toDecimal(b.odds), close = toDecimal(b.closeOdds);
  if (!close) return null;
  return (you / close - 1) * 100;
}
export function fmtOdds(a: number): string { return a > 0 ? `+${a}` : `${a}`; }

let seq = 0;
function newId(): string { return `bet_${Date.now().toString(36)}_${(seq++).toString(36)}`; }

function read(): BankState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { bets: [], settings: { ...DEFAULTS } };
    const s = JSON.parse(raw) as BankState;
    return {
      bets: Array.isArray(s.bets) ? s.bets : [],
      settings: { ...DEFAULTS, ...(s.settings || {}) },
    };
  } catch { return { bets: [], settings: { ...DEFAULTS } }; }
}
function write(s: BankState) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* blocked */ }
  try { window.dispatchEvent(new CustomEvent(EVT)); } catch { /* SSR */ }
}

export interface BankrollStats {
  wins: number; losses: number; pushes: number; pending: number;
  staked: number; profit: number; roi: number; winPct: number;
  units: number; bankroll: number; avgClv: number | null; clvBeatPct: number | null; clvCount: number;
}

export function computeStats(bets: Bet[], settings: BankrollSettings): BankrollStats {
  const settled = bets.filter((b) => b.result !== "pending");
  const wins = settled.filter((b) => b.result === "won").length;
  const losses = settled.filter((b) => b.result === "lost").length;
  const pushes = settled.filter((b) => b.result === "push").length;
  const pending = bets.length - settled.length;
  const staked = settled.reduce((s, b) => s + b.stake, 0);
  const profit = settled.reduce((s, b) => s + betProfit(b), 0);
  const roi = staked ? (profit / staked) * 100 : 0;
  const decided = wins + losses;
  const winPct = decided ? (wins / decided) * 100 : 0;
  const units = settings.unit ? profit / settings.unit : 0;
  const bankroll = settings.startBankroll + profit;
  const clvVals = bets.map(betCLV).filter((v): v is number => v != null);
  const avgClv = clvVals.length ? clvVals.reduce((s, v) => s + v, 0) / clvVals.length : null;
  const clvBeatPct = clvVals.length ? (clvVals.filter((v) => v > 0).length / clvVals.length) * 100 : null;
  return { wins, losses, pushes, pending, staked, profit, roi, winPct, units, bankroll, avgClv, clvBeatPct, clvCount: clvVals.length };
}

export function useBankroll() {
  const [state, setState] = useState<BankState>({ bets: [], settings: { ...DEFAULTS } });

  useEffect(() => {
    setState(read());
    const sync = () => setState(read());
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener(EVT, sync); window.removeEventListener("storage", sync); };
  }, []);

  const commit = useCallback((next: BankState) => { write(next); setState(next); }, []);

  const addBet = useCallback((b: Omit<Bet, "id">) => {
    const cur = read();
    commit({ ...cur, bets: [{ ...b, id: newId() }, ...cur.bets] });
  }, [commit]);

  const settleBet = useCallback((id: string, result: BetResult) => {
    const cur = read();
    commit({ ...cur, bets: cur.bets.map((b) => (b.id === id ? { ...b, result } : b)) });
  }, [commit]);

  const setClose = useCallback((id: string, closeOdds: number | null) => {
    const cur = read();
    commit({ ...cur, bets: cur.bets.map((b) => (b.id === id ? { ...b, closeOdds } : b)) });
  }, [commit]);

  const removeBet = useCallback((id: string) => {
    const cur = read();
    commit({ ...cur, bets: cur.bets.filter((b) => b.id !== id) });
  }, [commit]);

  const updateSettings = useCallback((s: Partial<BankrollSettings>) => {
    const cur = read();
    commit({ ...cur, settings: { ...cur.settings, ...s } });
  }, [commit]);

  return {
    bets: state.bets, settings: state.settings,
    stats: computeStats(state.bets, state.settings),
    addBet, settleBet, setClose, removeBet, updateSettings,
  };
}
