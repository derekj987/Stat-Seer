"use client";

// Member chat, mounted in the Dock. Conversations can be 1:1 or GROUPS (add as many
// friends as you like); each message carries text (with **bold** / *italic* / `code` /
// ~~strike~~ + links), an emoji, a GIF, and/or your current Value Finder slip. New messages
// arrive live via Supabase Realtime. Only accepted friends can be added (enforced by RLS).
// The launcher + unread badge live in the Dock; this reports {member, unread} up via onMeta.
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useSlip, encodeSlip, type SlipItem } from "@/lib/slip";
import { bookName, decToAmerican, priceSlip } from "@/lib/slipPricing";
import { formatMessage, wrapSelection, EMOJIS } from "@/lib/chatFormat";

type Me = { id: string; username: string };
type Person = { id: string; username: string; role: string };
type Friend = Person & { rowId: string };
type Req = { rowId: string; id: string; username: string };
type Conv = { id: string; title: string | null; isGroup: boolean; members: Person[]; lastAt: string; unread: number };
type Msg = { id: string; conversation_id: string; sender_id: string; kind: string; body: string | null; gif_url: string | null; slip: SlipItem[] | null; created_at: string };
type Gif = { id: string; preview: string; url: string };

const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

function convName(c: Conv, meId: string): string {
  if (c.title) return c.title;
  const others = c.members.filter((m) => m.id !== meId);
  if (!others.length) return "Just you";
  if (others.length === 1) return others[0].username;
  return others.map((o) => o.username).join(", ");
}

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

