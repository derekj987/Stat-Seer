"use client";
import { useEffect, useState } from "react";

// A rotating "highlight the site" banner — spotlights sections that don't get their own
// snapshot on the homepage. Chaos Board leads, then each player-prop analysis. Auto-advances,
// pauses on hover, dots to jump. Client-only; links are plain <a> so navigation is normal.
type Sport = "nfl" | "ncaaf";
interface Slide { emoji: string; kicker: string; title: string; blurb: string; path: string; img?: string; focus?: string; }

function slides(sport: Sport): Slide[] {
  const ctx = sport === "ncaaf" ? "/ncaaf/context" : "/context";
  const players = sport === "ncaaf" ? "/ncaaf/model/players" : "/model/players";
  const value = sport === "ncaaf" ? "/ncaaf/lines" : "/lines";
  const fan = sport === "ncaaf" ? "/ncaaf/local-intelligence" : "/local-intelligence";
  const model = sport === "ncaaf" ? "/ncaaf/model" : "/model";
  return [
    { emoji: "🌪", kicker: "New · just for fun", title: "The Upset Lab — Chaos Board",
      blurb: "Which underdogs could win outright, ranked by pure chaos potential — for the aggressive bettor.",
      path: ctx, img: "/chaosboard.jpg?v=8" },
    { emoji: "👑", kicker: "The Model", title: "Our line vs the market, graded",
      blurb: "Line-blind predictions, published and locked pre-kickoff, with a calibration record anyone can check.",
      path: model, img: "/model.jpg?v=7" },
    { emoji: "🎯", kicker: "Player Props", title: "Every prop, our line vs the book",
      blurb: "Passing, rushing, receiving, receptions & anytime TD — each player's book number beside our line-blind projection.",
      path: players, img: "/playerprops.jpg?v=9" },
    { emoji: "📣", kicker: "Local Intelligence", title: "What the fan boards are buzzing",
      blurb: "We scour team forums, beat writers & RSS for players you haven't heard about — then hand you the bottom line.",
      path: fan, img: "/localintel.jpg?v=9" },
    { emoji: "💰", kicker: "Value Finder", title: "Find the best price",
      blurb: "We shop every book so you never leave value on the table — line shopping, sweet spots & the single best number.",
      path: value, img: "/valuefinder.jpg?v=9" },
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
  const go = (delta: number) => setI((x) => (x + delta + list.length) % list.length);
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
          ? <img className="hlb__img" src={s.img} alt="" style={s.focus ? { objectPosition: s.focus } : undefined} />
          : <span className="hlb__emoji" aria-hidden="true">{s.emoji}</span>}
        <span className="hlb__body">
          <span className="hlb__kicker">{s.kicker}</span>
          <span className="hlb__title">{s.title}</span>
          <span className="hlb__blurb">{s.blurb}</span>
        </span>
        <span className="hlb__go" aria-hidden="true">→</span>
      </a>
      <div className="hlb__dots" role="tablist" aria-label="Highlights">
        <button type="button" className="hlb__nav" aria-label="Previous highlight" onClick={() => go(-1)}>‹</button>
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
        <button type="button" className="hlb__nav" aria-label="Next highlight" onClick={() => go(1)}>›</button>
      </div>
    </div>
  );
}
