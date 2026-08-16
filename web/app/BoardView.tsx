"use client";

import { useEffect, useState, useCallback } from "react";
import type { Game } from "@/lib/board";
import { ValueSubnav, Brand, SlipCallout, FlowSteps } from "./Nav";

// ---- formatting (client-side; Intl has full ICU) ----
const kickFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});
const snapFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
});
const et = (iso: string, f: Intl.DateTimeFormat) => f.format(new Date(iso)) + " ET";
const fmtOdds = (p: number) => (p > 0 ? `+${p}` : String(p));
const fmtPt = (p: number | null) => (p === null ? "" : p > 0 ? `+${p}` : String(p));

export interface Pick {
  id: string;
  game: string;
  market: string;
  label: string;
  price: number;
  books: string[];
}

const KEY = "statseer.slip.v1";

function BookTag({ books }: { books: string[] }) {
  return books.length === 1 ? (
    <span className="book">{books[0]}</span>
  ) : (
    <span className="book tie" title={books.join(", ")}>×{books.length} books</span>
  );
}

function SavableChip({
  pick, saved, best, onToggle,
}: { pick: Pick; saved: boolean; best?: boolean; onToggle: (p: Pick) => void }) {
  return (
    <button
      type="button"
      onClick={() => onToggle(pick)}
      className={`line savable${best ? " best" : ""}${saved ? " saved" : ""}`}
      aria-pressed={saved}
      title={saved ? "Remove from slip" : "Save to slip"}
    >
      <span className="team">{pick.label}</span>
      <span className="odds">{fmtOdds(pick.price)}</span>
      <BookTag books={pick.books} />
      <span className="heart" aria-hidden="true">{saved ? "♥" : "♡"}</span>
    </button>
  );
}

function WeekNav({ min, max, current }: { min: number; max: number; current: number }) {
  const weeks: number[] = [];
  for (let w = min; w <= max; w++) weeks.push(w);
  return (
    <nav className="weeknav" aria-label="Select week">
      <span className="weeknav__label">Week</span>
      <div className="weeknav__list">
        {weeks.map((w) => (
          <a key={w} href={`/lines?week=${w}`}
            className={w === current ? "weeknav__w active" : "weeknav__w"}
            aria-current={w === current ? "page" : undefined}>{w}</a>
        ))}
      </div>
    </nav>
  );
}

