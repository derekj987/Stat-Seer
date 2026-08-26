"use client";

// A bet slip attached to a wall post — a compact read of the legs and the single
// best book for the whole parlay, with actions to open the full shared view or copy
// the picks onto the reader's own slip. Member content, not a StatSeer pick.
import { useSlip, encodeSlip, type SlipItem, type SlipKind } from "@/lib/slip";
import { bookName, fmtOdds, legBest, priceSlip, decToAmerican } from "@/lib/slipPricing";

const KIND_LABEL: Record<SlipKind, string> = {
  line: "Game Lines", prop: "Player Props", model: "The Model", fan: "Local Intelligence",
};

export default function WallSlipCard({ items }: { items: SlipItem[] }) {
  const { addMany } = useSlip();
  if (!items?.length) return null;
  const { legs, oneBook } = priceSlip(items);
  const shareUrl = `/slip?d=${encodeSlip(items)}`;

  return (
    <div className="wslip">
      <div className="wslip__hd">
        <span className="wslip__tag">Bet slip</span>
        <span className="wslip__n">{items.length} pick{items.length === 1 ? "" : "s"}</span>
      </div>

      <ul className="wslip__legs">
        {items.map((i) => {
          const lb = i.byBook && Object.keys(i.byBook).length ? legBest(i) : null;
          const price = lb ? lb.best : i.price;
          return (
            <li className="wslip__leg" key={i.id}>
              <span className="wslip__kind">{KIND_LABEL[i.kind]}</span>
              <span className="wslip__t">{i.title}</span>
              {i.detail && <span className="wslip__d">{i.detail}</span>}
              {price !== undefined && <span className="wslip__odds">{fmtOdds(price)}</span>}
            </li>
          );
        })}
      </ul>

      {oneBook && legs.length > 1 && (
        <div className="wslip__best">
          <span className="wslip__bestlab">Best book for all {oneBook.covers} legs</span>
          <span className="wslip__bestbook">{bookName(oneBook.book)}</span>
          <span className="wslip__bestodds">{decToAmerican(oneBook.decimal)}</span>
        </div>
      )}

      <div className="wslip__act">
        <a href={shareUrl} className="wslip__view">View &amp; price it →</a>
        <button type="button" className="wslip__copy" onClick={() => addMany(items)}>Copy to my slip</button>
      </div>
    </div>
  );
}
