"use client";

// Public landing page for a shared slip link (/slip?d=…). Decodes the snapshot, shows every
// pick with its best price, the single sportsbook that pays the most on the whole parlay, a
// "copy to my slip" action, and a clear "member content, not a StatSeer pick" disclaimer.
import { useEffect, useState } from "react";
import { useSlip, decodeSlip, type SlipItem, type SlipKind } from "@/lib/slip";
import { bookName, fmtOdds, legBest, priceSlip, decToAmerican } from "@/lib/slipPricing";

const KIND_LABEL: Record<SlipKind, string> = {
  line: "Game Lines", prop: "Player Props", model: "The Model", fan: "Local Intelligence",
};

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function timeAgo(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 90) return "moments ago";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

export default function SharedSlip() {
  const { addMany } = useSlip();
  const [items, setItems] = useState<SlipItem[] | null>(null);
  const [added, setAdded] = useState(false);
  const [standalone, setStandalone] = useState(true); // assume installed until we check (avoids a flash)
  const [ios, setIos] = useState(false);
  const [stake, setStake] = useState(50);
  const [ago, setAgo] = useState<string | null>(null);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const d = p.get("d") || p.get("s"); // accept either param name
    setItems(d ? decodeSlip(d) : []);
    const t = Number(p.get("t"));
    if (t > 0) setAgo(timeAgo(t));
    const inApp = window.matchMedia?.("(display-mode: standalone)").matches
      || (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setStandalone(!!inApp);
    setIos(isIOS());
  }, []);

  function addToMine() {
    if (items?.length) { addMany(items); setAdded(true); }
  }

  if (items === null) {
    return <main className="wrap"><p className="foot">Loading shared slip…</p></main>;
  }

  const { legs, ranked, oneBook } = items.length
    ? priceSlip(items)
    : { legs: [] as SlipItem[], ranked: [] as { book: string; decimal: number; covers: number }[], oneBook: null };
  const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const found = ranked.length >= 2 ? stake * (ranked[0].decimal - ranked[1].decimal) : 0;

  return (
    <main className="wrap sharepage">
      <div className="sharehero">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-mark.png?v=5" alt="" className="sharehero__logo" width={52} height={52} />
        <div>
          <h1 className="sharehero__h">A betslip was shared with you</h1>
          <p className="sharehero__p">
            {items.length} pick{items.length === 1 ? "" : "s"} — StatSeer priced every one and found the
            sportsbook that pays the most.
          </p>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="foot">This share link is empty or invalid. Ask for a fresh link, or
          <a href="/lines"> start your own slip →</a></p>
      ) : (
        <>
          <ul className="shareslip">
            {items.map((i) => {
              const lb = i.byBook && Object.keys(i.byBook).length ? legBest(i) : null;
              const price = lb ? lb.best : i.price;
              const books = lb ? lb.books : i.books;
              return (
                <li className="shareslip__i" key={i.id}>
                  <span className="shareslip__kind">{KIND_LABEL[i.kind]}</span>
                  <span className="shareslip__t">{i.title}</span>
                  {i.detail && <span className="shareslip__d">{i.detail}</span>}
                  <span className="shareslip__meta">
                    {price !== undefined && <span className="odds">{fmtOdds(price)}</span>}
                    {books?.length ? <span className="book">best: {books.map(bookName).join(" / ")}</span> : null}
                  </span>
                </li>
              );
            })}
          </ul>

          {oneBook && legs.length > 1 && (
            <div className="sharebest">
              <span className="sharebest__lab">Best book for the whole {oneBook.covers}-leg parlay</span>
              <div className="sharebest__big">
                <b className="sharebest__book">{bookName(oneBook.book)}</b>
                <span className="sharebest__odds">{decToAmerican(oneBook.decimal)}</span>
              </div>

              {/* Lead with the dollars — far more persuasive than american odds. */}
              <div className="sharestake">
                <label className="sharestake__l">
                  Stake
                  <span className="sharestake__wrap">
                    $<input type="number" min={1} max={100000} value={stake} className="sharestake__in"
                      onChange={(e) => setStake(Math.max(0, Math.min(100000, Number(e.target.value) || 0)))} />
                  </span>
                </label>
                <div className="sharestake__out">
                  <span className="sharestake__pays">pays <b>${money(stake * oneBook.decimal)}</b></span>
                  {found > 0 && (
                    <span className="sharestake__found">StatSeer found <b>${money(found)}</b> more than {bookName(ranked[1].book)}</span>
                  )}
                </div>
              </div>

              {ranked.length > 1 && (
                <ol className="sharerank">
                  {ranked.slice(0, 3).map((r, i) => (
                    <li className={i === 0 ? "sharerank__i active" : "sharerank__i"} key={r.book}>
                      <span className="sharerank__n">{i + 1}</span>
                      <span className="sharerank__book">{bookName(r.book)}</span>
                      <span className="sharerank__odds">{decToAmerican(r.decimal)}</span>
                      <span className="sharerank__pay">${money(stake * r.decimal)}</span>
                    </li>
                  ))}
                </ol>
              )}

              <p className="sharebest__note">
                The single sportsbook that pays the most on this exact parlay — StatSeer checked ~10 books.
                {oneBook.covers < legs.length ? ` It prices ${oneBook.covers} of ${legs.length} legs.` : ""}
              </p>
            </div>
          )}

          <div className="shareact">
            {added ? (
              <a href="/lines" className="btn btn--primary">Added ✓ — open your slip →</a>
            ) : (
              <button className="btn btn--primary" onClick={addToMine}>Copy to my slip</button>
            )}
            <a href="/" className="btn">Explore StatSeer →</a>
          </div>

          <p className="sharedisc">
            Shared by a StatSeer member — <b>not a StatSeer pick</b> and not betting advice. Odds were captured{" "}
            <b>{ago ?? "when the slip was shared"}</b> and may have moved; always confirm the price at the
            sportsbook. Do your own research.
          </p>

          {!standalone && (
            <div className="installcard">
              <span className="installcard__h">Get StatSeer on your home screen</span>
              <p>
                StatSeer runs like an app — free, no app store. Install it so shared slips open right in the app:
              </p>
              {ios ? (
                <p className="installcard__how">
                  Tap the <b>Share</b> icon in Safari, then <b>Add to Home Screen</b>.
                </p>
              ) : (
                <p className="installcard__how">
                  Open your browser menu (⋮) and tap <b>Install app</b> / <b>Add to Home screen</b>.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </main>
  );
}
