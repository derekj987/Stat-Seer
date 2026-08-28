"use client";
import { useEffect, useState } from "react";

// A rotating "highlight the site" banner — spotlights sections that don't get their own
// snapshot on the homepage. Chaos Board leads, then each player-prop analysis. Auto-advances,
// pauses on hover, dots to jump. Client-only; links are plain <a> so navigation is normal.
type Sport = "nfl" | "ncaaf";
interface Slide { emoji: string; kicker: string; title: string; blurb: string; path: string; img?: string; }

function slides(sport: Sport): Slide[] {
  const ctx = sport === "ncaaf" ? "/ncaaf/context" : "/context";
  const players = sport === "ncaaf" ? "/ncaaf/model/players" : "/model/players";
  const best = sport === "ncaaf" ? "/ncaaf/best" : "/best";
  return [
    { emoji: "🌪", kicker: "New · just for fun", title: "The Upset Lab — Chaos Board",
      blurb: "Which underdogs could win outright, ranked by pure chaos potential — for the aggressive bettor.",
      path: ctx, img: "/chaosboard.png" },
    { emoji: "🎯", kicker: "Player Model", title: "Passing yards & TDs",
      blurb: "Every QB's book line beside our line-blind projection, with the prior-season hit rate.", path: `${players}?cat=passing` },
    { emoji: "🏈", kicker: "Player Model", title: "Rushing yards",
      blurb: "Volume-first RB reads — projected carries × a regressed efficiency baseline.", path: `${players}?cat=rushing` },
    { emoji: "🙌", kicker: "Player Model", title: "Receiving yards",
      blurb: "Target share → catches → yards, projected line-blind for every pass-catcher.", path: `${players}?cat=receiving` },
    { emoji: "🧤", kicker: "Player Model", title: "Receptions",
      blurb: "How many balls each player hauls in vs the book's number — the market's most-bet prop.", path: `${players}?cat=receptions` },
    { emoji: "💥", kicker: "Player Model", title: "Anytime touchdowns",
      blurb: "A Poisson TD probability from projected touches, next to the book's price.", path: `${players}?cat=td` },
    { emoji: "💰", kicker: "Value Finder", title: "The single best price",
      blurb: "We shop every book so you never leave value on the table on a pick you already like.", path: best },
  ];
}

export function HighlightBanner({ sport }: { sport: Sport }) {
  const list = slides(sport);
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => setI((x) => (x + 1) % list.length), 5000);
    return () => clearInterval(t);
  }, [paused, list.length]);

  const s = list[i];
  return (
    <div
      className="hlb"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      aria-label="Explore the site"
    >
      <a className={s.img ? "hlb__slide hlb__slide--img" : "hlb__slide"} href={s.path} key={i}>
        {s.img
          // eslint-disable-next-line @next/next/no-img-element
          ? <img className="hlb__img" src={s.img} alt="" />
          : <span className="hlb__emoji" aria-hidden="true">{s.emoji}</span>}
        <span className="hlb__body">
          <span className="hlb__kicker">{s.kicker}</span>
          <span className="hlb__title">{s.title}</span>
          <span className="hlb__blurb">{s.blurb}</span>
        </span>
        <span className="hlb__go" aria-hidden="true">→</span>
      </a>
      <div className="hlb__dots" role="tablist" aria-label="Highlights">
        {list.map((_, k) => (
          <button
            key={k}
            type="button"
            className={k === i ? "hlb__dot active" : "hlb__dot"}
            aria-label={`Show highlight ${k + 1} of ${list.length}`}
            aria-selected={k === i}
            onClick={() => setI(k)}
          />
        ))}
      </div>
    </div>
  );
}
