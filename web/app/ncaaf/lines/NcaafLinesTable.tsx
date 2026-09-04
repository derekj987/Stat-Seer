"use client";

// Tappable NCAAF game-lines board — mirrors the NFL board's tap-to-add interaction, wired
// to the shared slip store. Each side (spread fav / dog, total over / under) is its own
// chip you can drop onto your Value Finder slip. NCAAF game odds are a consensus snapshot
// (not per-book yet), so legs price at the standard -110 and there's no best-book column;
// that piece arrives when the live NCAAF odds capture is deployed.
import { useSlip, type SlipItem } from "@/lib/slip";
import { abbrevTeam } from "@/lib/ncaafAbbrev";
import { NcaafCardHead, NcaafGameCell } from "../CardCells";
import type { NcaafCardGame } from "../model-data";
import { capDayGroups, groupByGameDay, type DayGroup } from "@/lib/gameDays";
import { DayHeader } from "../../DayHeader";

function Chip({ item }: { item: SlipItem }) {
  const { has, toggle } = useSlip();
  const on = has(item.id);
  return (
    <button
      type="button"
      className={on ? "ncline__chip on" : "ncline__chip"}
      aria-pressed={on}
      onClick={() => toggle(item)}
      title={on ? `${item.title} — remove from slip` : `Add ${item.title} to slip`}
    >
      <span className="ncline__t">{item.title}</span>
      <span className="ncline__plus" aria-hidden="true">{on ? "♥" : "+"}</span>
    </button>
  );
}

const gkey = (g: NcaafCardGame) => `${g.away}-${g.home}`.replace(/[^a-z0-9]+/gi, "-").toLowerCase();

const GAME_CAP = 3;   // games shown before the "show more" dropdown

export default function NcaafLinesTable({ games, today, tomorrow }: { games: NcaafCardGame[]; today: string; tomorrow: string }) {
  // First GAME_CAP games visible, the rest behind the standard dropdown. capDayGroups splits a day
  // at the boundary and flags the tail `cont`, so the day header is drawn exactly once.
  const { head, rest, restCount } = capDayGroups(
    groupByGameDay(games, (g) => g.commence, today, tomorrow), GAME_CAP);
  // Column header on the FIRST day group only — see the model board: a <thead> per day group
  // repeats the column row under every date and reads as several charts instead of one.
  const dayTable = (grp: DayGroup<NcaafCardGame>, i: number) => (
        <div key={grp.key}>
          {!grp.cont && <DayHeader label={grp.label} tone={grp.tone} count={grp.total ?? grp.items.length} />}
          <div className="hb-formwrap">
          <table className="hb-form hb-form--mkt ncline">
            {i === 0 && <NcaafCardHead />}
            <tbody>
              {grp.items.map((g) => {
                const ms = g.marketSpread!;
                const mk = `${abbrevTeam(g.away)} @ ${abbrevTeam(g.home)}`;
                const k = gkey(g);
                const dog = ms.fav === g.home ? g.away : g.home;
                return (
                  <tr key={k} className={g.off ? "hb-off" : undefined}>
                    <NcaafGameCell g={g} />
                <td className="hb-num">
                  <div className="ncline__chips">
                    <Chip item={{ id: `ncsp-${k}-f`, kind: "line", title: `${abbrevTeam(ms.fav)} ${ms.num}`, detail: mk, price: -110 }} />
                    <Chip item={{ id: `ncsp-${k}-d`, kind: "line", title: `${abbrevTeam(dog)} +${Math.abs(ms.num)}`, detail: mk, price: -110 }} />
                  </div>
                </td>
                <td className="hb-num hb-tot">
                  {g.marketTotal != null ? (
                    <div className="ncline__chips">
                      <Chip item={{ id: `nctot-${k}-o`, kind: "line", title: `Over ${g.marketTotal}`, detail: mk, price: -110 }} />
                      <Chip item={{ id: `nctot-${k}-u`, kind: "line", title: `Under ${g.marketTotal}`, detail: mk, price: -110 }} />
                    </div>
                  ) : "—"}
                </td>
                <td className="hb-num hb-model">{abbrevTeam(g.projSpread.fav)} {g.projSpread.num}</td>
                <td className="hb-num hb-model">{g.projTotal}</td>
              </tr>
            );
          })}
            </tbody>
          </table>
          </div>
        </div>
  );
  return (
    <div>
      {head.map(dayTable)}
      {restCount > 0 && (
        <details className="hb-showmore">
          <summary className="hb-showmore__sum">
            <span className="hb-showmore__chev" aria-hidden="true">&#9656;</span>
            <span className="hb-showmore__more">Show {restCount} more game{restCount === 1 ? "" : "s"}</span>
            <span className="hb-showmore__less">Collapse</span>
          </summary>
          {rest.map((g, i) => dayTable(g, i + 1))}
        </details>
      )}
    </div>
  );
}
