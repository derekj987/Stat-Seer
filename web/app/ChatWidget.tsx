"use client";

// Minimized member-to-member chat, mounted globally. A launcher bubble (bottom-right)
// with an unread badge; opening it shows your friends list (and any incoming friend
// requests to accept) and, when you pick a friend, the conversation. You can send text
// and your current Value Finder slip. New messages arrive live via Supabase Realtime;
// only accepted friends can message each other (enforced by RLS, not just here).
// Members only — renders nothing for guests or when Supabase isn't configured.
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useSlip, encodeSlip, type SlipItem } from "@/lib/slip";
import { bookName, decToAmerican, priceSlip } from "@/lib/slipPricing";

type Me = { id: string; username: string };
type Friend = { id: string; username: string; role: string; rowId: string };
type Req = { rowId: string; id: string; username: string };
type Msg = { id: string; sender_id: string; recipient_id: string; body: string | null; slip: SlipItem[] | null; created_at: string };

const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

function MsgSlip({ items }: { items: SlipItem[] }) {
  const { addMany } = useSlip();
  const { legs, oneBook } = priceSlip(items);
  return (
    <div className="cw-slip">
      <div className="cw-slip__hd"><b>Slip</b> · {items.length} pick{items.length === 1 ? "" : "s"}</div>
      {oneBook && legs.length > 1 && (
        <div className="cw-slip__best">{bookName(oneBook.book)} <b>{decToAmerican(oneBook.decimal)}</b> for all {oneBook.covers}</div>
      )}
      <div className="cw-slip__act">
        <a href={`/slip?d=${encodeSlip(items)}`} className="cw-slip__view">View →</a>
        <button type="button" className="cw-slip__copy" onClick={() => addMany(items)}>Copy</button>
      </div>
    </div>
  );
}

