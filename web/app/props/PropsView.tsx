"use client";

import { useCallback } from "react";
import type { PropGame, Quote } from "@/lib/props";
import { BetslipPromo } from "../Nav";
import { useSlip } from "@/lib/slip";

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
}

function PropChip({ q, market, marketLabel, game, saved, onToggle }: {
  q: Quote; market: string; marketLabel: string; game: string; saved: boolean; onToggle: (l: Leg) => void;
}) {
  const bet = marketLabel === "ATTD" ? "ATTD" : sideLabel(q.side, q.line) || q.side;
  const leg: Leg = {
    id: `${q.eventId}:${market}:${q.player}:${q.side}:${q.line}`,
    game, player: q.player, bet, best: q.price, books: q.books,
  };
  return (
    <button
      type="button"
      onClick={() => onToggle(leg)}
      className={`propq savable${saved ? " saved" : ""}`}
      aria-pressed={saved}
      title={saved ? "Remove from slip" : "Add to slip"}
    >
      <span className="propq__player">{q.player}</span>
      <span className="propq__side">{sideLabel(q.side, q.line)}</span>
      <span className="propq__price">{fmtOdds(q.price)}</span>
      <span className="propq__book">{q.books.join(" / ")}</span>
      <span className="propq__add" aria-hidden="true">{saved ? "✓" : "+"}</span>
    </button>
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
        <span className="propgame__meta">{nPlayers} players<span className="propgame__chev">▸</span></span>
      </summary>
      <div className="propgame__body">
        {g.markets.map((m) => (
          <div className="propmkt" key={m.market}>
            <div className="propmkt__label">{m.label}</div>
            <ul className="propq__list">
              {m.quotes.map((q, i) => {
                const id = `${q.eventId}:${m.market}:${q.player}:${q.side}:${q.line}`;
                return (
                  <li key={`${id}:${i}`}>
                    <PropChip q={q} market={m.market} marketLabel={m.label} game={g.matchup}
                      saved={has(id)} onToggle={toggle} />
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </details>
  );
}

export default function PropsView({ games, embedded }: { games: PropGame[]; embedded?: boolean }) {
  const { has, toggle: slipToggle } = useSlip();
  const toggle = useCallback((l: Leg) => slipToggle({
    id: l.id, kind: "prop",
    title: `${l.player} ${l.bet}`, detail: l.game,
    price: l.best, books: l.books,
  }), [slipToggle]);

  const players = games.reduce(
    (n, g) => n + new Set(g.markets.flatMap((m) => m.quotes.map((q) => q.player))).size, 0
  );

  return (
    <>
      {!embedded && <BetslipPromo />}
      <p className="hint">{games.length} games · {players} players · best price on each, shopped across books.</p>
      <section className="propstack">
        {games.map((g) => (
          <PropGameCard key={g.eventId} g={g} has={has} toggle={toggle} />
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
