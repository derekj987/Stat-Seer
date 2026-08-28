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

export default function NcaafLinesTable({ games }: { games: NcaafCardGame[] }) {
  return (
    <div className="hb-formwrap">
      <table className="hb-form hb-form--mkt ncline">
        <NcaafCardHead />
        <tbody>
          {games.map((g) => {
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
  );
}
