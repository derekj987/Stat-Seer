"use client";

import { useCallback } from "react";
import type { PropGame, Quote } from "@/lib/props";
import { BetslipPromo } from "../Nav";
import { useSlip } from "@/lib/slip";
import { groupByGameDay } from "@/lib/gameDays";
import { DayHeader } from "../DayHeader";
import { audit, VERDICT_LABEL } from "@/lib/fairValue";

const fmtOdds = (p: number) => (p > 0 ? `+${p}` : String(p));
function sideLabel(side: string, line: number | null): string {
  if (side === "Yes") return "";
  if (side === "No") return "No";
  return line !== null ? `${side[0]} ${line}` : side;
}

interface Leg {
  id: string;
  game: string;
  player: string;
  bet: string; // e.g. "ATTD" / "O 249.5"
  best: number;
  books: string[];
  byBook?: Record<string, number>;
  fairProb?: number | null;
}

function PropChip({ q, market, marketLabel, game, saved, cont, onToggle }: {
  q: Quote; market: string; marketLabel: string; game: string; saved: boolean; cont?: boolean; onToggle: (l: Leg) => void;
}) {
  const bet = marketLabel === "ATTD" ? "ATTD" : sideLabel(q.side, q.line) || q.side;
  // "(QB1, NE)" — depth slot + team, matching the Model chart. Either part may be missing (a player
  // absent from the depth chart), so build from whatever we have.
  const tag = [q.slot, q.team].filter(Boolean).join(", ");
  const name = tag ? `${q.player} (${tag})` : q.player;
  const a = q.fairProb != null ? audit(q.price, q.fairProb) : null;   // Pick Auditor
  const leg: Leg = {
    id: `${q.eventId}:${market}:${q.player}:${q.side}:${q.line}`,
    game, player: name, bet, best: q.price, books: q.books, byBook: q.byBook,
    fairProb: q.fairProb ?? null,
  };
  return (
    <button
      type="button"
      onClick={() => onToggle(leg)}
      className={`propq savable${saved ? " saved" : ""}`}
      aria-pressed={saved}
      title={saved ? "Remove from slip" : "Add to slip"}
    >
      {/* `cont` = the Over/Under partner of the row above. Blanking the repeated name (the same way
          the Model chart stacks a player's markets) makes the pair read as one player with two
          sides, instead of looking like a duplicated row. */}
      <span className="propq__player">{cont ? "" : <>{q.player}{tag && <span className="propq__slot"> ({tag})</span>}</>}</span>
      <span className="propq__side">{sideLabel(q.side, q.line)}</span>
      <span className="propq__price">
        {fmtOdds(q.price)}
        {/* Best price shown, so flag only genuine value (beats the de-vigged market). The
            overpriced verdict lives on the Pick Auditor, where a specific book's price is judged. */}
        {a && a.verdict === "value" && (
          <sup className="propq__audit propq__audit--value"
            title={`Pick Auditor: fair price ≈ ${fmtOdds(a.fair)} (de-vigged market) — ${VERDICT_LABEL.value}: this beats the fair number`}>
            ✓
          </sup>
        )}
      </span>
      <span className="propq__book">{q.books.join(" / ")}</span>
      <span className="propq__add" aria-hidden="true">{saved ? "✓" : "+"}</span>
    </button>
  );
}

const pkFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});
const kickET = (iso: string) => pkFmt.format(new Date(iso)) + " ET";

// How many PLAYERS (not rows) each market shows before the dropdown. Counted in players because a
// player usually occupies two rows — his Over and his Under — so a row cap would cut a pair in half.
const PLAYER_CAP = 3;

/** One market's quote rows. `cont` is recomputed against THIS list, so a segment never opens on a
 *  blank name: the player label is blanked only when the row above it (in the same segment) is the
 *  same player. Splitting a pre-computed list would strand a nameless row at the top of the
 *  dropdown. */
