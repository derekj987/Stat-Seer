import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { pg } from "@/lib/forum";

export const dynamic = "force-dynamic";

// "People you may know" — computed server-side (service key) because friend-graph RLS
// only exposes YOUR own friendships to the client, so friends-of-friends can't be found
// from the browser. Ranks members you're not connected to by mutual-friend count, then
// backfills with the newest members so there's always something to discover.
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ suggestions: [] });
    const me = user.id;


    // Everyone I'm already connected to (any status, either direction) — excluded.
    const mine = await pg(`friendships?or=(requester_id.eq.${me},addressee_id.eq.${me})&select=requester_id,addressee_id,status`);
    const connected = new Set<string>([me]);
    const friendIds = new Set<string>();
    for (const r of mine) {
      const other = (r.requester_id === me ? r.addressee_id : r.requester_id) as string;
      connected.add(other);
      if (r.status === "accepted") friendIds.add(other);
    }

    // Friends-of-friends: accepted edges touching one of my friends → tally the far side.
    const tally = new Map<string, number>();
    if (friendIds.size) {
      const ids = [...friendIds].join(",");
      const fof = await pg(`friendships?status=eq.accepted&or=(requester_id.in.(${ids}),addressee_id.in.(${ids}))&select=requester_id,addressee_id`);
      for (const r of fof) {
        for (const side of [r.requester_id as string, r.addressee_id as string]) {
          if (!connected.has(side)) tally.set(side, (tally.get(side) ?? 0) + 1);
        }
      }
    }

    const NEED = 8;
    const ranked: { id: string; mutual: number }[] =
      [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([id, mutual]) => ({ id, mutual }));

    // Backfill with the newest members so discovery still works with a small graph.
    if (ranked.length < NEED) {
      const have = new Set([...connected, ...ranked.map((r) => r.id)]);
      const recent = await pg(`profiles?select=id&order=created_at.desc&limit=50`);
      for (const p of recent) {
        const id = p.id as string;
        if (have.has(id)) continue;
        ranked.push({ id, mutual: 0 });
        have.add(id);
        if (ranked.length >= NEED) break;
      }
    }
    const top = ranked.slice(0, NEED);

    const names = new Map<string, { username: string; role: string }>();
    if (top.length) {
      const idlist = top.map((r) => r.id).join(",");
      const profs = await pg(`profiles?id=in.(${idlist})&select=id,username,role`);
      for (const p of profs) names.set(p.id as string, { username: p.username as string, role: (p.role as string) ?? "member" });
    }
    const suggestions = top
      .map((r) => ({ id: r.id, mutual: r.mutual, username: names.get(r.id)?.username ?? "", role: names.get(r.id)?.role ?? "member" }))
      .filter((s) => s.username);
    return NextResponse.json({ suggestions });
  } catch {
    return NextResponse.json({ suggestions: [] });
  }
}
