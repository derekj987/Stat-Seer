"use client";

import { useCallback } from "react";
import { bookLabel } from "@/lib/bookLabel";
import type { Game } from "@/lib/board";
import { ShopSubnav, Brand, ValueFinderDrawer, FlowSteps, WeekBadge, DayBadge } from "./Nav";
import { WeekNav } from "./WeekNav";
import { useSlip } from "@/lib/slip";
import { GAME_WEATHER, type GameWeather } from "@/lib/weatherData";
import { groupByGameDay, dayBasis, type DayGroup } from "@/lib/gameDays";
import { DayHeader } from "./DayHeader";
import { audit, VERDICT_LABEL } from "@/lib/fairValue";
import PinButton from "./PinButton";

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
  fairProb?: number | null;
}

function BookTag({ books }: { books: string[] }) {
  return books.length === 1 ? (
    <span className="book">{bookLabel(books[0])}</span>
  ) : (
    <span className="book tie" title={books.map(bookLabel).join(", ")}>×{books.length} books</span>
  );
}

function SavableChip({
  pick, saved, best, onToggle,
}: { pick: Pick; saved: boolean; best?: boolean; onToggle: (p: Pick) => void }) {
  const a = pick.fairProb != null ? audit(pick.price, pick.fairProb) : null;
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
      {a && a.verdict === "value" && (
        <span
          className="propq__audit propq__audit--value"
          title={`${VERDICT_LABEL.value} — beats the fair price of ${fmtOdds(a.fair)}`}
        >
          ✓
        </span>
      )}
      <BookTag books={pick.books} />
      <span className="heart" aria-hidden="true">{saved ? "♥" : "♡"}</span>
    </button>
  );
}


// Games shown before "show more". EVEN, because the card grid is two across at the width the
// rails leave (826px at 1440; `.grid` is auto-fill minmax(330px)): three visible cards put the
// third alone on the left with a blank slot beside it. Four fills two rows.
const GAME_CAP = 4;

/** The board serves two sports with one component. Everything a sport changes is in this table —
 *  the label on the handicap market (a football spread is a baseball run line), the copy, the pin,
 *  and whether the week wheel exists (baseball has days, not weeks) — so the card, the chips, the
 *  slip wiring and the day grouping stay identical, which is the point of sharing it. */
export type BoardSport = "nfl" | "mlb" | "ncaaf";
const SPORT = {
  nfl: { label: "NFL", spread: "Spread", weeks: true, pin: "/lines", propsHref: "/props",
         foot: <>Line shopping — the <b>best available number across books</b> on every game, plus where a
           half-point sits on a <b>sweet spot</b> (a 3 or 7).</> },
  mlb: { label: "MLB", spread: "Run line", weeks: false, pin: "/mlb/lines", propsHref: "/mlb/props",
         foot: <>Line shopping — the <b>best available price across books</b> on every game&apos;s moneyline,
           run line and total. The run line is ±1.5 everywhere, so the shopping is all in the price.</> },
  // NCAAF brings its own week badge and week wheel (the card's schedule, not the odds table's
  // week column, which this table does not have) through the `badge` / `nav` slots below.
  ncaaf: { label: "NCAAF", spread: "Spread", weeks: false, pin: "/ncaaf/lines", propsHref: "/ncaaf/props",
         foot: <>Line shopping — the <b>best available number across books</b> on every game, plus where a
           half-point sits on a <b>sweet spot</b> (a 3 or 7 — college margins land there a little less often
           than the NFL&apos;s; the card says how much the half-point is worth).</> },
} as const;

