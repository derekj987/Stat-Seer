"use client";

// "People you may know" on the owner's profile — ranked by mutual friends (server-computed
// at /api/friends/suggest). Each has a one-tap Add (sends a friend request).
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Sug = { id: string; username: string; role: string; mutual: number };

export default function SuggestedFriends() {
  const [list, setList] = useState<Sug[] | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/friends/suggest").then((r) => r.json()).then((d) => setList(d.suggestions ?? [])).catch(() => setList([]));
  }, []);

  async function add(s: Sug) {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return;
    const sb = createClient();
    const { data } = await sb.auth.getUser();
    if (!data.user) return;
    await sb.from("friendships").insert({ requester_id: data.user.id, addressee_id: s.id });
    setAdded((a) => new Set(a).add(s.id));
  }

  if (list === null) return <p className="pcard__empty">Finding people…</p>;
  if (!list.length) return <p className="pcard__empty">No suggestions right now — invite a friend to join.</p>;

  return (
    <ul className="psug">
      {list.map((s) => (
        <li className="psug__row" key={s.id}>
          <a className="psug__av" href={`/u/${s.username}`} aria-hidden="true">{s.username.charAt(0).toUpperCase()}</a>
          <span className="psug__info">
            <a href={`/u/${s.username}`} className={s.role === "founder" ? "psug__name founder" : "psug__name"}>{s.username}</a>
            <span className="psug__meta">{s.mutual > 0 ? `${s.mutual} mutual friend${s.mutual === 1 ? "" : "s"}` : "New member"}</span>
          </span>
          {added.has(s.id)
            ? <span className="psug__added">Requested</span>
            : <button className="psug__add" onClick={() => add(s)}>+ Add</button>}
        </li>
      ))}
    </ul>
  );
}
