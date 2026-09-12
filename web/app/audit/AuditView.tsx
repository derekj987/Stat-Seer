"use client";

// Pick Auditor — no inputs. It lists the live book price on every player prop and, using the
// market's OWN de-vigged fair price (strip the vig off both sides), flags each one with a
// coloured circle: green = value (the price beats fair), white = fair (a normal number), red =
// overpriced (worse than a typical hold explains). Same table shape as The Model's prop page.
import { useCallback } from "react";
import type { PropGame, Quote } from "@/lib/props";
import { useSlip } from "@/lib/slip";
import { groupByGameDay } from "@/lib/gameDays";
import { DayHeader } from "../DayHeader";
import { auditVerdict, probToAmerican, impliedProb, type AuditVerdict } from "@/lib/fairValue";

// Line-shopping win: how much better the BEST posted price is than the field average, in
// probability terms. A meaningful gap means you're getting a materially better number than the
// typical book — a real deal even when it doesn't beat the theoretical no-vig fair.
const SHOP_WIN = 0.02;
function shoppingEdge(price: number, byBook?: Record<string, number>): number {
  const others = byBook ? Object.values(byBook) : [];
  if (others.length < 2) return 0;
  const avg = others.reduce((s, p) => s + impliedProb(p), 0) / others.length;
  return avg - impliedProb(price); // + = best price implies a lower (better-for-you) number than the field
}

const fmtOdds = (p: number) => (p > 0 ? `+${p}` : String(p));
const pct = (p: number) => `${Math.round(p * 100)}%`;

function betLabel(marketLabel: string, side: string, line: number | null): string {
  if (side === "Yes") return marketLabel;
  if (side === "No") return `No — ${marketLabel}`;
  if (side === "Over") return `Over ${line ?? ""}`.trim();
  if (side === "Under") return `Under ${line ?? ""}`.trim();
  return line !== null ? `${side} ${line}` : side;
}

// Group a game's quotes by player (like The Model): one player's bets read as a block, name shown
// once. Within a player, order by market then Over/Yes before Under/No.
function groupByPlayer(markets: PropGame["markets"]): { q: Quote; marketLabel: string }[] {
  const all = markets.flatMap((m) => m.quotes.map((q) => ({ q, marketLabel: m.label })));
  const order: string[] = [];
  const by = new Map<string, { q: Quote; marketLabel: string }[]>();
  for (const it of all) {
    if (!by.has(it.q.player)) { by.set(it.q.player, []); order.push(it.q.player); }
    by.get(it.q.player)!.push(it);
  }
  const sideRank = (s: string) => (s === "Over" || s === "Yes" ? 0 : 1);
  return order.flatMap((p) =>
    by.get(p)!.sort((a, b) => a.marketLabel.localeCompare(b.marketLabel) || sideRank(a.q.side) - sideRank(b.q.side)));
}

const CIRCLE_TITLE: Record<AuditVerdict, string> = {
  value: "Value — this price beats the de-vigged fair number",
  fair: "Fair — a normal price, in line with the de-vigged market",
  cheat: "Overpriced — worse than the de-vigged fair number",
};

interface Leg {
  id: string; game: string; player: string; bet: string;
  best: number; books: string[]; byBook?: Record<string, number>; fairProb?: number | null;
}

function AuditRow({ q, marketLabel, game, saved, cont, onToggle }: {
  q: Quote; marketLabel: string; game: string; saved: boolean; cont: boolean; onToggle: (l: Leg) => void;
}) {
  const a = auditVerdict(q.price, q.fairProb);
  const shopEdge = shoppingEdge(q.price, q.byBook);
  const shopWin = shopEdge >= SHOP_WIN;
  // Green if it beats the de-vigged fair OR it's a clear line-shopping win over the field.
  const verdict: AuditVerdict | null =
    (a && a.verdict === "value") || shopWin ? "value"
      : a ? a.verdict
        : shopWin ? "value" : null;
  const shopWhy = shopWin && !(a && a.verdict === "value");
  const title =
    verdict === "value"
      ? (shopWhy
        ? `Value — this book pays about ${Math.round(shopEdge * 100)}% better than the field (line-shopping win)`
        : CIRCLE_TITLE.value)
      : verdict ? CIRCLE_TITLE[verdict] : "";
  const bet = betLabel(marketLabel, q.side, q.line);
  const name = q.slot ? `${q.player} (${q.slot})` : q.player;
  const leg: Leg = {
    id: `${q.eventId}:${marketLabel}:${q.player}:${q.side}:${q.line}`,
    game, player: name, bet, best: q.price, books: q.books, byBook: q.byBook, fairProb: q.fairProb ?? null,
  };
  const fair = q.fairProb != null ? probToAmerican(q.fairProb) : null;
  return (
    <div className={`aurow${cont ? " aurow--cont" : ""}`} role="row">
      <span className="aucell aucell--player">{cont ? "" : <>{q.player}{q.slot && <span className="auslot"> ({q.slot})</span>}</>}</span>
      <span className="aucell aucell--bet">{bet}<small className="aucell__sub">{marketLabel}</small></span>
      <span className="aucell aucell--num aucell--book">{fmtOdds(q.price)}
        <small className="aucell__sub">{q.books[0]}{q.books.length > 1 ? ` +${q.books.length - 1}` : ""}</small>
      </span>
      <span className="aucell aucell--num aucell--fair">
        {fair !== null ? <>{fmtOdds(fair)} <small className="aucell__sub aucell__sub--model">{pct(q.fairProb!)}</small></> : <span className="aucell__sub">one-sided</span>}
      </span>
      <span className="aucell aucell--deal">
        {verdict ? (
          <span className={`aucircle aucircle--${verdict}${shopWhy ? " aucircle--shop" : ""}`} role="img" aria-label={title} title={title} />
        ) : (
          <span className="aucircle aucircle--na" role="img" aria-label="No fair price — this market has no posted other side to de-vig" title="No posted other side to de-vig — shop the best price on Player Props" />
        )}
      </span>
      <span className="aucell aucell--add">
        <button type="button" className={`auadd${saved ? " saved" : ""}`} aria-pressed={saved}
          title={saved ? "Remove from slip" : "Add to slip"} onClick={() => onToggle(leg)}>{saved ? "✓" : "+"}</button>
      </span>
    </div>
  );
}

const pkFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});
const kickET = (iso: string) => pkFmt.format(new Date(iso)) + " ET";

// Game cards shown per day before the dropdown, matching /props and /model.
const DAY_CAP = 6;

function AuditGame({ g, open, has, toggle, cls }: {
  g: PropGame; open?: boolean; has: (id: string) => boolean; toggle: (l: Leg) => void; cls?: string;
}) {
  // Count how many priced sides in this game we could actually audit (two-sided → have a fair number).
  const audited = g.markets.reduce((n, m) => n + m.quotes.filter((q) => q.fairProb != null).length, 0);
  return (
    <details className={`augame${cls ? ` ${cls}` : ""}`} open={open}>
      <summary className="augame__h">
        <span className="matchup">{g.away}<span className="at">@</span>{g.home}</span>
        {g.commence && <time className="augame__kick">{kickET(g.commence)}</time>}
        <span className="augame__meta">{audited} audited<span className="augame__chev" aria-hidden="true">▸</span></span>
      </summary>
      <div className="augame__body">
        <div className="auscroll">
          <div className="autbl" role="table">
            <div className="aurow aurow--head" role="row">
              <span className="aucell aucell--player">Player</span>
              <span className="aucell aucell--bet">Bet</span>
              <span className="aucell aucell--num">Book price</span>
              <span className="aucell aucell--num">Fair price</span>
              <span className="aucell aucell--deal">Deal</span>
              <span className="aucell aucell--add">Slip</span>
            </div>
            {groupByPlayer(g.markets).map((it, ri, arr) => {
              const q = it.q;
              const id = `${q.eventId}:${it.marketLabel}:${q.player}:${q.side}:${q.line}`;
              const cont = ri > 0 && arr[ri - 1].q.player === q.player;
              return <AuditRow key={`${id}:${ri}`} q={q} marketLabel={it.marketLabel} game={g.matchup}
                saved={has(id)} cont={cont} onToggle={toggle} />;
            })}
          </div>
        </div>
      </div>
    </details>
  );
}

export default function AuditView({ games, today, tomorrow }: { games: PropGame[]; today: string; tomorrow: string }) {
  const { has, toggle: slipToggle } = useSlip();
  const toggle = useCallback((l: Leg) => slipToggle({
    id: l.id, kind: "prop", title: `${l.player} ${l.bet}`, detail: l.game,
    price: l.best, books: l.books, byBook: l.byBook, fairProb: l.fairProb,
  }), [slipToggle]);

  const audited = games.reduce((n, g) => n + g.markets.reduce((k, m) => k + m.quotes.filter((q) => q.fairProb != null).length, 0), 0);
  const days = groupByGameDay(games, (g) => g.commence, today, tomorrow);

  return (
    <>
      <div className="aulegend" aria-hidden="true">
        <span className="aulegend__i"><span className="aucircle aucircle--value" /> Value — beats fair or the field</span>
        <span className="aulegend__i"><span className="aucircle aucircle--fair" /> Fair — normal price</span>
        <span className="aulegend__i"><span className="aucircle aucircle--cheat" /> Overpriced</span>
      </div>

      {games.length === 0 ? (
        <p className="foot">No prices to audit yet — once this week&apos;s odds are captured, they&apos;ll appear here.</p>
      ) : (
        <section className="audays">
          {days.map((grp, gi) => (
            <div className="auday hb-moretbl" key={grp.key}>
              <DayHeader label={grp.label} tone={grp.tone} count={grp.items.length} />
              {/* Cap the day's cards in place behind the standard control, rather than slicing the
                  list — a slice strands the dropdown mid-board. */}
              <input type="checkbox" id={`ad-${grp.key}`} className="hb-moretbl__chk"
                aria-hidden="true" tabIndex={-1} />
              <div>
                {grp.items.map((g, i) => (
                  <AuditGame key={g.eventId} g={g} open={gi === 0 && i === 0} has={has} toggle={toggle}
                    cls={i >= DAY_CAP ? "hb-row--more" : undefined} />
                ))}
              </div>
              {grp.items.length > DAY_CAP && (
                <label htmlFor={`ad-${grp.key}`} className="hb-moretbl__sum">
                  <span className="hb-more__chev" aria-hidden="true">▸</span>
                  <span className="hb-moretbl__more">Show {grp.items.length - DAY_CAP} more game{grp.items.length - DAY_CAP === 1 ? "" : "s"}</span>
                  <span className="hb-moretbl__less">Show fewer</span>
                </label>
              )}
            </div>
          ))}
        </section>
      )}
    </>
  );
}
