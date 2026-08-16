"use client";

import { useEffect, useState, useCallback } from "react";
import type { PropGame, Quote } from "@/lib/props";
import { SlipCallout } from "../Nav";

const fmtOdds = (p: number) => (p > 0 ? `+${p}` : String(p));
function sideLabel(side: string, line: number | null): string {
  if (side === "Yes") return "";
  if (side === "No") return "No";
  return line !== null ? `${side[0]} ${line}` : side;
}
const decimal = (a: number) => (a > 0 ? a / 100 + 1 : 100 / -a + 1);
const toAmerican = (d: number) => (d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1)));

interface Leg {
  id: string;
  game: string;
  player: string;
  bet: string; // e.g. "ATTD" / "O 249.5"
  best: number;
  byBook: Record<string, number>;
}
const KEY = "statseer.parlay.v1";

/** Best single book for the parlay: a parlay must sit at one book, so we take the
 * product of that book's prices — only books that price every leg qualify. */
function bestParlay(legs: Leg[]): { book: string; dec: number; american: number } | null {
  if (!legs.length) return null;
  const books = [...new Set(legs.flatMap((l) => Object.keys(l.byBook)))];
  let best: { book: string; dec: number } | null = null;
  for (const b of books) {
    if (!legs.every((l) => b in l.byBook)) continue;
    const dec = legs.reduce((d, l) => d * decimal(l.byBook[b]), 1);
    if (!best || dec > best.dec) best = { book: b, dec };
  }
  return best ? { ...best, american: toAmerican(best.dec) } : null;
}