function QuoteList({ quotes, market, marketLabel, game, has, toggle }: {
  quotes: Quote[]; market: string; marketLabel: string; game: string;
  has: (id: string) => boolean; toggle: (l: Leg) => void;
}) {
  return (
    <ul className="propq__list">
      {quotes.map((q, i) => {
        const id = `${q.eventId}:${market}:${q.player}:${q.side}:${q.line}`;
        const cont = i > 0 && quotes[i - 1].player === q.player;
        return (
          <li key={`${id}:${i}`}>
            <PropChip q={q} market={market} marketLabel={marketLabel} game={game}
              saved={has(id)} cont={cont} onToggle={toggle} />
          </li>
        );
      })}
    </ul>
  );
}

function PropGameCard({ g, open, has, toggle }: {
  g: PropGame; open?: boolean; has: (id: string) => boolean; toggle: (l: Leg) => void;
}) {
  const nPlayers = new Set(g.markets.flatMap((m) => m.quotes.map((q) => q.player))).size;
  return (
    <details className="propgame" open={open}>
      <summary className="propgame__head">
        <span className="matchup">{g.away}<span className="at">@</span>{g.home}</span>
        {g.commence && <time className="propgame__kick">{kickET(g.commence)}</time>}
        <span className="propgame__meta">{nPlayers} players<span className="propgame__chev">▸</span></span>
      </summary>
      <div className="propgame__body">
        {g.markets.map((m) => {
          // Split on a PLAYER boundary so a player's Over/Under pair is never separated across the
          // dropdown. Quotes arrive sorted by player, so filtering preserves the grouping.
          const players = [...new Set(m.quotes.map((q) => q.player))];
          const head = new Set(players.slice(0, PLAYER_CAP));
          const shown = m.quotes.filter((q) => head.has(q.player));
          const rest = m.quotes.filter((q) => !head.has(q.player));
          const more = players.length - head.size;
          return (
            <div className="propmkt" key={m.market}>
              <div className="propmkt__label">{m.label}</div>
              <QuoteList quotes={shown} market={m.market} marketLabel={m.label} game={g.matchup}
                has={has} toggle={toggle} />
              {more > 0 && (
                <details className="hb-showmore">
                  <summary className="hb-showmore__sum">
                    <span className="hb-showmore__chev" aria-hidden="true">▸</span>
                    <span className="hb-showmore__more">Show {more} more player{more === 1 ? "" : "s"}</span>
                    <span className="hb-showmore__less">Collapse</span>
                  </summary>
                  <QuoteList quotes={rest} market={m.market} marketLabel={m.label} game={g.matchup}
                    has={has} toggle={toggle} />
                </details>
              )}
            </div>
          );
        })}
      </div>
    </details>
  );
}

export default function PropsView({ games, embedded, today, tomorrow }: { games: PropGame[]; embedded?: boolean; today: string; tomorrow: string }) {
  const { has, toggle: slipToggle } = useSlip();
  const toggle = useCallback((l: Leg) => slipToggle({
    id: l.id, kind: "prop",
    title: `${l.player} ${l.bet}`, detail: l.game,
    price: l.best, books: l.books, byBook: l.byBook, fairProb: l.fairProb,
  }), [slipToggle]);

  const players = games.reduce(
    (n, g) => n + new Set(g.markets.flatMap((m) => m.quotes.map((q) => q.player))).size, 0
  );

  return (
    <>
      {!embedded && <BetslipPromo />}
      <p className="hint">{games.length} games · {players} players · best price on each, shopped across books.</p>
      <section className="propdays">
        {groupByGameDay(games, (g) => g.commence, today, tomorrow).map((grp) => (
          <div className="propday" key={grp.key}>
            <DayHeader label={grp.label} tone={grp.tone} count={grp.items.length} />
            <div className="propstack">
              {grp.items.map((g) => <PropGameCard key={g.eventId} g={g} has={has} toggle={toggle} />)}
            </div>
          </div>
        ))}
      </section>
      {!embedded && (
        <footer className="foot">
          <p><b>No model. No pick.</b> Just the best available price on each player prop across books — where props
          edge most plausibly lives, since books price hundreds of them semi-independently. Projections (is the line
          beatable?) come later. Prices move; updates as new odds are captured.</p>
        </footer>
      )}
    </>
  );
}
