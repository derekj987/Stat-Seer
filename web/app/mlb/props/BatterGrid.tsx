"use client";

import { useCallback } from "react";
import type { PropGame, Quote } from "@/lib/props";
import { useSlip } from "@/lib/slip";
import { groupByGameDay } from "@/lib/gameDays";
import { DayHeader } from "../../DayHeader";
import { audit } from "@/lib/fairValue";
import { bookLabel, booksCode } from "@/lib/bookLabel";

// The batter grid: one row per hitter in LINEUP order, one column per market, each cell the
// player's main line with the best price for each side and the book that has it.
//
// The market-block layout (PropsView) stacks six blocks per game and lists players inside each,
// so a reader assembling one player's sheet reads six lists; and because every row was its own
// grid with auto-sized columns, the price and book of an Over row and the Under row beneath it
// landed at different x positions — Derek: "line up the market totals evenly on top of each
// other. They are not spaced evenly." A table has columns. That is the whole fix.
//
// Same slip wiring and Pick Auditor tag as PropsView; only the arrangement differs.

const fmtOdds = (p: number) => (p > 0 ? `+${p}` : String(p));
const pkFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});
const kickET = (iso: string) => pkFmt.format(new Date(iso)) + " ET";

// Rows shown per game before the dropdown. Derek: "only show the first 4 players and then have
// our standard dropdown" — four is the top of the away lineup, enough to read the card without
// scrolling past it; the other fourteen are one click.
const ROW_CAP = 4;
// Games shown per day before the dropdown (matches PropsView).
const DAY_CAP = 6;

interface Leg {
  id: string; game: string; player: string; bet: string; best: number; books: string[];
  byBook?: Record<string, number>; fairProb?: number | null;
}

function sideLabel(q: Quote): string {
  if (q.side === "Yes") return "Yes";
  if (q.side === "No") return "No";
  return `${q.side[0]} ${q.line}`;
}

function Cell({ q, market, label, game, saved, onToggle }: {
  q: Quote; market: string; label: string; game: string; saved: boolean; onToggle: (l: Leg) => void;
}) {
  const a = q.fairProb != null ? audit(q.price, q.fairProb) : null;
  const leg: Leg = {
    id: `${q.eventId}:${market}:${q.player}:${q.side}:${q.line}`,
    game, player: q.team ? `${q.player} (${q.team})` : q.player, bet: `${label} ${sideLabel(q)}`,
    best: q.price, books: q.books, byBook: q.byBook, fairProb: q.fairProb ?? null,
  };
  return (
    <button type="button" className={`bg__q savable${saved ? " saved" : ""}`} aria-pressed={saved}
      onClick={() => onToggle(leg)} title={`${q.player} · ${label} ${sideLabel(q)} · ${q.books.map(bookLabel).join(" / ")}${saved ? " — remove from slip" : " — add to slip"}`}>
      <span className="bg__side">{sideLabel(q)}</span>
      <b className="bg__price">
        {fmtOdds(q.price)}
        {a && a.verdict === "value" && <sup className="propq__audit propq__audit--value">✓</sup>}
      </b>
      <span className="bg__book">{booksCode(q.books)}</span>
    </button>
  );
}

