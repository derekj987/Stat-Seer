"use client";

// Add-to-slip control for a single player-prop row on The Model's Player Prop page.
// When we have the live book market for this player+side, the chip carries the BEST price
// and every book's price (byBook) — identical to Value Finder, so the slip's best-book math
// works. When we don't (no posted market), it falls back to the consensus price.
// Over/under markets get two chips (＋O / ＋U); anytime-TD gets one (＋ATTD).
import { useSlip, type SlipItem } from "@/lib/slip";

// Live best price for one side of a market, threaded down from the server.
export interface PricedSide {
  line: number | null;
  price: number;
  books?: string[];
  byBook?: Record<string, number>;
}

// Implied win % (0–100) → american odds, for pricing an anytime-TD pick off its book %.
function pctToAmerican(pct: number): number {
  const p = Math.min(0.99, Math.max(0.01, pct / 100));
  return p >= 0.5 ? -Math.round((p / (1 - p)) * 100) : Math.round(((1 - p) / p) * 100);
}

export default function PropAdd({ player, market, line, game, slot, over, under, attd }: {
  player: string; market: string; line: number; game: string; slot?: string | null;
  over?: PricedSide | null; under?: PricedSide | null; attd?: PricedSide | null;
}) {
  const { has, toggle } = useSlip();
  const name = slot ? `${player} (${slot})` : player;
  const leg = (side: string, lineKey: number | null, label: string, priced?: PricedSide | null): SlipItem => ({
    id: `pm:${game}:${market}:${player}:${side}:${side === "Yes" ? "" : lineKey}`,
    kind: "prop", title: `${name} ${label}`, detail: game,
    price: priced?.price ?? (side === "Yes" ? pctToAmerican(line) : -110),
    books: priced?.books, byBook: priced?.byBook,
  });

  if (market === "anytime_td") {
    const it = leg("Yes", null, "ATTD", attd);
    const on = has(it.id);
    return (
      <span className="pmadd">
        <button type="button" className={`pmadd__b${on ? " on" : ""}`} aria-pressed={on}
          onClick={() => toggle(it)} title={on ? "Remove ATTD from slip" : "Add ATTD to slip"}>
          {on ? "✓" : "+"} ATTD
        </button>
      </span>
    );
  }

  const oLine = over?.line ?? line, uLine = under?.line ?? line;
  const overLeg = leg("Over", oLine, `O ${oLine}`, over);
  const underLeg = leg("Under", uLine, `U ${uLine}`, under);
  const onO = has(overLeg.id), onU = has(underLeg.id);
  return (
    <span className="pmadd">
      <button type="button" className={`pmadd__b${onO ? " on" : ""}`} aria-pressed={onO}
        onClick={() => toggle(overLeg)} title={onO ? "Remove Over from slip" : "Add the Over to slip"}>
        {onO ? "✓" : "+"} O
      </button>
      <button type="button" className={`pmadd__b${onU ? " on" : ""}`} aria-pressed={onU}
        onClick={() => toggle(underLeg)} title={onU ? "Remove Under from slip" : "Add the Under to slip"}>
        {onU ? "✓" : "+"} U
      </button>
    </span>
  );
}
