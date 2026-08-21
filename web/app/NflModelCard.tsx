import type { CardRow } from "@/lib/home";

// The Model Card (snapshot view) — the same table the landing shows, reusable on The
// Model page. Collapsed by default; shows the first 6 games with a "see more" for the rest.
const numStr = (v: number | null) => (v === null ? "—" : String(v));

function CardHead() {
  return <thead><tr><th className="hb-l">Game</th><th>Market Spread</th><th>Market O/U</th><th>Our Model Suggests</th></tr></thead>;
}
function CardRows({ rows }: { rows: CardRow[] }) {
  return (
    <>
      {rows.map((r) => (
        <tr key={r.eventId} className={r.off ? "hb-off" : undefined}>
          <td className="hb-l"><span className="hb-game">{r.away}<span className="hb-at">at</span>{r.home}</span>{r.off && <span className="hb-dia hb-dia--end">◆</span>}</td>
          <td className="hb-num">{r.marketSpread ?? "—"}</td>
          <td className="hb-num hb-tot">{numStr(r.marketTotal)}</td>
          <td className="hb-suggest">
            {r.spreadLean || r.totalLean ? (
              <span className="hb-sugwrap">
                {r.spreadLean && <span className="hb-sug"><span className="hb-sug__t">{r.spreadLean.side} {r.spreadLean.num}</span></span>}
                {r.totalLean && <span className="hb-sug"><span className="hb-sug__t">{r.totalLean.dir === "OVER" ? "Over" : "Under"} {r.totalLean.num}</span></span>}
              </span>
            ) : <span className="hb-leannone">even</span>}
          </td>
        </tr>
      ))}
    </>
  );
}

export default function NflModelCard({ rows, open = false }: { rows: CardRow[]; open?: boolean }) {
  const lead = rows.slice(0, 6);
  const rest = rows.slice(6);
  return (
    <details className="hb-panel hb-panel--card" open={open}>
      <summary className="hb-bar">
        <span className="hb-bar__title hb-bar__title--gold">The Model Card — Snapshot View</span>
        <span className="hb-bar__count">{rows.length} games</span>
        <span className="hb-bar__hint">our model&apos;s read beside the market&apos;s, every game</span>
        <span className="hb-bar__chev" aria-hidden="true">▾</span>
      </summary>
      <div className="hb-body">
        {rows.length === 0 ? (
          <p className="hb-empty">The board opens when this week&apos;s odds and reads post.</p>
        ) : (
          <>
            <div className="hb-formwrap">
              <table className="hb-form"><CardHead /><tbody><CardRows rows={lead} /></tbody></table>
            </div>
            {rest.length > 0 && (
              <details className="hb-more">
                <summary className="hb-more__sum">
                  <span className="hb-more__chev" aria-hidden="true">▸</span>
                  See more ({rest.length} more games)
                </summary>
                <div className="hb-formwrap">
                  <table className="hb-form"><CardHead /><tbody><CardRows rows={rest} /></tbody></table>
                </div>
              </details>
            )}
          </>
        )}
      </div>
    </details>
  );
}