function GameCard({
  g, has, onToggle,
}: { g: Game; has: (id: string) => boolean; onToggle: (p: Pick) => void }) {
  const ml = Object.entries(g.ml);
  const bestSide = ml.length ? ml.reduce((a, b) => (b[1].edge > a[1].edge ? b : a))[0] : null;
  const bestEdge = ml.reduce((m, [, s]) => Math.max(m, s.edge), 0);
  const s = g.spread;
  const t = g.total;
  const mk = (market: string, label: string, price: number, books: string[]): Pick => ({
    id: `${g.eventId}:${market}:${label}`, game: g.matchup, market, label, price, books,
  });
  const chip = (p: Pick, best?: boolean) => (
    <SavableChip key={p.id} pick={p} saved={has(p.id)} best={best} onToggle={onToggle} />
  );

  return (
    <article className={s.key || t.key ? "game key" : "game"}>
      <header className="game__head">
        <span className="matchup">{g.away}<span className="at">@</span>{g.home}</span>
        <time className="kick">{et(g.commence, kickFmt)}</time>
      </header>

      <div className="markets">
        <div className="mkt">
          <span className="mkt__label">Moneyline</span>
          <div className="lines">
            {ml.map(([side, m]) => chip(mk("ML", side, m.price, m.books), side === bestSide))}
          </div>
          <div className="mkt__note"><span className="edge">shop&nbsp;+{bestEdge.toFixed(1)}%</span></div>
        </div>

        {s.home && s.away && (
          <div className="mkt">
            <span className="mkt__label">Spread</span>
            <div className="lines">
              {chip(mk("Spread", `${g.home} ${fmtPt(s.home.point)}`, s.home.price, s.home.books))}
              {chip(mk("Spread", `${g.away} ${fmtPt(s.away.point)}`, s.away.price, s.away.books))}
            </div>
            <div className="mkt__note">
              {s.key && <span className="badge sm">SWEET SPOT</span>}
              {s.key && <span className="keytag">on {s.key.num} · ½pt ≈ {s.key.cost.toFixed(0)}%</span>}
            </div>
          </div>
        )}

        {t.over && t.under && (
          <div className="mkt">
            <span className="mkt__label">Total</span>
            <div className="lines">
              {chip(mk("Total", `O ${t.over.point}`, t.over.price, t.over.books))}
              {chip(mk("Total", `U ${t.under.point}`, t.under.price, t.under.books))}
            </div>
            <div className="mkt__note">
              {t.key && <span className="badge sm">SWEET SPOT</span>}
              {t.key && <span className="keytag">on {t.key.num} · ½pt ≈ {t.key.cost.toFixed(0)}%</span>}
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

function SlipBar({
  picks, onRemove, onClear,
}: { picks: Pick[]; onRemove: (id: string) => void; onClear: () => void }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!picks.length) return null;
  const tally: Record<string, number> = {};
  for (const p of picks) for (const b of p.books) tally[b] = (tally[b] ?? 0) + 1;
  const [topBook, topCount] = Object.entries(tally).sort((a, b) => b[1] - a[1])[0] ?? ["—", 0];

  async function copySlip() {
    const lines = picks.map((p) =>
      `• ${p.game} — ${p.market} ${p.label}  ${fmtOdds(p.price)}  (best: ${p.books.join(" / ")})`);
    const text =
      `My StatSeer slip — ${picks.length} pick${picks.length === 1 ? "" : "s"}\n` +
      `${lines.join("\n")}\n\n` +
      `Best single book: ${topBook} (best price on ${topCount}/${picks.length} legs).\n` +
      `Build your own at statseer.vercel.app`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked — ignore */ }
  }

  return (
    <div className="slipbar">
      <div className="slipbar__inner">
        <button className="slipbar__summary" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span className="slipbar__count">{picks.length}</span>
          <span>slip</span>
          <span className="slipbar__rec">best book: <b>{topBook}</b> · best price on {topCount}/{picks.length}</span>
          <span className="slipbar__chev">{open ? "▾" : "▴"}</span>
        </button>
        {open && (
          <div className="slipbar__panel">
            <ul className="slipbar__list">
              {picks.map((p) => (
                <li key={p.id}>
                  <span className="slipbar__g">{p.game}</span>
                  <span className="slipbar__p">{p.market} {p.label}</span>
                  <span className="odds">{fmtOdds(p.price)}</span>
                  <span className="book">{p.books.join(" / ")}</span>
                  <button className="slipbar__x" onClick={() => onRemove(p.id)} title="Remove">×</button>
                </li>
              ))}
            </ul>
            <p className="slipbar__note">
              <b>{topBook}</b> has the best price on {topCount} of your {picks.length} picks — place there for
              one-slip convenience. Separate straight bets can each go to their own best book; a parlay must sit
              at one book, so pick the one covering the most legs. Line-shopping only — not a pick.
            </p>
            <div className="slipbar__actions">
              <button className="slipbar__copy" onClick={copySlip}>{copied ? "Copied ✓" : "Copy slip"}</button>
              <button className="slipbar__clear" onClick={onClear}>Clear slip</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function BoardView({
  board, min, max, week, season, snapshot,
}: { board: Game[]; min: number; max: number; week: number; season: number; snapshot: string }) {
  const [picks, setPicks] = useState<Pick[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setPicks(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(picks)); } catch { /* ignore */ }
  }, [picks]);

  const has = useCallback((id: string) => picks.some((p) => p.id === id), [picks]);
  const toggle = useCallback((p: Pick) =>
    setPicks((prev) => (prev.some((x) => x.id === p.id) ? prev.filter((x) => x.id !== p.id) : [...prev, p])), []);
  const remove = useCallback((id: string) => setPicks((prev) => prev.filter((x) => x.id !== id)), []);
  const clear = useCallback(() => setPicks([]), []);

  const edges = board.flatMap((g) => Object.values(g.ml).map((s) => s.edge));
  const avgEdge = edges.length ? edges.reduce((a, b) => a + b, 0) / edges.length : 0;
  const keyGames = board.filter((g) => g.spread.key).length;
  const maxEdge = edges.length ? Math.max(...edges) : 0;

  return (
    <>
      <main className="wrap">
        <header className="masthead">
          <Brand sub={`Value Finder · Game Lines · line shopping & sweet spots · Week ${week}, ${season}`} />
          {snapshot && <div className="asof">lines as of<br /><b>{et(snapshot, snapFmt)}</b></div>}
        </header>

        <FlowSteps active="value" />
        <ValueSubnav active="lines" />

        <WeekNav min={min} max={max} current={week} />

        <details className="readbox">
          <summary className="readbox__h">What am I seeing here?</summary>
          <p>
            Every game&apos;s betting lines — <b>moneyline, spread, and total</b> — with the <b>best available
            number across all books</b> highlighted. Tap any line to add it to your slip; StatSeer tells you the
            best sportsbook for each pick. A gold <b>Sweet Spot</b> badge means the spread or total sits on a key
            number (a <b>3</b> or <b>7</b>), where the half-point is worth the most. No model, no pick — this is
            line shopping: the same bet at a better price.
          </p>
        </details>

        {board.length === 0 ? (
          <p className="foot">No odds captured for Week {week} yet.</p>
        ) : (
          <>
            <details className="statsdrop">
              <summary className="statsdrop__h">Snapshot Statistics</summary>
              <section className="stats" aria-label="summary">
                <div className="stat"><span className="stat__v">+{avgEdge.toFixed(2)}%</span><span className="stat__l">avg shopping edge / side</span></div>
                <div className="stat"><span className="stat__v">{keyGames}</span><span className="stat__l">sweet-spot games</span></div>
                <div className="stat"><span className="stat__v">+{maxEdge.toFixed(2)}%</span><span className="stat__l">best shopping edge</span></div>
                <div className="stat"><span className="stat__v">10</span><span className="stat__l">books compared</span></div>
              </section>
            </details>

            <SlipCallout kind="lines" />

            <section className="grid">
              {board.map((g) => <GameCard key={g.eventId} g={g} has={has} onToggle={toggle} />)}
            </section>

            <footer className="foot">
              <p>
                <b>No model. No pick.</b> Value Finder shows the <b>best available number across books</b> and where a
                half-point sits on a <b>sweet spot</b> (a 3 or 7, worth the most) — the two places line shopping
                actually pays. Prices move; this updates automatically as new odds are captured.
              </p>
            </footer>
          </>
        )}
      </main>
      <SlipBar picks={picks} onRemove={remove} onClear={clear} />
    </>
  );
}
