"use client";

// Preseason board — a DELIBERATELY ISOLATED lane. Exhibition lines for shopping
// only: never graded, never fed to the model. Self-contained (reuses the shared
// .game/.markets CSS + the unified slip) so it can't perturb the live Game Lines
// board. No week nav — preseason games are listed by kickoff time.
import { useCallback } from "react";
import type { Game } from "@/lib/board";
import { ShopSubnav, Brand, FlowSteps } from "./Nav";
import { useSlip } from "@/lib/slip";

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

interface Pick {
  id: string; game: string; market: string; label: string; price: number; books: string[];
}

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

function GameCard({
  g, has, onToggle,
}: { g: Game; has: (id: string) => boolean; onToggle: (p: Pick) => void }) {
  const ml = Object.entries(g.ml);
  const bestSide = ml.length ? ml.reduce((a, b) => (b[1].edge > a[1].edge ? b : a))[0] : null;
  const bestEdge = ml.reduce((m, [, s]) => Math.max(m, s.edge), 0);
  const s = g.spread;
  const t = g.total;
  const mk = (market: string, label: string, price: number, books: string[]): Pick => ({
    id: `pre:${g.eventId}:${market}:${label}`, game: g.matchup, market, label, price, books,
  });
  const chip = (p: Pick, best?: boolean) => (
    <SavableChip key={p.id} pick={p} saved={has(p.id)} best={best} onToggle={onToggle} />
  );

  return (
    <article className="game">
      <header className="game__head">
        <span className="matchup">{g.away}<span className="at">@</span>{g.home}</span>
        <time className="kick">{et(g.commence, kickFmt)}</time>
      </header>

      <div className="markets">
        {ml.length > 0 && (
          <div className="mkt">
            <span className="mkt__label">Moneyline</span>
            <div className="lines">
              {ml.map(([side, m]) => chip(mk("ML", side, m.price, m.books), side === bestSide))}
            </div>
            <div className="mkt__note"><span className="edge">shop&nbsp;+{bestEdge.toFixed(1)}%</span></div>
          </div>
        )}

        {s.home && s.away && (
          <div className="mkt">
            <span className="mkt__label">Spread</span>
            <div className="lines">
              {chip(mk("Spread", `${g.home} ${fmtPt(s.home.point)}`, s.home.price, s.home.books))}
              {chip(mk("Spread", `${g.away} ${fmtPt(s.away.point)}`, s.away.price, s.away.books))}
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
          </div>
        )}
      </div>
    </article>
  );
}

export default function PreseasonView({
  board, season, snapshot,
}: { board: Game[]; season: number; snapshot: string }) {
  const { has, toggle: slipToggle } = useSlip();
  const toggle = useCallback((p: Pick) => slipToggle({
    id: p.id, kind: "line",
    title: `${p.market} ${p.label}`, detail: `Preseason · ${p.game}`,
    price: p.price, books: p.books,
  }), [slipToggle]);

  return (
    <main className="wrap">
      <header className="masthead">
        <Brand sub={`The Shop · Preseason · exhibition lines · ${season}`} />
        {snapshot && <div className="asof">lines as of<br /><b>{et(snapshot, snapFmt)}</b></div>}
      </header>

      <FlowSteps active="shop" />
      <ShopSubnav active="pre" />

      {/* Wall: preseason is line-shopping only. It never touches the model or grading. */}
      <div className="tgwall" role="note">
        <span className="tgwall__tag">Exhibition — never graded</span>
        <p>
          <b>Preseason lines, for shopping only.</b> These are exhibition games — starters play a
          handful of snaps and the books know it, so the lines are soft and low-limit. StatSeer
          shows them so you can shop the best price, but they are <b>never graded, never scored, and
          never fed to The Model</b>. No calibration, no track record — pure line shopping.
        </p>
      </div>

      {board.length === 0 ? (
        <p className="foot">
          No preseason odds captured right now. Preseason games appear here once the capture job
          picks them up; outside the preseason window this page is empty by design.
        </p>
      ) : (
        <section className="grid">
          {board.map((g) => <GameCard key={g.eventId} g={g} has={has} onToggle={toggle} />)}
        </section>
      )}

      <footer className="foot">
        <p>
          <b>No model. No pick. No grade.</b> Preseason is a separate, walled-off lane — it exists so
          you can price a preseason bet, nothing more. For graded predictions, see
          <a href="/model"> The Model</a>; for the regular-season board, <a href="/lines">Game Lines</a>.
        </p>
      </footer>
    </main>
  );
}
