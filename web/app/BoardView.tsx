"use client";

import { useCallback } from "react";
import type { Game } from "@/lib/board";
import { ShopSubnav, Brand, SlipCallout, FlowSteps, ValueFinderNote } from "./Nav";
import { useSlip } from "@/lib/slip";
import { GAME_WEATHER, type GameWeather } from "@/lib/weatherData";

const WX_BY_EVENT = new Map(GAME_WEATHER.map((w) => [w.eventId, w]));

function wxPlace(wx: GameWeather): string {
  return `${wx.venue}${wx.city ? ` — ${wx.city}, ${wx.state}` : ""}`;
}
function WeatherChip({ wx }: { wx: GameWeather }) {
  if (wx.indoor) return <span className="wxchip wxchip--indoor" title={wxPlace(wx)}>Indoor · roof</span>;
  if (wx.status === "ok") {
    return (
      <span className={`wxchip${wx.windFlag ? " wxchip--wind" : ""}`} title={`${wxPlace(wx)}${wx.conditions ? ` · ${wx.conditions}` : ""}`}>
        {wx.windFlag && <b>⚑ </b>}{wx.windMph} mph · {wx.tempF}°{wx.conditions ? ` · ${wx.conditions}` : ""}
      </span>
    );
  }
  return null; // forecast pending (>~2 weeks out)
}

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
  byBook?: Record<string, number>;
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
  const mk = (market: string, label: string, price: number, books: string[], byBook?: Record<string, number>): Pick => ({
    id: `${g.eventId}:${market}:${label}`, game: g.matchup, market, label, price, books, byBook,
  });
  const chip = (p: Pick, best?: boolean) => (
    <SavableChip key={p.id} pick={p} saved={has(p.id)} best={best} onToggle={onToggle} />
  );

  const wx = WX_BY_EVENT.get(g.eventId);
  const showWx = wx && (wx.indoor || wx.status === "ok");
  return (
    <article className={s.key || t.key ? "game key" : "game"}>
      <header className="game__head">
        <span className="matchup">{g.away}<span className="at">@</span>{g.home}</span>
        <time className="kick">{et(g.commence, kickFmt)}</time>
      </header>
      {showWx && <div className="game__wx"><WeatherChip wx={wx} /></div>}

      <div className="markets">
        <div className="mkt">
          <span className="mkt__label">Moneyline</span>
          <div className="lines">
            {ml.map(([side, m]) => chip(mk("ML", side, m.price, m.books, m.byBook), side === bestSide))}
          </div>
          <div className="mkt__note"><span className="edge">shop&nbsp;+{bestEdge.toFixed(1)}%</span></div>
        </div>

        {s.home && s.away && (
          <div className="mkt">
            <span className="mkt__label">Spread</span>
            <div className="lines">
              {chip(mk("Spread", `${g.home} ${fmtPt(s.home.point)}`, s.home.price, s.home.books, s.home.byBook))}
              {chip(mk("Spread", `${g.away} ${fmtPt(s.away.point)}`, s.away.price, s.away.books, s.away.byBook))}
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
              {chip(mk("Total", `O ${t.over.point}`, t.over.price, t.over.books, t.over.byBook))}
              {chip(mk("Total", `U ${t.under.point}`, t.under.price, t.under.books, t.under.byBook))}
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

export default function BoardView({
  board, min, max, week, season, snapshot,
}: { board: Game[]; min: number; max: number; week: number; season: number; snapshot: string }) {
  const { has, toggle: slipToggle } = useSlip();
  const toggle = useCallback((p: Pick) => slipToggle({
    id: p.id, kind: "line",
    title: `${p.market} ${p.label}`, detail: p.game,
    price: p.price, books: p.books, byBook: p.byBook,
  }), [slipToggle]);

  const edges = board.flatMap((g) => Object.values(g.ml).map((s) => s.edge));
  const avgEdge = edges.length ? edges.reduce((a, b) => a + b, 0) / edges.length : 0;
  const keyGames = board.filter((g) => g.spread.key).length;
  const maxEdge = edges.length ? Math.max(...edges) : 0;

  return (
    <>
      <main className="wrap">
        <header className="masthead">
          <Brand sub={`Value Finder · Line Shopping`} />
          {snapshot && <div className="asof">lines as of<br /><b>{et(snapshot, snapFmt)}</b></div>}
        </header>

        <FlowSteps active="value" />
        <ValueFinderNote />
        <ShopSubnav active="lines" />

        <WeekNav min={min} max={max} current={week} />

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
              {board.slice(0, 6).map((g) => <GameCard key={g.eventId} g={g} has={has} onToggle={toggle} />)}
            </section>
            {board.length > 6 && (
              <details className="hb-more">
                <summary className="hb-more__sum">
                  <span className="hb-more__chev" aria-hidden="true">▸</span>
                  See more ({board.length - 6} more games)
                </summary>
                <section className="grid">
                  {board.slice(6).map((g) => <GameCard key={g.eventId} g={g} has={has} onToggle={toggle} />)}
                </section>
              </details>
            )}

            <footer className="foot">
              <p>
                <b>No model. No pick.</b> Line shopping — the <b>best available number across books</b> on every
                game, plus where a half-point sits on a <b>sweet spot</b> (a 3 or 7). For player props, shop them
                on <a href="/props">Player Props</a>. Prices move; this updates automatically as new odds are captured.
              </p>
            </footer>
          </>
        )}
      </main>
    </>
  );
}
