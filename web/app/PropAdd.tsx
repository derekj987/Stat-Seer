"use client";

// Add-to-slip control for a single player-prop row on The Model's Player Prop page.
// The Model is line-blind, so these add the BOOK's market pick (the over/under, or the
// anytime-TD yes) at the consensus price — members shop the best price on Value Finder.
// Over/under markets get two chips (＋O / ＋U); anytime-TD gets one (＋ATTD).
import { useSlip, type SlipItem } from "@/lib/slip";

// Implied win % (0–100) → american odds, for pricing an anytime-TD pick off its book %.
function pctToAmerican(pct: number): number {
  const p = Math.min(0.99, Math.max(0.01, pct / 100));
  return p >= 0.5 ? -Math.round((p / (1 - p)) * 100) : Math.round(((1 - p) / p) * 100);
}

export default function PropAdd({ player, market, line, game }: {
  player: string; market: string; line: number; game: string;
}) {
  const { has, toggle } = useSlip();
  const leg = (side: string, label: string, price: number): SlipItem => ({
    id: `pm:${game}:${market}:${player}:${side}:${side === "Yes" ? "" : line}`,
    kind: "prop", title: `${player} ${label}`, detail: game, price,
  });

  if (market === "anytime_td") {
    const it = leg("Yes", "ATTD", pctToAmerican(line));
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

  const over = leg("Over", `O ${line}`, -110);
  const under = leg("Under", `U ${line}`, -110);
  const onO = has(over.id), onU = has(under.id);
  return (
    <span className="pmadd">
      <button type="button" className={`pmadd__b${onO ? " on" : ""}`} aria-pressed={onO}
        onClick={() => toggle(over)} title={onO ? "Remove Over from slip" : "Add the Over to slip"}>
        {onO ? "✓" : "+"} O
      </button>
      <button type="button" className={`pmadd__b${onU ? " on" : ""}`} aria-pressed={onU}
        onClick={() => toggle(under)} title={onU ? "Remove Under from slip" : "Add the Under to slip"}>
        {onU ? "✓" : "+"} U
      </button>
    </span>
  );
}
