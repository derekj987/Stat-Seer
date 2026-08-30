"use client";

// This week's NCAAF "sweet spots" — games whose consensus spread sits on (or a half-point
// from) a key number, where buying/selling the number matters most. Mirrors the NFL Sweet
// Spots plays: each is tap-to-add to the slip. Uses the same leg ids as the Game Lines
// board so adding here or there is one and the same pick.
import { useSlip, type SlipItem } from "@/lib/slip";
import { abbrevTeam } from "@/lib/ncaafAbbrev";
import type { NcaafCardGame, NcaafKeyNum } from "../model-data";
import { groupByGameDay } from "@/lib/gameDays";
import { DayHeader } from "../../DayHeader";

const KEYS = [3, 7, 10, 14];
const nearKey = (n: number): number | null => {
  const a = Math.abs(n);
  for (const k of KEYS) if (Math.abs(a - k) <= 0.5) return k;
  return null;
};
const gk = (g: NcaafCardGame) => `${g.away}-${g.home}`.replace(/[^a-z0-9]+/gi, "-").toLowerCase();

function Chip({ item, has, toggle }: { item: SlipItem; has: (id: string) => boolean; toggle: (i: SlipItem) => void }) {
  const on = has(item.id);
  return (
    <button type="button" className={on ? "ncline__chip on" : "ncline__chip"} aria-pressed={on}
      onClick={() => toggle(item)} title={on ? `${item.title} — remove from slip` : `Add ${item.title} to slip`}>
      <span className="ncline__t">{item.title}</span>
      <span className="ncline__plus" aria-hidden="true">{on ? "♥" : "+"}</span>
    </button>
  );
}

export default function NcaafSweetSpots({ games, keyNums, week, today, tomorrow }:
  { games: readonly NcaafCardGame[]; keyNums: readonly NcaafKeyNum[]; week: number; today: string; tomorrow: string }) {
  const { has, toggle } = useSlip();
  const pctOf = (k: number) => keyNums.find((x) => x.margin === k)?.pct ?? 0;
  const plays = games
    .filter((g) => g.marketSpread && nearKey(g.marketSpread.num) !== null)
    .map((g) => ({ g, key: nearKey(g.marketSpread!.num)! }))
    .sort((a, b) => pctOf(b.key) - pctOf(a.key) || a.key - b.key);

  if (!plays.length) return null;

  return (
    <section className="ncf-sec">
      <h2 className="ncf-h">Sitting on a key number — Week {week}
        <span className="ncf-h__note">{plays.length} line{plays.length === 1 ? "" : "s"} on 3, 7, 10 or 14</span>
      </h2>
      {groupByGameDay(plays, (pl) => pl.g.commence, today, tomorrow).map((grp) => (
        <div key={grp.key}>
          <DayHeader label={grp.label} tone={grp.tone} count={grp.items.length} noun="line" />
          <div className="ncss-grid">
        {grp.items.map(({ g, key }) => {
          const ms = g.marketSpread!;
          const dog = ms.fav === g.home ? g.away : g.home;
          const mk = `${abbrevTeam(g.away)} @ ${abbrevTeam(g.home)}`;
          const k = gk(g);
          const favItem: SlipItem = { id: `ncsp-${k}-f`, kind: "line", title: `${abbrevTeam(ms.fav)} ${ms.num}`, detail: mk, price: -110 };
          const dogItem: SlipItem = { id: `ncsp-${k}-d`, kind: "line", title: `${abbrevTeam(dog)} +${Math.abs(ms.num)}`, detail: mk, price: -110 };
          return (
            <article className="ncss" key={k}>
              <header className="ncss__hd">
                <span className="ncss__g">{mk}</span>
                <span className="ncss__badge">KEY {key}</span>
              </header>
              <div className="ncss__val"><b>{pctOf(key)}%</b><span>land on {key}</span></div>
              <div className="ncss__sides">
                <Chip item={favItem} has={has} toggle={toggle} />
                <Chip item={dogItem} has={has} toggle={toggle} />
              </div>
              <p className="ncss__why">
                This line sits on <b>{key}</b> — a top key number. A half-point across {key} buys ~{pctOf(key)}% of
                outcomes, so the number matters most here: buy toward it, sell off it.
              </p>
            </article>
          );
        })}
          </div>
        </div>
      ))}
      <p className="ncf-note">Consensus lines at −110 — tap a side to add it. Key-number value from {" "}
        {keyNums.length} measured margins below.</p>
    </section>
  );
}
