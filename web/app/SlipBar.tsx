"use client";

// The single slip bar, rendered globally (in layout) so it follows the member across
// every section. For the priced bets (lines/props) it does the real value math: the best
// book PER LEG (place each straight bet at its own best price) AND — crucially — the one
// book with the best COMBINED price if you want to parlay all the legs on a single ticket
// (which is NOT necessarily the book that's best on the most individual legs).
import { useEffect, useState } from "react";
import { useSlip, encodeSlip, type SlipItem, type SlipKind } from "@/lib/slip";
import { bookName, fmtOdds, toDecimal, decToAmerican, bestParlayBook, priceSlip } from "@/lib/slipPricing";
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
  // Share-to-a-friend state. Both "Send through Messenger" (a direct message) and
  // "Post to a wall" (a wall post) use the SAME friend picker. Hooks must run before the
  // early return below.
  const [me, setMe] = useState<Me | undefined>(undefined);
  const [picker, setPicker] = useState<null | "wall" | "msg">(null);
  const [friends, setFriends] = useState<{ id: string; username: string }[] | null>(null);
  const [convs, setConvs] = useState<{ id: string; name: string }[] | null>(null);
  const [sendingTo, setSendingTo] = useState<string | null>(null);
  const [done, setDone] = useState<{ text: string; href?: string } | null>(null);
  const [storyMsg, setStoryMsg] = useState("");
  const [stake, setStake] = useState(25); // wager for the "to win" calculator

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

  // "To win" calculator: books that price the WHOLE slip, best combined first. Payout on
  // the best book vs how many more dollars it wins than the next-best book.
  const { ranked } = priceSlip(items);
  const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const winMore = ranked.length >= 2 ? stake * (ranked[0].decimal - ranked[1].decimal) : 0;

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

  // Open a picker: "wall" = post to a friend's wall (loads friends), "msg" = drop the slip
  // into one of your existing CHATS (loads conversations, so you pick a chat instead of
  // spawning a new DM each time). Lazily loaded the first time each picker opens.
  async function openPicker(mode: "wall" | "msg") {
    setPicker((cur) => (cur === mode ? null : mode));
    setDone(null);
    if (!me) return;
    const sb = createClient();
    if (mode === "wall") {
      if (friends !== null) return;
      const { data: rows } = await sb.from("friendships")
        .select("requester_id,addressee_id").eq("status", "accepted")
        .or(`requester_id.eq.${me.id},addressee_id.eq.${me.id}`);
      const otherIds = (rows ?? []).map((r) => (r.requester_id === me.id ? r.addressee_id : r.requester_id) as string);
      if (!otherIds.length) { setFriends([]); return; }
      const { data: profs } = await sb.from("profiles").select("id,username").in("id", otherIds);
      const nameById = new Map((profs ?? []).map((p) => [p.id as string, p.username as string]));
      setFriends(otherIds.map((id) => ({ id, username: nameById.get(id) ?? "member" })));
      return;
    }
    // mode === "msg": load my conversations, with a display name.
    if (convs !== null) return;
    const { data: mem } = await sb.from("conversation_members").select("conversation_id").eq("user_id", me.id);
    const ids = (mem ?? []).map((m) => m.conversation_id as string);
    if (!ids.length) { setConvs([]); return; }
    const [{ data: cs }, { data: allMem }] = await Promise.all([
      sb.from("conversations").select("id,title,is_group,last_message_at").in("id", ids),
      sb.from("conversation_members").select("conversation_id,user_id").in("conversation_id", ids),
    ]);
    const uids = [...new Set((allMem ?? []).map((m) => m.user_id as string))].filter((u) => u !== me.id);
    const nameById = new Map<string, string>();
    if (uids.length) {
      const { data: profs } = await sb.from("profiles").select("id,username").in("id", uids);
      for (const p of profs ?? []) nameById.set(p.id as string, p.username as string);
    }
    const others = new Map<string, string[]>();
    for (const m of allMem ?? []) {
      if ((m.user_id as string) === me.id) continue;
      const arr = others.get(m.conversation_id as string) ?? [];
      arr.push(nameById.get(m.user_id as string) ?? "member");
      others.set(m.conversation_id as string, arr);
    }
    const list = (cs ?? [])
      .sort((a, b) => ((b.last_message_at as string) ?? "").localeCompare((a.last_message_at as string) ?? ""))
      .map((c) => ({
        id: c.id as string,
        name: (c.title as string) || (others.get(c.id as string) ?? []).join(", ") || "Chat",
      }));
    setConvs(list);
  }

  // Share the current slip to your own "story" (shows as a circle on your profile + friends'
  // for 24h). Your own story, so no picker — one tap.
  async function postStory() {
    if (!me) { setStoryMsg("Log in to post a story."); return; }
    setStoryMsg("Posting…");
    const { error } = await createClient().from("stories").insert({ user_id: me.id, slip: items });
    setStoryMsg(error ? "Couldn't post — try again." : "On your story ✓ (24h)");
  }

  // Send the current slip to a chosen chat, or post it to a friend's wall.
  async function sendSlip(mode: "wall" | "msg", to: { id: string; username: string }) {
    if (!me) return;
    setSendingTo(to.id);
    const sb = createClient();
    if (mode === "msg") {
      const { error } = await sb.from("conversation_messages")
        .insert({ conversation_id: to.id, sender_id: me.id, kind: "slip", slip: items });
      if (!error) sb.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", to.id).then(() => {});
      setSendingTo(null);
      if (!error) setDone({ text: `Sent to ${to.username} — open 💬 chat to see it.` });
    } else {
      const summary = parlay.full && legs.length > 1
        ? `Shared a ${legs.length}-leg slip — best at ${bookName(parlay.full.book)} ${decToAmerican(parlay.full.decimal)}`
        : `Shared a ${items.length}-pick slip`;
      const { error } = await sb.from("wall_posts").insert({ profile_id: to.id, author_id: me.id, body: summary, slip: items });
      setSendingTo(null);
      if (!error) setDone({ text: `Posted to ${to.username === me.username ? "your" : `${to.username}’s`} wall`, href: `/u/${to.username}` });
    }
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
            {ranked.length > 0 && (
              <div className="slipwin">
                <label className="slipwin__wager">Wager
                  <span className="slipwin__inwrap">$<input type="number" min={0} max={100000} value={stake} className="slipwin__in"
                    onChange={(e) => setStake(Math.max(0, Math.min(100000, Number(e.target.value) || 0)))} /></span>
                </label>
                <div className="slipwin__out">
                  <span className="slipwin__towin">To win <b>${money(stake * (ranked[0].decimal - 1))}</b></span>
                  <span className="slipwin__at">at {bookName(ranked[0].book)} <span className="slipwin__odds">({decToAmerican(ranked[0].decimal)})</span></span>
                </div>
                {winMore > 0.005 && (
                  <p className="slipwin__more">
                    You could win <b>${money(winMore)}</b> more by placing it at <b>{bookName(ranked[0].book)}</b> than at {bookName(ranked[1].book)}.
                  </p>
                )}
              </div>
            )}
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
              <button className="slipbar__msg" onClick={() => openPicker("msg")} aria-expanded={picker === "msg"}>
                {picker === "msg" ? "Close" : "Send to a chat"}
              </button>
              <button className="slipbar__wall" onClick={() => openPicker("wall")} aria-expanded={picker === "wall"}>
                {picker === "wall" ? "Close" : "Post to a wall"}
              </button>
              <button className="slipbar__story" onClick={postStory} title="Share this slip to your story for 24h">
                {storyMsg || "Post to story"}
              </button>
              <button className="slipbar__clear" onClick={clear}>Clear slip</button>
            </div>
            {picker && (
              <div className="slippost">
                {!me ? (
                  <p className="slippost__login"><a href="/login">Log in</a> to {picker === "msg" ? "send this slip to a chat" : "post this slip to a friend’s wall"}.</p>
                ) : done ? (
                  <p className="slippost__ok">{done.text}{done.href && <> — <a href={done.href}>view →</a></>}</p>
                ) : (picker === "msg" ? convs === null : friends === null) ? (
                  <p className="slippost__lead">{picker === "msg" ? "Loading your chats…" : "Loading your friends…"}</p>
                ) : picker === "msg" ? (
                  <>
                    <p className="slippost__lead">Send this {items.length}-pick slip to a chat — pick which:</p>
                    <div className="slipfriends">
                      {(convs ?? []).map((c) => (
                        <button key={c.id} className="slipfriend" onClick={() => sendSlip("msg", { id: c.id, username: c.name })} disabled={sendingTo === c.id}>
                          <span className="slipfriend__av" aria-hidden="true">💬</span>
                          <span className="slipfriend__name">{c.name}</span>
                          <span className="slipfriend__send">{sendingTo === c.id ? "Sending…" : "Send →"}</span>
                        </button>
                      ))}
                    </div>
                    {(convs ?? []).length === 0 && (
                      <p className="slippost__lead">No chats yet — start one from the <b>💬 chat</b> panel (bottom-right), then send here.</p>
                    )}
                  </>
                ) : (
                  <>
                    <p className="slippost__lead">Post this {items.length}-pick slip to a wall — pick who:</p>
                    <div className="slipfriends">
                      <button className="slipfriend" onClick={() => sendSlip("wall", { id: me.id, username: me.username })} disabled={sendingTo === me.id}>
                        <span className="slipfriend__av" aria-hidden="true">★</span>
                        <span className="slipfriend__name">Your wall</span>
                        <span className="slipfriend__send">{sendingTo === me.id ? "Posting…" : "Post →"}</span>
                      </button>
                      {(friends ?? []).map((f) => (
                        <button key={f.id} className="slipfriend" onClick={() => sendSlip("wall", f)} disabled={sendingTo === f.id}>
                          <span className="slipfriend__av" aria-hidden="true">{f.username.charAt(0).toUpperCase()}</span>
                          <span className="slipfriend__name">{f.username}</span>
                          <span className="slipfriend__send">{sendingTo === f.id ? "Posting…" : "Post →"}</span>
                        </button>
                      ))}
                    </div>
                    {(friends ?? []).length === 0 && (
                      <p className="slippost__lead">No friends yet — post to <b>Your wall</b> above, or add friends from the <b>💬 chat</b> panel.</p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