function GameGrid({ g, markets, labels, has, toggle, cls }: {
  g: PropGame; markets: string[]; labels: Record<string, string>;
  has: (id: string) => boolean; toggle: (l: Leg) => void; cls?: string;
}) {
  // Columns: the category's markets this game actually has quotes for, in category order.
  const present = markets.filter((m) => g.markets.some((b) => b.market === m && b.quotes.length));
  const byMarket = new Map(g.markets.map((b) => [b.market, b.quotes]));
  // Rows: players in first-seen order across the columns. The quotes arrive in lineup order
  // (away side, then home, leadoff to nine — see page.tsx), so this keeps it.
  const players: string[] = [];
  const team = new Map<string, string | undefined>();
  for (const m of present) for (const q of byMarket.get(m) ?? []) {
    if (!team.has(q.player)) { players.push(q.player); team.set(q.player, q.team); }
  }
  const cellOf = (player: string, m: string) => {
    const qs = (byMarket.get(m) ?? []).filter((q) => q.player === player);
    const over = qs.find((q) => q.side === "Over" || q.side === "Yes");
    const under = qs.find((q) => q.side === "Under" || q.side === "No");
    return { over, under };
  };
  const moreId = `bg-${g.eventId}`;
  const hidden = Math.max(0, players.length - ROW_CAP);
  return (
    <details className={`propgame propgame--grid${cls ? ` ${cls}` : ""}`} open>
      <summary className="propgame__head">
        <span className="matchup">{g.away}<span className="at">@</span>{g.home}</span>
        {g.commence && <time className="propgame__kick">{kickET(g.commence)}</time>}
        <span className="propgame__meta">{players.length} players<span className="propgame__chev">▸</span></span>
      </summary>
      {/* Its own row class (bg-row--more), not hb-row--more: the DAY's checkbox above hides every
          hb-row--more beneath it, so a per-game "show more players" toggle would never win. */}
      <div className="propgame__body propgame__body--grid hb-moretbl">
        <input type="checkbox" id={moreId} className="hb-moretbl__chk" aria-hidden="true" tabIndex={-1} />
        <div className="pmscroll">
          <table className="bgrid" style={{ minWidth: `${150 + present.length * 116}px` }}>
            <thead>
              <tr>
                <th className="bg__player">Player</th>
                {present.map((m) => <th key={m}>{labels[m] ?? m}</th>)}
              </tr>
            </thead>
            <tbody>
              {players.map((p, i) => (
                <tr key={p} className={i >= ROW_CAP ? "bg-row--more" : undefined}>
                  <td className="bg__player">
                    <span className="bg__name">{p}</span>
                    {team.get(p) && <span className="propq__slot"> ({team.get(p)})</span>}
                  </td>
                  {present.map((m) => {
                    const { over, under } = cellOf(p, m);
                    return (
                      <td key={m}>
                        {over ? <Cell q={over} market={m} label={labels[m] ?? m} game={g.matchup} saved={has(`${over.eventId}:${m}:${over.player}:${over.side}:${over.line}`)} onToggle={toggle} /> : null}
                        {under ? <Cell q={under} market={m} label={labels[m] ?? m} game={g.matchup} saved={has(`${under.eventId}:${m}:${under.player}:${under.side}:${under.line}`)} onToggle={toggle} /> : null}
                        {!over && !under && <span className="bg__none">—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {hidden > 0 && (
          <label htmlFor={moreId} className="hb-moretbl__sum">
            <span className="hb-more__chev" aria-hidden="true">▸</span>
            <span className="hb-moretbl__more">Show {hidden} more player{hidden === 1 ? "" : "s"}</span>
            <span className="hb-moretbl__less">Show fewer</span>
          </label>
        )}
      </div>
    </details>
  );
}

export default function BatterGrid({ games, markets, labels, today, tomorrow }: {
  games: PropGame[]; markets: string[]; labels: Record<string, string>; today: string; tomorrow: string;
}) {
  const { has, toggle: slipToggle } = useSlip();
  const toggle = useCallback((l: Leg) => slipToggle({
    id: l.id, kind: "prop",
    title: `${l.player} ${l.bet}`, detail: l.game,
    price: l.best, books: l.books, byBook: l.byBook, fairProb: l.fairProb,
  }), [slipToggle]);

  return (
    <>
      <section className="propdays">
        {groupByGameDay(games, (g) => g.commence, today, tomorrow).map((grp) => (
          <div className="propday hb-moretbl" key={grp.key}>
            <DayHeader label={grp.label} tone={grp.tone} count={grp.items.length} />
            <input type="checkbox" id={`bgd-${grp.key}`} className="hb-moretbl__chk" aria-hidden="true" tabIndex={-1} />
            {/* Two games across when the category has two markets or fewer (Home Runs: HR and
                first HR). A two-column table stretched to the full card width put ~500px of
                nothing between the columns — Derek: "eliminate all that space in the charts.
                On this page we can have two games side-by-side." */}
            <div className={`propstack propstack--grid${markets.length <= 2 ? " propstack--pairs" : ""}`}>
              {grp.items.map((g, i) => (
                <GameGrid key={g.eventId} g={g} markets={markets} labels={labels} has={has} toggle={toggle}
                  cls={i >= DAY_CAP ? "hb-row--more" : undefined} />
              ))}
            </div>
            {grp.items.length > DAY_CAP && (
              <label htmlFor={`bgd-${grp.key}`} className="hb-moretbl__sum">
                <span className="hb-more__chev" aria-hidden="true">▸</span>
                <span className="hb-moretbl__more">Show {grp.items.length - DAY_CAP} more game{grp.items.length - DAY_CAP === 1 ? "" : "s"}</span>
                <span className="hb-moretbl__less">Show fewer</span>
              </label>
            )}
          </div>
        ))}
      </section>
    </>
  );
}