// The launcher lives in the shared Dock now; this renders just the chat panel, opened/
// closed by the Dock. It reports member status + unread count up via onMeta so the Dock
// can show the Friends icon and its badge even while the panel is closed.
export default function ChatWidget({ open, onClose, onMeta }:
  { open: boolean; onClose: () => void; onMeta: (m: { member: boolean; unread: number }) => void }) {
  const { items: mySlip } = useSlip();
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [requests, setRequests] = useState<Req[]>([]);
  const [suggested, setSuggested] = useState<{ id: string; username: string; role: string; mutual: number }[]>([]);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [active, setActive] = useState<Friend | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const activeRef = useRef<Friend | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  activeRef.current = active;

  const configured = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Who am I?
  useEffect(() => {
    if (!configured) { setMe(null); return; }
    const sb = createClient();
    sb.auth.getUser().then(async ({ data }) => {
      if (!data.user) { setMe(null); return; }
      const { data: p } = await sb.from("profiles").select("username").eq("id", data.user.id).single();
      setMe({ id: data.user.id, username: (p?.username as string) ?? "member" });
    });
  }, [configured]);

  const loadFriends = useCallback(async (meId: string) => {
    const sb = createClient();
    const { data: rows } = await sb.from("friendships")
      .select("id,requester_id,addressee_id,status")
      .or(`requester_id.eq.${meId},addressee_id.eq.${meId}`);
    const list = rows ?? [];
    const friendIds: { otherId: string; rowId: string }[] = [];
    const reqRows: { rowId: string; id: string }[] = [];
    for (const r of list) {
      const other = r.requester_id === meId ? r.addressee_id : r.requester_id;
      if (r.status === "accepted") friendIds.push({ otherId: other as string, rowId: r.id as string });
      else if (r.addressee_id === meId) reqRows.push({ rowId: r.id as string, id: r.requester_id as string });
    }
    const ids = [...new Set([...friendIds.map((f) => f.otherId), ...reqRows.map((r) => r.id)])];
    const names = new Map<string, { username: string; role: string }>();
    if (ids.length) {
      const { data: profs } = await sb.from("profiles").select("id,username,role").in("id", ids);
      for (const p of profs ?? []) names.set(p.id as string, { username: p.username as string, role: (p.role as string) ?? "member" });
    }
    setFriends(friendIds.map((f) => ({ id: f.otherId, rowId: f.rowId, username: names.get(f.otherId)?.username ?? "member", role: names.get(f.otherId)?.role ?? "member" })));
    setRequests(reqRows.map((r) => ({ rowId: r.rowId, id: r.id, username: names.get(r.id)?.username ?? "member" })));
  }, []);

  const loadUnread = useCallback(async (meId: string) => {
    const sb = createClient();
    const { data } = await sb.from("direct_messages").select("sender_id").eq("recipient_id", meId).is("read_at", null);
    const u: Record<string, number> = {};
    for (const r of data ?? []) u[r.sender_id as string] = (u[r.sender_id as string] ?? 0) + 1;
    setUnread(u);
  }, []);

  // Initial load + realtime subscription for incoming messages.
  useEffect(() => {
    if (!me) return;
    loadFriends(me.id);
    loadUnread(me.id);
    fetch("/api/friends/suggest").then((r) => r.json()).then((d) => setSuggested(d.suggestions ?? [])).catch(() => {});
    const sb = createClient();
    const ch = sb.channel(`dm-${me.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "direct_messages", filter: `recipient_id=eq.${me.id}` },
        (payload) => {
          const m = payload.new as Msg;
          const cur = activeRef.current;
          if (cur && m.sender_id === cur.id) {
            setMsgs((prev) => [...prev, m]);
            createClient().from("direct_messages").update({ read_at: new Date().toISOString() }).eq("id", m.id);
          } else {
            setUnread((u) => ({ ...u, [m.sender_id]: (u[m.sender_id] ?? 0) + 1 }));
          }
        })
      .subscribe();
    return () => { sb.removeChannel(ch); };
  }, [me, loadFriends, loadUnread]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [msgs, active]);

  // Report member status + unread up to the Dock so it can render the Friends icon + badge
  // even while this panel is closed (the realtime subscription above keeps it current).
  useEffect(() => {
    const total = Object.values(unread).reduce((a, b) => a + b, 0) + requests.length;
    onMeta({ member: !!me, unread: total });
  }, [me, unread, requests, onMeta]);

  async function openChat(f: Friend) {
    setActive(f);
    if (!me) return;
    const sb = createClient();
    const { data } = await sb.from("direct_messages")
      .select("id,sender_id,recipient_id,body,slip,created_at")
      .or(`and(sender_id.eq.${me.id},recipient_id.eq.${f.id}),and(sender_id.eq.${f.id},recipient_id.eq.${me.id})`)
      .order("created_at", { ascending: true }).limit(300);
    setMsgs((data ?? []).map((m) => ({ ...m, slip: Array.isArray(m.slip) ? m.slip : null } as Msg)));
    // Mark this friend's messages read + clear the badge.
    await sb.from("direct_messages").update({ read_at: new Date().toISOString() })
      .eq("recipient_id", me.id).eq("sender_id", f.id).is("read_at", null);
    setUnread((u) => { const n = { ...u }; delete n[f.id]; return n; });
  }

  async function send(payload: { body?: string; slip?: SlipItem[] }) {
    if (!me || !active) return;
    setSending(true);
    const row = { sender_id: me.id, recipient_id: active.id, body: payload.body ?? null, slip: payload.slip ?? null };
    const { data, error } = await createClient().from("direct_messages").insert(row).select("id,created_at").single();
    setSending(false);
    if (error || !data) return;
    setMsgs((prev) => [...prev, { id: data.id as string, sender_id: me.id, recipient_id: active.id, body: row.body, slip: row.slip, created_at: data.created_at as string }]);
  }

  async function acceptReq(r: Req) {
    await createClient().from("friendships").update({ status: "accepted" }).eq("id", r.rowId);
    if (me) loadFriends(me.id);
  }
  async function addSuggested(s: { id: string }) {
    if (!me) return;
    await createClient().from("friendships").insert({ requester_id: me.id, addressee_id: s.id });
    setSuggested((prev) => prev.filter((x) => x.id !== s.id));
  }
  async function declineReq(r: Req) {
    await createClient().from("friendships").delete().eq("id", r.rowId);
    setRequests((rs) => rs.filter((x) => x.rowId !== r.rowId));
  }

  if (!open || !me) return null;

  return (
    <div className="cw">
      {(
        <div className="cw__panel" role="dialog" aria-label="Friends chat">
          <div className="cw__hd">
            {active ? (
              <button className="cw__back" onClick={() => setActive(null)} aria-label="Back to friends">‹</button>
            ) : <span className="cw__hdic" aria-hidden="true">💬</span>}
            <span className="cw__title">{active ? active.username : "Friends"}</span>
            <button className="cw__min" onClick={onClose} aria-label="Minimize">–</button>
          </div>

          {!active ? (
            <div className="cw__list">
              {requests.length > 0 && (
                <div className="cw__reqs">
                  <div className="cw__reqh">Friend requests</div>
                  {requests.map((r) => (
                    <div className="cw__req" key={r.rowId}>
                      <span className="cw__reqname">{r.username}</span>
                      <span className="cw__reqact">
                        <button className="cw__accept" onClick={() => acceptReq(r)}>Accept</button>
                        <button className="cw__decline" onClick={() => declineReq(r)}>Decline</button>
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {friends.length === 0 ? (
                <p className="cw__empty">No friends yet — add someone from <b>People you may know</b> below, or from a member&apos;s profile.</p>
              ) : (
                friends.map((f) => (
                  <button className="cw__friend" key={f.id} onClick={() => openChat(f)}>
                    <span className="cw__avatar" aria-hidden="true">{f.username.charAt(0).toUpperCase()}</span>
                    <span className={f.role === "founder" ? "cw__fname founder" : "cw__fname"}>{f.username}</span>
                    {unread[f.id] > 0 && <span className="cw__fdot">{unread[f.id]}</span>}
                  </button>
                ))
              )}

              {suggested.length > 0 && (
                <div className="cw__suggest">
                  <div className="cw__reqh">People you may know</div>
                  {suggested.map((s) => (
                    <div className="cw__sug" key={s.id}>
                      <span className="cw__avatar" aria-hidden="true">{s.username.charAt(0).toUpperCase()}</span>
                      <span className="cw__suginfo">
                        <a href={`/u/${s.username}`} className={s.role === "founder" ? "cw__fname founder" : "cw__fname"}>{s.username}</a>
                        <span className="cw__sugmeta">{s.mutual > 0 ? `${s.mutual} mutual friend${s.mutual === 1 ? "" : "s"}` : "New member"}</span>
                      </span>
                      <button className="cw__sugadd" onClick={() => addSuggested(s)}>+ Add</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="cw__thread" ref={scrollRef}>
                {msgs.length === 0 && <p className="cw__empty">Say hi to {active.username}.</p>}
                {msgs.map((m) => (
                  <div className={m.sender_id === me.id ? "cw__msg cw__msg--me" : "cw__msg"} key={m.id}>
                    {m.body && <span className="cw__bubble">{m.body}</span>}
                    {m.slip && m.slip.length > 0 && <MsgSlip items={m.slip} />}
                    <span className="cw__mtime">{time.format(new Date(m.created_at))}</span>
                  </div>
                ))}
              </div>
              <div className="cw__compose">
                {mySlip.length > 0 && (
                  <button className="cw__sendslip" onClick={() => send({ slip: mySlip })} disabled={sending} title="Send your current slip">
                    Send my slip ({mySlip.length})
                  </button>
                )}
                <form className="cw__form" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { send({ body: text.trim() }); setText(""); } }}>
                  <input className="cw__input" value={text} onChange={(e) => setText(e.target.value)} placeholder={`Message ${active.username}…`} maxLength={4000} />
                  <button className="cw__send" type="submit" disabled={sending || !text.trim()}>➤</button>
                </form>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
