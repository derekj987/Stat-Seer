"use client";

// Preseason board — a DELIBERATELY ISOLATED lane. Exhibition lines for shopping
// only: never graded, never fed to the model. Self-contained (reuses the shared
// .game/.markets CSS + the unified slip) so it can't perturb the live Game Lines
// board. No week nav — preseason games are listed by kickoff time.
import { useCallback } from "react";
import type { Game } from "@/lib/board";
import type { PreRating } from "@/lib/preseason";
import { ShopSubnav, SeasonSubnav, Brand, FlowSteps } from "./Nav";
import { useSlip } from "@/lib/slip";
import Tip from "@/app/Tip";

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

function SandboxModel({ ratings }: { ratings: PreRating[] }) {
  return (
    <details className="presb">
      <summary className="presb__sum">
        <span className="presb__tag">Test run · sandbox</span>
        <span className="presb__sumtxt">Preseason power ratings — a machinery test, not picks</span>
        <span className="presb__chev" aria-hidden="true">▾</span>
      </summary>
      <div className="presb__body">
        <p className="presb__note">
          <b>What this is telling you:</b> StatSeer&apos;s rating method (mean point differential, heavily
          shrunk) run on <b>preseason box scores only</b> — 2–3 games of mostly backups, so the numbers are
          <b> essentially noise</b>. It exists to exercise the pipeline before Week&nbsp;1; it is <b>never</b>
          a pick and never enters calibration. A higher <b>rating</b> just means a team looked better on the
          preseason sample — take it with a big grain of salt.
        </p>
        {ratings.length === 0 ? (
          <p className="foot">No preseason box scores captured yet — ratings appear once the ESPN feed has run.</p>
        ) : (
          <div className="presb__table" role="table" aria-label="Preseason ratings">
            <div className="presb__row presb__row--head" role="row">
              <span>team</span><span>GP</span><span>avg pt diff</span><span>rating</span>
            </div>
            {ratings.map((r) => (
              <div className="presb__row" role="row" key={r.team}>
                <span className="presb__team">{r.team}</span>
                <span>{r.gp}</span>
                <span>{r.rawDiff >= 0 ? "+" : ""}{r.rawDiff.toFixed(1)}</span>
                <span className={r.rating >= 0 ? "presb__pos" : "presb__neg"}>
                  {r.rating >= 0 ? "+" : ""}{r.rating.toFixed(1)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

export default function PreseasonView({
  board, ratings, season, snapshot,
}: { board: Game[]; ratings: PreRating[]; season: number; snapshot: string }) {
  const { has, toggle: slipToggle } = useSlip();
  const toggle = useCallback((p: Pick) => slipToggle({
    id: p.id, kind: "line",
    title: `${p.market} ${p.label}`, detail: `Preseason · ${p.game}`,
    price: p.price, books: p.books,
  }), [slipToggle]);

  return (
    <main className="wrap">
      <header className="masthead">
        <Brand
          sub={`Value Finder · Preseason · exhibition lines · ${season}`}
          tip={<Tip text={<>Exhibition (preseason) game lines shown at the <b>best price across sportsbooks</b>. Preseason results are noisy and starters barely play — treat this as <b>line-shopping only</b>, not a signal about the season.</>} />}
        />
        {snapshot && <div className="asof">lines as of<br /><b>{et(snapshot, snapFmt)}</b></div>}
      </header>

      <FlowSteps active="value" />
      <ShopSubnav active="lines" />
      <SeasonSubnav area="lines" active="pre" />

      <details className="readbox">
        <summary className="readbox__h">What am I seeing here?</summary>
        <p>
          Every <b>preseason</b> game&apos;s lines — moneyline, spread, and total — with the best number
          across books highlighted. Tap any line to add it to your slip. These are <b>exhibition games</b>:
          starters barely play, so the lines are soft and low-limit, and StatSeer <b>never grades or
          models them</b> — it&apos;s pure line shopping. For graded reads and the real board, switch
          to <a href="/lines">Regular Season</a>.
        </p>
      </details>

      {board.length === 0 ? (
        <p className="foot">
          No preseason odds captured right now. Preseason games appear here once the capture job
          picks them up; outside the preseason window this page is empty by design.
        </p>
      ) : (
        <>
          <section className="grid">
            {board.map((g) => <GameCard key={g.eventId} g={g} has={has} onToggle={toggle} />)}
          </section>
        </>
      )}

      <SandboxModel ratings={ratings} />

      <footer className="foot">
        <p>
          <b>No model. No pick. No grade.</b> Preseason is a separate, walled-off lane — it exists so
          you can price a preseason bet, nothing more. For graded reads, see
          <a href="/model"> The Model</a>; for the regular-season board, <a href="/lines">Game Lines</a>.
        </p>
      </footer>
    </main>
  );
}