function GameCard({
  g, has, onToggle, sport, abbr, more,
}: { g: Game; has: (id: string) => boolean; onToggle: (p: Pick) => void; sport: BoardSport; abbr?: Record<string, string>; more?: boolean }) {
  const S = SPORT[sport];
  // Chips carry the club's abbreviation where the page supplies one (MLB: "Washington Nationals
  // −149" wrapped its chip onto two lines; "WSH −149" does not). The card header keeps the full
  // name, which is where a reader learns what the abbreviation means.
  const nm = (team: string) => abbr?.[team] ?? team;
  const ml = Object.entries(g.ml);
  const bestSide = ml.length ? ml.reduce((a, b) => (b[1].edge > a[1].edge ? b : a))[0] : null;
  const bestEdge = ml.reduce((m, [, s]) => Math.max(m, s.edge), 0);
  const s = g.spread;
  const t = g.total;
  const mk = (market: string, label: string, price: number, books: string[], byBook?: Record<string, number>, fairProb?: number | null): Pick => ({
    id: `${g.eventId}:${market}:${label}`, game: g.matchup, market, label, price, books, byBook, fairProb,
  });
  const chip = (p: Pick, best?: boolean) => (
    <SavableChip key={p.id} pick={p} saved={has(p.id)} best={best} onToggle={onToggle} />
  );

  const wx = WX_BY_EVENT.get(g.eventId);
  const showWx = wx && (wx.indoor || wx.status === "ok");
  return (
    <article className={`game${s.key || t.key ? " key" : ""}${more ? " hb-row--more" : ""}`}>
      <header className="game__head">
        <span className="matchup">{g.away}<span className="at">@</span>{g.home}</span>
        <time className="kick">{et(g.commence, kickFmt)}</time>
      </header>
      {showWx && <div className="game__wx"><WeatherChip wx={wx} /></div>}

      <div className="markets">
        <div className="mkt">
          <span className="mkt__label">Moneyline</span>
          <div className="lines">
            {ml.map(([side, m]) => chip(mk("ML", nm(side), m.price, m.books, m.byBook, m.fairProb), side === bestSide))}
          </div>
          <div className="mkt__note"><span className="edge">shop&nbsp;+{bestEdge.toFixed(1)}%</span></div>
        </div>

        {s.home && s.away && (
          <div className="mkt">
            <span className="mkt__label">{S.spread}</span>
            <div className="lines">
              {chip(mk(S.spread, `${nm(g.home)} ${fmtPt(s.home.point)}`, s.home.price, s.home.books, s.home.byBook, s.home.fairProb))}
              {chip(mk(S.spread, `${nm(g.away)} ${fmtPt(s.away.point)}`, s.away.price, s.away.books, s.away.byBook, s.away.fairProb))}
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
              {chip(mk("Total", `O ${t.over.point}`, t.over.price, t.over.books, t.over.byBook, t.over.fairProb))}
              {chip(mk("Total", `U ${t.under.point}`, t.under.price, t.under.books, t.under.byBook, t.under.fairProb))}
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
  board, min = 1, max = 1, week = 1, snapshot, today, tomorrow, sport = "nfl", abbr, badge, nav, after, emptyText,
}: { board: Game[]; min?: number; max?: number; week?: number; season?: number; snapshot: string; today: string; tomorrow: string;
     sport?: BoardSport; abbr?: Record<string, string>;
     /** Slots for a sport whose week/day framing is not the NFL's: `badge` replaces the Week/Day badge,
      *  `nav` renders where the week wheel goes, `after` sits between the board and the footer. */
     badge?: React.ReactNode; nav?: React.ReactNode; after?: React.ReactNode; emptyText?: string }) {
  const S = SPORT[sport];
  const { has, toggle: slipToggle } = useSlip();
  const toggle = useCallback((p: Pick) => slipToggle({
    id: p.id, kind: "line",
    title: `${p.market} ${p.label}`, detail: p.game,
    price: p.price, books: p.books, byBook: p.byBook, fairProb: p.fairProb,
  }), [slipToggle]);

  const edges = board.flatMap((g) => Object.values(g.ml).map((s) => s.edge));
  const avgEdge = edges.length ? edges.reduce((a, b) => a + b, 0) / edges.length : 0;
  const keyGames = board.filter((g) => g.spread.key).length;
  const maxEdge = edges.length ? Math.max(...edges) : 0;
  const books = new Set(board.flatMap((g) => Object.values(g.ml).flatMap((m) => Object.keys(m.byBook)))).size;

  return (
    <>
      <main className="wrap">
        <header className="masthead">
          <Brand
            sub={<><span className="brand__sport">{S.label}</span> · Line Shopping</>}
            art={{ src: "/bag.png?v=1", alt: "Value Finder" }}
          />
          {snapshot && <div className="asof">lines as of<br /><b>{et(snapshot, snapFmt)}</b></div>}
        </header>

        <ValueFinderDrawer />

        {badge ?? (S.weeks ? (
          <WeekBadge week={week} pin={<PinButton size="sm" pin={{ id: S.pin, kind: "lines", label: "Value Finder · Line Shopping", detail: `${S.label} · Week ${week}`, href: `${S.pin}?week=${week}` }} />} />
        ) : (
          <DayBadge pin={<PinButton size="sm" pin={{ id: S.pin, kind: "lines", label: `${S.label} · Line Shopping`, detail: "today's slate", href: S.pin }} />} />
        ))}
        <FlowSteps active="value" base={sport} />
        <div className="subnavrow"><ShopSubnav active="lines" base={sport} /></div>

        {nav ?? (S.weeks && <WeekNav min={min} max={max} current={week} base="/lines" />)}

        {board.length === 0 ? (
          <p className="foot">{emptyText ?? (S.weeks ? `No odds captured for Week ${week} yet.` : "No odds captured for upcoming games yet — the board fills as the capture runs.")}</p>
        ) : (
          <>
            <details className="hb-panel hb-panel--card">
              <summary className="hb-bar">
                <span className="hb-bar__title hb-bar__title--gold">Snapshot Statistics</span>
                <span className="hb-bar__chev" aria-hidden="true">▾</span>
              </summary>
              <div className="hb-body">
                <section className="stats" aria-label="summary">
                  <div className="stat"><span className="stat__v">+{avgEdge.toFixed(2)}%</span><span className="stat__l">avg shopping edge / side</span></div>
                  {S.weeks
                    ? <div className="stat"><span className="stat__v">{keyGames}</span><span className="stat__l">sweet-spot games</span></div>
                    : <div className="stat"><span className="stat__v">{board.length}</span><span className="stat__l">games priced</span></div>}
                  <div className="stat"><span className="stat__v">+{maxEdge.toFixed(2)}%</span><span className="stat__l">best shopping edge</span></div>
                  <div className="stat"><span className="stat__v">{books}</span><span className="stat__l">US books compared</span></div>
                </section>
              </div>
            </details>

            {/* First GAME_CAP games visible, the rest revealed IN PLACE by the hb-moretbl checkbox
                — one grid, never a second one. Rendering the tail as its own <details> started a
                fresh grid, so with an odd cap the third card sat alone on the left with a blank
                slot beside it and the fourth began a new row below (Derek: "make the value finder
                cards side-by-side for all of them"). Hiding rows inside the one grid keeps every
                card in flow; a day whose games are all hidden hides its header with them. */}
            {(() => {
              const groups = groupByGameDay(board, (g) => g.commence, today, tomorrow);
              const moreId = `board-more-${sport}`;
              let i = 0;
              const hidden = Math.max(0, board.length - GAME_CAP);
              return (
                <div className="hb-moretbl">
                  <input type="checkbox" id={moreId} className="hb-moretbl__chk" aria-hidden="true" tabIndex={-1} />
                  <div className="daygrid">
                    {groups.map((grp: DayGroup<(typeof board)[number]>) => {
                      const first = i;
                      const cards = grp.items.map((g) => {
                        const more = i++ >= GAME_CAP;
                        return <GameCard key={g.eventId} g={g} has={has} onToggle={toggle} sport={sport} abbr={abbr} more={more} />;
                      });
                      return (
                        <div className={`daygrid__day${first >= GAME_CAP ? " hb-row--more" : ""}`} key={grp.key} style={dayBasis(grp.items.length)}>
                          <DayHeader label={grp.label} tone={grp.tone} count={grp.total ?? grp.items.length} />
                          <section className="grid">{cards}</section>
                        </div>
                      );
                    })}
                  </div>
                  {hidden > 0 && (
                    <label htmlFor={moreId} className="hb-moretbl__sum">
                      <span className="hb-more__chev" aria-hidden="true">▸</span>
                      <span className="hb-moretbl__more">Show {hidden} more game{hidden === 1 ? "" : "s"}</span>
                      <span className="hb-moretbl__less">Show fewer</span>
                    </label>
                  )}
                </div>
              );
            })()}

            {after}

            <footer className="foot">
              <p>
                <b>No model. No pick.</b> {S.foot} For player props, shop them
                on <a href={S.propsHref}>Player Props</a>. Prices move; this updates automatically as new odds are captured.
              </p>
            </footer>
          </>
        )}
      </main>
    </>
  );
}