function PropChip({ q, market, marketLabel, game, saved, onToggle }: {
  q: Quote; market: string; marketLabel: string; game: string; saved: boolean; onToggle: (l: Leg) => void;
}) {
  const bet = marketLabel === "ATTD" ? "ATTD" : sideLabel(q.side, q.line) || q.side;
  const leg: Leg = {
    id: `${q.eventId}:${market}:${q.player}:${q.side}:${q.line}`,
    game, player: q.player, bet, best: q.price, byBook: q.byBook,
  };
  return (
    <button
      type="button"
      onClick={() => onToggle(leg)}
      className={`propq savable${saved ? " saved" : ""}`}
      aria-pressed={saved}
      title={saved ? "Remove from parlay" : "Add to parlay"}
    >
      <span className="propq__player">{q.player}</span>
      <span className="propq__side">{sideLabel(q.side, q.line)}</span>
      <span className="propq__price">{fmtOdds(q.price)}</span>
      <span className="propq__book">{q.books.join(" / ")}</span>
      <span className="propq__heart" aria-hidden="true">{saved ? "♥" : "♡"}</span>
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

function ParlayBar({ legs, onRemove, onClear }: {
  legs: Leg[]; onRemove: (id: string) => void; onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [stake, setStake] = useState(10);
  useEffect(() => {
    const s = Number(localStorage.getItem("statseer.stake"));
    if (s > 0) setStake(s);
  }, []);
  useEffect(() => {
    try { localStorage.setItem("statseer.stake", String(stake)); } catch { /* ignore */ }
  }, [stake]);

  if (!legs.length) return null;
  const par = bestParlay(legs);
  const payout = par ? stake * par.dec : 0;
  const profit = par ? stake * (par.dec - 1) : 0;

  async function copySlip() {
    const lines = legs.map((l) => `• ${l.game} — ${l.player} ${l.bet}  ${fmtOdds(l.best)}`);
    const parLine = par
      ? `Best parlay: ${fmtOdds(par.american)} at ${par.book} · $${stake.toFixed(0)} → $${payout.toFixed(2)}`
      : `No single book prices all ${legs.length} legs.`;
    const text =
      `My StatSeer prop parlay — ${legs.length} leg${legs.length === 1 ? "" : "s"}\n` +
      `${lines.join("\n")}\n\n${parLine}\nBuild your own at statseer.vercel.app`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  }

  return (
    <div className="slipbar">
      <div className="slipbar__inner">
        <button className="slipbar__summary" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span className="slipbar__count">{legs.length}</span>
          <span>leg{legs.length === 1 ? "" : "s"}</span>
          <span className="slipbar__rec">
            {par
              ? <>parlay <b>{fmtOdds(par.american)}</b> at {par.book} · ${stake.toFixed(0)}→<b>${payout.toFixed(2)}</b></>
              : <>no single book prices all legs</>}
          </span>
          <span className="slipbar__chev">{open ? "▾" : "▴"}</span>
        </button>
        {open && (
          <div className="slipbar__panel">
            <ul className="slipbar__list">
              {legs.map((l) => (
                <li key={l.id}>
                  <span className="slipbar__g">{l.game}</span>
                  <span className="slipbar__p">{l.player} · {l.bet}</span>
                  <span className="odds">{fmtOdds(l.best)}</span>
                  <button className="slipbar__x" onClick={() => onRemove(l.id)} title="Remove">×</button>
                </li>
              ))}
            </ul>
            {par ? (
              <>
                <div className="stakebox">
                  <label className="stakebox__label">Stake
                    <span className="stakebox__field">
                      <span aria-hidden="true">$</span>
                      <input type="number" min={0} step={1} value={stake}
                        onChange={(e) => setStake(Math.max(0, Number(e.target.value) || 0))}
                        className="stakebox__input" inputMode="decimal" aria-label="Stake amount" />
                    </span>
                  </label>
                  <span className="stakebox__payout">
                    pays <b>${payout.toFixed(2)}</b> at {par.book} <span className="stakebox__profit">(profit ${profit.toFixed(2)})</span>
                  </span>
                </div>
                <p className="slipbar__note">
                  Best combined price <b>{fmtOdds(par.american)}</b> on all {legs.length} legs — a parlay must sit at
                  one book. <b>Line-shopping only, not a pick</b>: parlays compound the vig, so even the best-priced
                  one is usually −EV unless the legs are correlated.
                </p>
              </>
            ) : (
              <p className="slipbar__note">
                No single book prices all {legs.length} of your legs, so this parlay can&apos;t be placed as one.
                Drop a leg, or wait for more books to post these markets.
              </p>
            )}
            <div className="slipbar__actions">
              <button className="slipbar__copy" onClick={copySlip}>{copied ? "Copied ✓" : "Copy slip"}</button>
              <button className="slipbar__clear" onClick={onClear}>Clear</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function PropsView({ games }: { games: PropGame[] }) {
  const [legs, setLegs] = useState<Leg[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setLegs(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(legs)); } catch { /* ignore */ }
  }, [legs]);

  const has = useCallback((id: string) => legs.some((l) => l.id === id), [legs]);
  const toggle = useCallback((l: Leg) =>
    setLegs((prev) => (prev.some((x) => x.id === l.id) ? prev.filter((x) => x.id !== l.id) : [...prev, l])), []);
  const remove = useCallback((id: string) => setLegs((prev) => prev.filter((x) => x.id !== id)), []);
  const clear = useCallback(() => setLegs([]), []);

  const players = games.reduce(
    (n, g) => n + new Set(g.markets.flatMap((m) => m.quotes.map((q) => q.player))).size, 0
  );

  return (
    <>
      <details className="readbox">
        <summary className="readbox__h">What am I seeing here?</summary>
        <p>
          Every player prop with the <b>best available price across all books</b>. Tap a prop to add it to your
          slip — StatSeer routes each leg to its best book and finds the single best book for a <b>parlay</b>.
          No model, no pick: props are where pricing edges most plausibly live, because books post hundreds of
          them semi-independently.
        </p>
      </details>
      <SlipCallout kind="props" />
      <p className="hint">{games.length} games · {players} players · best price on each, shopped across books.</p>
      <section className="propstack">
        {games.map((g) => (
          <PropGameCard key={g.eventId} g={g} has={has} toggle={toggle} />
        ))}
      </section>
      <footer className="foot">
        <p><b>No model. No pick.</b> Just the best available price on each player prop across books — where props
        edge most plausibly lives, since books price hundreds of them semi-independently. Projections (is the line
        beatable?) come later. Prices move; updates as new odds are captured.</p>
      </footer>
      <ParlayBar legs={legs} onRemove={remove} onClear={clear} />
    </>
  );
}
