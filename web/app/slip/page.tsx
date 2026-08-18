"use client";

// Landing page for a shared slip link (/slip?d=…). Decodes the picks, shows them,
// lets the recipient drop them onto their own slip, and — if they haven't installed
// StatSeer — prompts them to add it to their home screen.
import { useEffect, useState } from "react";
import { useSlip, decodeSlip, type SlipItem, type SlipKind } from "@/lib/slip";

const fmtOdds = (p?: number) => (p === undefined ? "" : p > 0 ? `+${p}` : String(p));
const KIND_LABEL: Record<SlipKind, string> = {
  line: "Game Lines", prop: "Player Props", model: "The Model", fan: "Fan Analysis",
};

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export default function SharedSlip() {
  const { addMany } = useSlip();
  const [items, setItems] = useState<SlipItem[] | null>(null);
  const [added, setAdded] = useState(false);
  const [standalone, setStandalone] = useState(true); // assume installed until we check (avoids a flash)
  const [ios, setIos] = useState(false);

  useEffect(() => {
    const d = new URLSearchParams(window.location.search).get("d");
    setItems(d ? decodeSlip(d) : []);
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

  return (
    <main className="wrap sharepage">
      <div className="sharehero">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-mark.png?v=3" alt="" className="sharehero__logo" width={52} height={52} />
        <div>
          <h1 className="sharehero__h">A StatSeer slip was shared with you</h1>
          <p className="sharehero__p">
            {items.length} pick{items.length === 1 ? "" : "s"}. Add them to your own slip and StatSeer will find
            the best sportsbook for each.
          </p>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="foot">This share link is empty or invalid. Ask for a fresh link, or
          <a href="/lines"> start your own slip →</a></p>
      ) : (
        <>
          <ul className="shareslip">
            {items.map((i) => (
              <li className="shareslip__i" key={i.id}>
                <span className="shareslip__kind">{KIND_LABEL[i.kind]}</span>
                <span className="shareslip__t">{i.title}</span>
                {i.detail && <span className="shareslip__d">{i.detail}</span>}
                <span className="shareslip__meta">
                  {i.price !== undefined && <span className="odds">{fmtOdds(i.price)}</span>}
                  {i.books?.length ? <span className="book">{i.books.join(" / ")}</span> : null}
                </span>
              </li>
            ))}
          </ul>

          <div className="shareact">
            {added ? (
              <a href="/lines" className="btn btn--primary">Added ✓ — open your slip →</a>
            ) : (
              <button className="btn btn--primary" onClick={addToMine}>Add these to my slip</button>
            )}
            <a href="/" className="btn">Explore StatSeer →</a>
          </div>

          {!standalone && (
            <div className="installcard">
              <span className="installcard__h">📲 Get StatSeer on your home screen</span>
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
