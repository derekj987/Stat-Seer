"use client";

// The single slip bar, rendered globally (in layout) so it follows the member across
// every section. For the priced bets (lines/props) it does the real value math: the best
// book PER LEG (place each straight bet at its own best price) AND — crucially — the one
// book with the best COMBINED price if you want to parlay all the legs on a single ticket
// (which is NOT necessarily the book that's best on the most individual legs).
import { useEffect, useState } from "react";
import { useSlip, encodeSlip, type SlipItem, type SlipKind } from "@/lib/slip";
import { bookName, fmtOdds, toDecimal, decToAmerican, bestParlayBook } from "@/lib/slipPricing";
import { createClient } from "@/lib/supabase/client";

type Me = { id: string; username: string } | null;

const KIND_LABEL: Record<SlipKind, string> = {
  line: "Game Lines", prop: "Player Props", model: "The Model", fan: "Local Intelligence",
};
const ORDER: SlipKind[] = ["line", "prop", "model", "fan"];

export default function SlipBar() {
  const { items, remove, clear } = useSlip();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);
  // Post-to-a-wall state (hooks must run before the early return below).
  const [me, setMe] = useState<Me | undefined>(undefined);
  const [showPost, setShowPost] = useState(false);
  const [target, setTarget] = useState("");
  const [note, setNote] = useState("");
  const [posting, setPosting] = useState(false);
  const [postMsg, setPostMsg] = useState<{ ok: boolean; text: string; href?: string } | null>(null);

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) { setMe(null); return; }
    const sb = createClient();
    sb.auth.getUser().then(async ({ data }) => {
      if (!data.user) { setMe(null); return; }
      const { data: p } = await sb.from("profiles").select("username").eq("id", data.user.id).single();
      setMe({ id: data.user.id, username: (p?.username as string) ?? "" });
    });
  }, []);

  if (!items.length) return null;

  // Legs we can actually shop: those carrying a per-book price map (lines + props).
  const legs = items.filter((i) => i.byBook && Object.keys(i.byBook).length > 0);
  const legBest = (i: SlipItem) => {
    const e = Object.entries(i.byBook!);
    const best = Math.max(...e.map(([, p]) => p));
    return { best, books: e.filter(([, p]) => p === best).map(([b]) => b) };
  };
  // Placing each leg at its OWN best book (straight bets) — the theoretical max combined.
  const bestEach = legs.length ? legs.reduce((acc, i) => acc * toDecimal(legBest(i).best), 1) : 0;
  const parlay = legs.length ? bestParlayBook(legs) : { full: null, partial: null };
  // The single best book to place the whole slip: the one-book parlay winner when a book
  // prices every leg; else the lone leg's best book; else the book covering the most legs.
  const bestBook = parlay.full ? bookName(parlay.full.book)
    : legs.length === 1 ? bookName(legBest(legs[0]).books[0])
    : parlay.partial ? bookName(parlay.partial.book)
    : null;

  const groups = ORDER
    .map((k) => [k, items.filter((i) => i.kind === k)] as const)
    .filter(([, list]) => list.length);

  async function copySlip() {
    const lines = items.map((i) => {
      const lb = i.byBook && Object.keys(i.byBook).length ? legBest(i) : null;
      const price = lb ? lb.best : i.price;
      const books = lb ? lb.books : i.books;
      return `• [${KIND_LABEL[i.kind]}] ${i.title}` +
        (i.detail ? ` — ${i.detail}` : "") +
        (price !== undefined ? `  ${fmtOdds(price)}` : "") +
        (books?.length ? `  (best: ${books.map(bookName).join(" / ")})` : "");
    });
    const footer = parlay.full && legs.length > 1
      ? `\nOne-book parlay: ${bookName(parlay.full.book)} ${decToAmerican(parlay.full.decimal)} on all ${legs.length} legs.`
      : "";
    const text =
      `My StatSeer slip — ${items.length} pick${items.length === 1 ? "" : "s"}\n` +
      `${lines.join("\n")}${footer}\n\nBuild your own at statseer.vercel.app`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked */ }
  }

  // Share a link that re-opens this slip in StatSeer (installed app or browser).
  async function shareSlip() {
    const url = `${location.origin}/slip?d=${encodeSlip(items)}&t=${Date.now()}`;
    const title = `My StatSeer slip — ${items.length} pick${items.length === 1 ? "" : "s"}`;
    if (typeof navigator.share === "function") {
      try { await navigator.share({ title, text: title, url }); return; } catch { /* user cancelled */ }
    }
    try {
      await navigator.clipboard.writeText(url);
      setShared(true);
      setTimeout(() => setShared(false), 2000);
    } catch { /* clipboard blocked */ }
  }

  // Post this slip to a member's profile wall (blank target = your own wall).
  async function postToWall() {
    if (!me) return;
    setPosting(true); setPostMsg(null);
    const sb = createClient();
    let targetId = me.id;
    let uname = me.username;
    const wanted = target.trim();
    if (wanted) {
      const { data, error } = await sb.from("profiles").select("id,username").ilike("username", wanted).limit(1).maybeSingle();
      if (error || !data) { setPosting(false); setPostMsg({ ok: false, text: `No member named “${wanted}.”` }); return; }
      targetId = data.id as string; uname = data.username as string;
    }
    const summary = parlay.full && legs.length > 1
      ? `Shared a ${legs.length}-leg slip — best combined at ${bookName(parlay.full.book)} ${decToAmerican(parlay.full.decimal)}`
      : `Shared a ${items.length}-pick slip`;
    const body = note.trim() || summary;
    const { error } = await sb.from("wall_posts").insert({ profile_id: targetId, author_id: me.id, body, slip: items });
    setPosting(false);
    if (error) { setPostMsg({ ok: false, text: error.message }); return; }
    setNote(""); setTarget("");
    setPostMsg({ ok: true, text: wanted ? `Posted to ${uname}’s wall` : "Posted to your wall", href: `/u/${uname}` });
  }

  return (
    <div className="slipbar">
      <div className={open ? "slipbar__inner is-open" : "slipbar__inner"}>
        <button className="slipbar__summary" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span className="slipbar__count">{items.length}</span>
          <span>Value Finder</span>
          {parlay.full && (
            <span className="slipbar__rec">parlay: <b>{bookName(parlay.full.book)}</b> {decToAmerican(parlay.full.decimal)}</span>
          )}
          <span className="slipbar__chev">{open ? "▾" : "▴"}</span>
        </button>
        {open && (
          <div className="slipbar__panel">
            {groups.map(([kind, list]) => (
              <div key={kind} className="slipgrp">
                <div className="slipgrp__h">{KIND_LABEL[kind]}</div>
                <ul className="slipbar__list">
                  {list.map((i) => {
                    const lb = i.byBook && Object.keys(i.byBook).length ? legBest(i) : null;
                    return (
                      <li key={i.id}>
                        <span className="slipbar__g">{i.title}</span>
                        {i.detail && <span className="slipbar__p">{i.detail}</span>}
                        {lb ? <span className="odds">{fmtOdds(lb.best)}</span>
                            : i.price !== undefined ? <span className="odds">{fmtOdds(i.price)}</span> : null}
                        {lb ? <span className="book">{lb.books.map(bookName).join(" / ")}</span>
                            : i.books?.length ? <span className="book">{i.books.map(bookName).join(" / ")}</span> : null}
                        <button className="slipbar__x" onClick={() => remove(i.id)} title="Remove">×</button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            {legs.length >= 1 && (
              <div className="slipbest">
                <div className="slipbest__h">Best book to place this slip{bestBook && <span className="slipbest__hbook">: {bestBook}</span>}</div>
                <div className="slipbest__row">
                  <span className="slipbest__k">Straight bets</span>
                  <span className="slipbest__v">each leg at its own best book above{legs.length > 1 && <> · all {legs.length} together pay <b>{decToAmerican(bestEach)}</b></>}</span>
                </div>
                {legs.length > 1 && (
                  <div className="slipbest__row">
                    <span className="slipbest__k">One-book parlay</span>
                    <span className="slipbest__v">
                      {parlay.full ? (
                        <>best combined at <b>{bookName(parlay.full.book)}</b> — <b>{decToAmerican(parlay.full.decimal)}</b> on all {legs.length} legs</>
                      ) : parlay.partial ? (
                        <>no single book prices all {legs.length} legs; <b>{bookName(parlay.partial.book)}</b> covers the most ({parlay.partial.covers})</>
                      ) : <>—</>}
                    </span>
                  </div>
                )}
                <p className="slipbest__note">The best <b>parlay</b> book isn&apos;t always the one that&apos;s best on the most legs — this totals every book across all your legs and picks the real winner.</p>
              </div>
            )}
            <p className="slipbar__note">
              Your <b>Value Finder</b> — every pick you collect across the app, priced. Model reads and
              fan buzz are here for reference — <b>not a pick, not graded</b>. Line-shopping only.
            </p>
            <div className="slipbar__actions">
              <button className="slipbar__share" onClick={shareSlip}>{shared ? "Link copied ✓" : "Share slip"}</button>
              <button className="slipbar__copy" onClick={copySlip}>{copied ? "Copied ✓" : "Copy slip"}</button>
              <button className="slipbar__wall" onClick={() => { setShowPost((v) => !v); setPostMsg(null); }} aria-expanded={showPost}>
                {showPost ? "Close" : "Post to a wall"}
              </button>
              <button className="slipbar__clear" onClick={clear}>Clear slip</button>
            </div>
            {showPost && (
              <div className="slippost">
                {me === null ? (
                  <p className="slippost__login"><a href="/login">Log in</a> to post your slip to a wall.</p>
                ) : (
                  <>
                    <p className="slippost__lead">Drop this slip on a member&apos;s profile wall — leave the name blank to post it to <b>your own</b>.</p>
                    <input className="slippost__user" placeholder="member username (blank = your wall)" value={target}
                      onChange={(e) => setTarget(e.target.value)} autoComplete="off" />
                    <textarea className="slippost__note" rows={2} maxLength={280} placeholder="Add a note (optional)…"
                      value={note} onChange={(e) => setNote(e.target.value)} />
                    <div className="slippost__row">
                      <button className="slippost__go" onClick={postToWall} disabled={posting || me === undefined}>
                        {posting ? "Posting…" : "Post slip"}
                      </button>
                    </div>
                  </>
                )}
                {postMsg && (
                  <p className={postMsg.ok ? "slippost__ok" : "slippost__err"}>
                    {postMsg.text}{postMsg.ok && postMsg.href && <> — <a href={postMsg.href}>view →</a></>}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