export default function ChatWidget({ open, onClose, onMeta }:
  { open: boolean; onClose: () => void; onMeta: (m: { member: boolean; unread: number }) => void }) {
  const { items: mySlip } = useSlip();
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [convs, setConvs] = useState<Conv[]>([]);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [requests, setRequests] = useState<Req[]>([]);
  const [view, setView] = useState<"list" | "chat" | "new">("list");
  const [active, setActive] = useState<Conv | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [chatErr, setChatErr] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());   // group builder (＋)
  const [groupName, setGroupName] = useState("");
  // pickers
  const [showEmoji, setShowEmoji] = useState(false);
  const [showGif, setShowGif] = useState(false);
  const [gifQ, setGifQ] = useState("");
  const [gifs, setGifs] = useState<Gif[]>([]);
  const [gifOn, setGifOn] = useState(true);

  const [notifPerm, setNotifPerm] = useState<NotificationPermission | "unsupported">("default");
  const activeRef = useRef<Conv | null>(null); activeRef.current = active;
  const convIdsRef = useRef<Set<string>>(new Set());
  const openRef = useRef(open); openRef.current = open;
  const convsRef = useRef<Conv[]>([]); convsRef.current = convs;
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const configured = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

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
    const { data: rows } = await sb.from("friendships").select("id,requester_id,addressee_id,status")
      .or(`requester_id.eq.${meId},addressee_id.eq.${meId}`);
    const fr: { otherId: string; rowId: string }[] = [];
    const rq: { rowId: string; id: string }[] = [];
    for (const r of rows ?? []) {
      const other = r.requester_id === meId ? r.addressee_id : r.requester_id;
      if (r.status === "accepted") fr.push({ otherId: other as string, rowId: r.id as string });
      else if (r.addressee_id === meId) rq.push({ rowId: r.id as string, id: r.requester_id as string });
    }
    const ids = [...new Set([...fr.map((f) => f.otherId), ...rq.map((r) => r.id)])];
    const names = new Map<string, Person>();
    if (ids.length) {
      const { data: profs } = await sb.from("profiles").select("id,username,role").in("id", ids);
      for (const p of profs ?? []) names.set(p.id as string, { id: p.id as string, username: p.username as string, role: (p.role as string) ?? "member" });
    }
    setFriends(fr.map((f) => ({ id: f.otherId, rowId: f.rowId, username: names.get(f.otherId)?.username ?? "member", role: names.get(f.otherId)?.role ?? "member" })));
    setRequests(rq.map((r) => ({ rowId: r.rowId, id: r.id, username: names.get(r.id)?.username ?? "member" })));
  }, []);

  const loadConvs = useCallback(async (meId: string) => {
    const sb = createClient();
    const { data: mem } = await sb.from("conversation_members").select("conversation_id,last_read_at").eq("user_id", meId);
    const ids = (mem ?? []).map((m) => m.conversation_id as string);
    convIdsRef.current = new Set(ids);
    if (!ids.length) { setConvs([]); return; }
    const lastRead = new Map<string, string>();
    for (const m of mem ?? []) lastRead.set(m.conversation_id as string, (m.last_read_at as string) ?? "1970-01-01");
    const [{ data: cs }, { data: allMem }] = await Promise.all([
      sb.from("conversations").select("id,title,is_group,last_message_at").in("id", ids),
      sb.from("conversation_members").select("conversation_id,user_id").in("conversation_id", ids),
    ]);
    const uids = [...new Set((allMem ?? []).map((m) => m.user_id as string))];
    const pmap = new Map<string, Person>();
    if (uids.length) {
      const { data: profs } = await sb.from("profiles").select("id,username,role").in("id", uids);
      for (const p of profs ?? []) pmap.set(p.id as string, { id: p.id as string, username: p.username as string, role: (p.role as string) ?? "member" });
    }
    const byConv = new Map<string, Person[]>();
    for (const m of allMem ?? []) {
      const arr = byConv.get(m.conversation_id as string) ?? [];
      const p = pmap.get(m.user_id as string);
      if (p) arr.push(p);
      byConv.set(m.conversation_id as string, arr);
    }
    // unread: recent messages after my last_read, not from me
    const { data: recent } = await sb.from("conversation_messages")
      .select("conversation_id,sender_id,created_at").in("conversation_id", ids)
      .order("created_at", { ascending: false }).limit(400);
    const unread = new Map<string, number>();
    for (const m of recent ?? []) {
      const cid = m.conversation_id as string;
      if ((m.sender_id as string) !== meId && (m.created_at as string) > (lastRead.get(cid) ?? "")) {
        unread.set(cid, (unread.get(cid) ?? 0) + 1);
      }
    }
    const list: Conv[] = (cs ?? []).map((c) => ({
      id: c.id as string, title: (c.title as string) ?? null, isGroup: !!c.is_group,
      members: byConv.get(c.id as string) ?? [], lastAt: (c.last_message_at as string) ?? "",
      unread: unread.get(c.id as string) ?? 0,
    })).sort((a, b) => b.lastAt.localeCompare(a.lastAt));
    setConvs(list);
  }, []);

  // Initial load + realtime for any new message in my conversations.
  useEffect(() => {
    if (!me) return;
    loadFriends(me.id);
    loadConvs(me.id);
    const sb = createClient();
    const ch = sb.channel(`conv-${me.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "conversation_messages" }, (payload) => {
        const m = payload.new as Msg;
        if (!convIdsRef.current.has(m.conversation_id)) return;
        const cur = activeRef.current;
        const viewingThis = !!cur && m.conversation_id === cur.id && openRef.current && !document.hidden;
        if (cur && m.conversation_id === cur.id) {
          setMsgs((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, { ...m, slip: Array.isArray(m.slip) ? m.slip : null }]));
          if (m.sender_id !== me.id) markRead(cur.id);
        }
        // System notification (banner at the top of the phone) when a message from someone
        // else arrives and you're not already looking at that chat.
        if (m.sender_id !== me.id && !viewingThis && typeof Notification !== "undefined" && Notification.permission === "granted") {
          try {
            const conv = convsRef.current.find((c) => c.id === m.conversation_id);
            const sender = conv?.members.find((x) => x.id === m.sender_id)?.username ?? "New message";
            const title = conv?.isGroup ? `${sender} · ${convName(conv, me.id)}` : sender;
            const body = m.kind === "gif" ? "Sent a GIF" : m.kind === "slip" ? "Shared a slip" : (m.body ?? "");
            const n = new Notification(title, { body, tag: m.conversation_id, icon: "/icon-192.png" });
            n.onclick = () => { window.focus(); n.close(); };
          } catch { /* notifications unavailable */ }
        }
        loadConvs(me.id);
      }).subscribe();
    return () => { sb.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, loadFriends, loadConvs]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [msgs, active]);

  // Report member + unread up to the Dock, and set the installed-PWA app-icon badge.
  useEffect(() => {
    const total = convs.reduce((a, c) => a + c.unread, 0) + requests.length;
    onMeta({ member: !!me, unread: total });
    try {
      const nav = navigator as Navigator & { setAppBadge?: (n?: number) => void; clearAppBadge?: () => void };
      if (total > 0) nav.setAppBadge?.(total); else nav.clearAppBadge?.();
    } catch { /* Badging API unavailable */ }
  }, [me, convs, requests, onMeta]);

  // Know whether we can prompt for notification permission (and re-read after granting).
  useEffect(() => {
    setNotifPerm(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  }, []);
  async function enableNotifs() {
    if (typeof Notification === "undefined") return;
    try { setNotifPerm(await Notification.requestPermission()); } catch { /* denied */ }
  }

  async function markRead(convId: string) {
    if (!me) return;
    await createClient().from("conversation_members").update({ last_read_at: new Date().toISOString() })
      .eq("conversation_id", convId).eq("user_id", me.id);
  }

  async function openConv(c: Conv) {
    setActive(c); setView("chat"); setShowEmoji(false); setShowGif(false);
    if (!me) return;
    const sb = createClient();
    const { data } = await sb.from("conversation_messages")
      .select("id,conversation_id,sender_id,kind,body,gif_url,slip,created_at")
      .eq("conversation_id", c.id).order("created_at", { ascending: true }).limit(400);
    setMsgs((data ?? []).map((m) => ({ ...m, slip: Array.isArray(m.slip) ? m.slip : null } as Msg)));
    await markRead(c.id);
    setConvs((prev) => prev.map((x) => (x.id === c.id ? { ...x, unread: 0 } : x)));
  }

  async function send(payload: { body?: string; slip?: SlipItem[]; gif?: string }) {
    if (!me || !active || sending) return;
    setSending(true);
    const kind = payload.gif ? "gif" : payload.slip ? "slip" : "text";
    const row = { conversation_id: active.id, sender_id: me.id, kind, body: payload.body ?? null, gif_url: payload.gif ?? null, slip: payload.slip ?? null };
    const sb = createClient();
    const { data, error } = await sb.from("conversation_messages").insert(row).select("id,created_at").single();
    if (!error && data) {
      setMsgs((prev) => [...prev, { id: data.id as string, conversation_id: active.id, sender_id: me.id, kind, body: row.body, gif_url: row.gif_url, slip: row.slip, created_at: data.created_at as string }]);
      sb.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", active.id).then(() => {});
    }
    setSending(false);
  }

  // Click a friend → open the chat with them immediately (reusing an existing 1:1 if there
  // is one). Groups are built by adding more friends from inside the thread.
  async function startWith(friend: Friend) {
    if (!me) return;
    setChatErr("");
    const existing = convs.find((c) => !c.isGroup && c.members.length === 2 && c.members.some((m) => m.id === friend.id));
    if (existing) { openConv(existing); return; }
    const sb = createClient();
    // Generate the id client-side so creation never depends on an RLS-gated returning select.
    const cid = crypto.randomUUID();
    const { error } = await sb.from("conversations").insert({ id: cid, created_by: me.id, is_group: false, title: null });
    if (error) { setChatErr(`Couldn't start the chat — ${error.message || "the chat tables may not be set up yet (run ingest/group_chat.sql)."}`); return; }
    await sb.from("conversation_members").insert({ conversation_id: cid, user_id: me.id });
    const { error: e2 } = await sb.from("conversation_members").insert({ conversation_id: cid, user_id: friend.id });
    if (e2) { setChatErr(`Couldn't add ${friend.username} — ${e2.message || "make sure you're still friends."}`); return; }
    // Open the chat immediately; refresh the list in the background (never block the open on it).
    const members: Person[] = [{ id: me.id, username: me.username, role: "member" }, { id: friend.id, username: friend.username, role: friend.role }];
    openConv({ id: cid, title: null, isGroup: false, members, lastAt: new Date().toISOString(), unread: 0 });
    loadConvs(me.id);
  }

  // Create a group from the picked friends (＋ flow). One picked friend is just a 1:1.
  async function createGroup() {
    if (!me || picked.size === 0) return;
    const ids = [...picked];
    if (ids.length === 1) { const f = friends.find((x) => x.id === ids[0]); setPicked(new Set()); setGroupName(""); if (f) startWith(f); return; }
    const sb = createClient();
    const cid = crypto.randomUUID();
    const { error } = await sb.from("conversations")
      .insert({ id: cid, created_by: me.id, is_group: true, title: groupName.trim() ? groupName.trim().slice(0, 60) : null });
    if (error) { setChatErr(`Couldn't create the group — ${error.message || "the chat tables may not be set up yet (run ingest/group_chat.sql)."}`); return; }
    await sb.from("conversation_members").insert({ conversation_id: cid, user_id: me.id });
    const { error: e2 } = await sb.from("conversation_members").insert(ids.map((id) => ({ conversation_id: cid, user_id: id })));
    if (e2) { setChatErr(`Couldn't add everyone — ${e2.message || "check you're friends with them."}`); return; }
    const name = groupName.trim();
    setPicked(new Set()); setGroupName("");
    const members: Person[] = [{ id: me.id, username: me.username, role: "member" }, ...friends.filter((f) => ids.includes(f.id))];
    openConv({ id: cid, title: name || null, isGroup: true, members, lastAt: new Date().toISOString(), unread: 0 });
    loadConvs(me.id);
  }

  // Add more friends to the active group.
  async function addToGroup(ids: string[]) {
    if (!me || !active || !ids.length) return;
    const sb = createClient();
    if (!active.isGroup) await sb.from("conversations").update({ is_group: true }).eq("id", active.id);
    await sb.from("conversation_members").insert(ids.map((id) => ({ conversation_id: active.id, user_id: id })));
    await loadConvs(me.id);
    const added = friends.filter((f) => ids.includes(f.id)).map((f) => ({ id: f.id, username: f.username, role: f.role }));
    setActive((a) => (a ? { ...a, isGroup: true, members: [...a.members, ...added] } : a));
  }

  async function acceptReq(r: Req) { await createClient().from("friendships").update({ status: "accepted" }).eq("id", r.rowId); if (me) loadFriends(me.id); }
  async function declineReq(r: Req) { await createClient().from("friendships").delete().eq("id", r.rowId); setRequests((rs) => rs.filter((x) => x.rowId !== r.rowId)); }

  async function searchGifs(q: string) {
    try {
      const res = await fetch(`/api/chat/gif?q=${encodeURIComponent(q)}`);
      const d = await res.json();
      setGifOn(d.configured !== false);
      setGifs(d.gifs ?? []);
    } catch { setGifs([]); }
  }

  function insertEmoji(e: string) {
    const el = inputRef.current;
    if (!el) { setText((t) => t + e); return; }
    const s = el.selectionStart ?? text.length;
    setText(text.slice(0, s) + e + text.slice(el.selectionEnd ?? s));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + e.length, s + e.length); });
  }
  function fmt(marker: string) { const el = inputRef.current; if (el) setText(wrapSelection(el, marker)); }

  if (!open || !me) return null;

  const memberIds = new Set(active?.members.map((m) => m.id) ?? []);
  const addable = friends.filter((f) => !memberIds.has(f.id));
  const groups = convs.filter((c) => c.isGroup);
  const friendUnread = new Map<string, number>();
  for (const c of convs) {
    if (!c.isGroup && c.unread > 0) {
      const other = c.members.find((m) => m.id !== me.id);
      if (other) friendUnread.set(other.id, (friendUnread.get(other.id) ?? 0) + c.unread);
    }
  }

  return (
    <div className="cw">
      <div className="cw__panel" role="dialog" aria-label="Chat">
        <div className="cw__hd">
          {view !== "list" ? (
            <button className="cw__back" onClick={() => { setView("list"); setActive(null); setShowEmoji(false); setShowGif(false); }} aria-label="Back">‹</button>
          ) : <span className="cw__hdic" aria-hidden="true">💬</span>}
          <span className="cw__title">{view === "chat" && active ? convName(active, me.id) : view === "new" ? "New group" : "Friends"}</span>
          {view === "list" && <button className="cw__new" onClick={() => { setView("new"); setChatErr(""); setPicked(new Set()); setGroupName(""); }} title="New group chat">＋</button>}
          <button className="cw__min" onClick={onClose} aria-label="Minimize">–</button>
        </div>

        {/* ---- LANDING: friends (tap to chat) + any group chats on top ---- */}
        {view === "list" && (
          <div className="cw__list">
            {chatErr && <p className="cw__err">{chatErr}</p>}
            {notifPerm === "default" && (
              <button className="cw__notif" onClick={enableNotifs}>🔔 Turn on notifications for new messages</button>
            )}
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
            {groups.length > 0 && (
              <>
                <div className="cw__section">Group chats</div>
                {groups.map((c) => (
                  <button className="cw__friend" key={c.id} onClick={() => openConv(c)}>
                    <span className="cw__avatar" aria-hidden="true">👥</span>
                    <span className="cw__cvinfo">
                      <span className="cw__fname">{convName(c, me.id)}</span>
                      <span className="cw__cvsub">{c.members.length} members</span>
                    </span>
                    {c.unread > 0 && <span className="cw__fdot">{c.unread}</span>}
                  </button>
                ))}
              </>
            )}
            <div className="cw__section">Friends</div>
            {friends.length === 0 ? (
              <p className="cw__empty">Add friends from a member&apos;s profile — then tap one here to chat.</p>
            ) : (
              friends.map((f) => (
                <button className="cw__friend" key={f.id} onClick={() => startWith(f)}>
                  <span className="cw__avatar" aria-hidden="true">{f.username.charAt(0).toUpperCase()}</span>
                  <span className={f.role === "founder" ? "cw__fname founder" : "cw__fname"}>{f.username}</span>
                  {friendUnread.get(f.id) ? <span className="cw__fdot">{friendUnread.get(f.id)}</span> : <span className="cw__pick" aria-hidden="true">›</span>}
                </button>
              ))
            )}
          </div>
        )}

        {/* ---- NEW GROUP — pick friends, then Create ---- */}
        {view === "new" && (
          <div className="cw__list">
            {chatErr && <p className="cw__err">{chatErr}</p>}
            {friends.length === 0 ? (
              <p className="cw__empty">Add friends from a member&apos;s profile first, then make a group here.</p>
            ) : (
              <>
                <p className="cw__hint">Pick the friends for your group.</p>
                {picked.size > 1 && (
                  <input className="cw__gname" value={groupName} maxLength={60}
                    onChange={(e) => setGroupName(e.target.value)} placeholder="Group name (optional)" />
                )}
                {friends.map((f) => {
                  const on = picked.has(f.id);
                  return (
                    <button className={on ? "cw__friend on" : "cw__friend"} key={f.id}
                      onClick={() => setPicked((p) => { const n = new Set(p); if (n.has(f.id)) n.delete(f.id); else n.add(f.id); return n; })}>
                      <span className="cw__avatar" aria-hidden="true">{f.username.charAt(0).toUpperCase()}</span>
                      <span className={f.role === "founder" ? "cw__fname founder" : "cw__fname"}>{f.username}</span>
                      <span className="cw__pick" aria-hidden="true">{on ? "✓" : "+"}</span>
                    </button>
                  );
                })}
                <button className="btn btn--primary cw__start" disabled={picked.size === 0} onClick={createGroup}>
                  {picked.size > 1 ? `Create group (${picked.size})` : "Start chat"}
                </button>
              </>
            )}
          </div>
        )}

        {/* ---- CHAT THREAD ---- */}
        {view === "chat" && active && (
          <>
            <div className="cw__thread" ref={scrollRef}>
              {active.isGroup && (
                <div className="cw__grouphd">
                  {active.members.map((m) => m.username).join(", ")}
                  {addable.length > 0 && (
                    <select className="cw__addsel" defaultValue="" onChange={(e) => { if (e.target.value) { addToGroup([e.target.value]); e.target.value = ""; } }}>
                      <option value="" disabled>+ Add friend</option>
                      {addable.map((f) => <option key={f.id} value={f.id}>{f.username}</option>)}
                    </select>
                  )}
                </div>
              )}
              {msgs.length === 0 && <p className="cw__empty">Say hi 👋</p>}
              {msgs.map((m) => {
                const mine = m.sender_id === me.id;
                const sender = active.members.find((x) => x.id === m.sender_id);
                return (
                  <div className={mine ? "cw__msg cw__msg--me" : "cw__msg"} key={m.id}>
                    {active.isGroup && !mine && <span className="cw__msgfrom">{sender?.username ?? "member"}</span>}
                    {m.body && <span className="cw__bubble">{formatMessage(m.body)}</span>}
                    {m.gif_url && (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img className="cw__gif" src={m.gif_url} alt="GIF" loading="lazy" />
                    )}
                    {m.slip && m.slip.length > 0 && <MsgSlip items={m.slip} />}
                    <span className="cw__mtime">{time.format(new Date(m.created_at))}</span>
                  </div>
                );
              })}
            </div>

            {showEmoji && (
              <div className="cw__emoji">
                {EMOJIS.map((e) => <button key={e} className="cw__emojib" onClick={() => insertEmoji(e)}>{e}</button>)}
              </div>
            )}
            {showGif && (
              <div className="cw__gifp">
                <input className="cw__gifq" value={gifQ} placeholder={gifOn ? "Search GIFs…" : "GIFs not configured"}
                  disabled={!gifOn} onChange={(e) => { setGifQ(e.target.value); searchGifs(e.target.value); }} />
                <div className="cw__gifgrid">
                  {gifs.map((g) => (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img key={g.id} className="cw__gifthumb" src={g.preview} alt="" loading="lazy"
                      onClick={() => { send({ gif: g.url }); setShowGif(false); }} />
                  ))}
                  {!gifs.length && <span className="cw__gifempty">{gifOn ? "Type to search Tenor." : "Ask the admin to set TENOR_API_KEY to enable GIFs."}</span>}
                </div>
              </div>
            )}

            <div className="cw__compose">
              {mySlip.length > 0 && (
                <button className="cw__sendslip" onClick={() => send({ slip: mySlip })} disabled={sending} title="Send your current slip">
                  Send my slip ({mySlip.length})
                </button>
              )}
              <div className="cw__tools">
                <button className="cw__tool" onClick={() => fmt("**")} title="Bold" type="button"><b>B</b></button>
                <button className="cw__tool" onClick={() => fmt("*")} title="Italic" type="button"><i>i</i></button>
                <button className={showEmoji ? "cw__tool on" : "cw__tool"} onClick={() => { setShowEmoji((v) => !v); setShowGif(false); }} title="Emoji" type="button">😊</button>
                <button className={showGif ? "cw__tool on" : "cw__tool"} onClick={() => { const n = !showGif; setShowGif(n); setShowEmoji(false); if (n && !gifs.length) searchGifs(""); }} title="GIF" type="button">GIF</button>
              </div>
              <form className="cw__form" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { send({ body: text.trim() }); setText(""); } }}>
                <input ref={inputRef} className="cw__input" value={text} onChange={(e) => setText(e.target.value)}
                  placeholder="Message…" maxLength={4000} />
                <button className="cw__send" type="submit" disabled={sending || !text.trim()}>➤</button>
              </form>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
