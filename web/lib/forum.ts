// Forum reads (server-side, service key — everything here is public-read anyway).
// Writes happen client-side through the authenticated browser client + RLS.

export interface Section { slug: string; name: string; desc: string }
export const SECTIONS: Section[] = [
  { slug: "the-app", name: "The App", desc: "Picks, odds, the model, betting — the main room." },
  { slug: "nfl", name: "NFL Talk", desc: "General football: games, teams, news." },
  { slug: "fantasy", name: "Fantasy Football", desc: "Lineups, waivers, start/sit." },
  { slug: "parking-lot", name: "Parking Lot", desc: "Anything goes." },
];
export const sectionBySlug = (slug: string): Section | undefined =>
  SECTIONS.find((s) => s.slug === slug);

export interface Author { username: string; role: string; title: string | null }
export interface ThreadRow {
  id: string; title: string; createdAt: string; lastReplyAt: string;
  author: Author | null; replyCount: number;
}
export interface ThreadFull {
  id: string; section: string; title: string; body: string; createdAt: string;
  authorId: string; author: Author | null;
}
export interface ReplyRow {
  id: string; body: string; createdAt: string; authorId: string; author: Author | null;
}

async function pg(path: string): Promise<Record<string, unknown>[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY not set");
  const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return (await res.json()) as Record<string, unknown>[];
}

function author(raw: unknown): Author | null {
  const a = raw as { username?: string; role?: string; title?: string | null } | null;
  return a && a.username ? { username: a.username, role: a.role ?? "member", title: a.title ?? null } : null;
}

export async function listThreads(section: string): Promise<ThreadRow[]> {
  const rows = await pg(
    `threads?section=eq.${encodeURIComponent(section)}` +
    `&select=id,title,created_at,last_reply_at,author:profiles(username,role,title),replies(count)` +
    `&order=last_reply_at.desc&limit=200`,
  );
  return rows.map((r) => ({
    id: r.id as string,
    title: r.title as string,
    createdAt: r.created_at as string,
    lastReplyAt: r.last_reply_at as string,
    author: author(r.author),
    replyCount: Number((r.replies as { count: number }[] | undefined)?.[0]?.count ?? 0),
  }));
}

export async function getThread(id: string): Promise<ThreadFull | null> {
  const rows = await pg(
    `threads?id=eq.${id}&select=id,section,title,body,created_at,author_id,author:profiles(username,role,title)&limit=1`,
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id as string,
    section: r.section as string,
    title: r.title as string,
    body: r.body as string,
    createdAt: r.created_at as string,
    authorId: r.author_id as string,
    author: author(r.author),
  };
}

export async function getReplies(threadId: string): Promise<ReplyRow[]> {
  const rows = await pg(
    `replies?thread_id=eq.${threadId}&select=id,body,created_at,author_id,author:profiles(username,role,title)&order=created_at.asc&limit=1000`,
  );
  return rows.map((r) => ({
    id: r.id as string,
    body: r.body as string,
    createdAt: r.created_at as string,
    authorId: r.author_id as string,
    author: author(r.author),
  }));
}
