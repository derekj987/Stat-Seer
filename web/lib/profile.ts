// Profile-page reads (server-side, service key — profiles + walls are public-read).
// Writes (bio edit, wall post/delete, avatar) happen client-side via RLS.
import { pg, author, type Author } from "./forum";
import type { SlipItem } from "./slip";

export interface Profile {
  id: string;
  username: string;
  role: string;
  title: string | null;
  bio: string | null;
  avatarUrl: string | null;
  coverUrl: string | null;
  accentColor: string | null;
  createdAt: string;
}

export interface Friend {
  id: string;
  username: string;
  role: string;
  avatarUrl: string | null;
  online: boolean;
}

export interface Story {
  id: string;
  userId: string;
  username: string;
  role: string;
  avatarUrl: string | null;
  slip: SlipItem[];
  caption: string | null;
  createdAt: string;
}

const ONLINE_MS = 3 * 60 * 1000; // "online" = seen in the last 3 minutes

export interface WallPost {
  id: string;
  body: string;
  createdAt: string;
  authorId: string;
  author: Author | null;
  slip: SlipItem[] | null;   // optional attached bet slip
}

export async function getProfileByUsername(username: string): Promise<Profile | null> {
  // cover_url + accent_color are added by the profile_upgrade migration; fall back if not there yet.
  const base = `profiles?username=eq.${encodeURIComponent(username)}&limit=1&select=id,username,role,title,bio,avatar_url,created_at`;
  let rows: Record<string, unknown>[];
  try { rows = await pg(base.replace("bio,", "bio,cover_url,accent_color,")); }
  catch { rows = await pg(base); }
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id as string,
    username: r.username as string,
    role: (r.role as string) ?? "member",
    title: (r.title as string) ?? null,
    bio: (r.bio as string) ?? null,
    avatarUrl: (r.avatar_url as string) ?? null,
    coverUrl: (r.cover_url as string) ?? null,
    accentColor: (r.accent_color as string) ?? null,
    createdAt: r.created_at as string,
  };
}

/** Just the accepted-friend ids of a user (for mutual-friends math). */
export async function getFriendIds(userId: string): Promise<string[]> {
  const links = await pg(
    `friendships?status=eq.accepted&or=(requester_id.eq.${userId},addressee_id.eq.${userId})&select=requester_id,addressee_id`,
  );
  return links.map((r) => (r.requester_id === userId ? r.addressee_id : r.requester_id) as string);
}

/** Lightweight counts for the profile stats strip. */
export async function getProfileStats(profileId: string): Promise<{ friends: number; wallPosts: number; stories: number }> {
  const [friends, wall] = await Promise.all([
    getFriendIds(profileId),
    pg(`wall_posts?profile_id=eq.${profileId}&select=id&limit=1000`).catch(() => []),
  ]);
  let stories = 0;
  try { stories = (await pg(`stories?user_id=eq.${profileId}&select=id&limit=1000`)).length; } catch { stories = 0; }
  return { friends: friends.length, wallPosts: wall.length, stories };
}

/** Accepted friends of a profile, with an "online" flag from last_seen. */
export async function getFriends(profileId: string): Promise<Friend[]> {
  const links = await pg(
    `friendships?status=eq.accepted&or=(requester_id.eq.${profileId},addressee_id.eq.${profileId})` +
    `&select=requester_id,addressee_id`,
  );
  const others = links.map((r) => (r.requester_id === profileId ? r.addressee_id : r.requester_id) as string);
  if (!others.length) return [];
  const list = others.map((id) => `"${id}"`).join(",");
  const sel = `profiles?id=in.(${list})&select=id,username,role,avatar_url`;
  let rows: Record<string, unknown>[];
  try { rows = await pg(sel.replace("avatar_url", "avatar_url,last_seen")); }
  catch { rows = await pg(sel); }
  const now = Date.now();
  return rows.map((p) => ({
    id: p.id as string,
    username: p.username as string,
    role: (p.role as string) ?? "member",
    avatarUrl: (p.avatar_url as string) ?? null,
    online: !!p.last_seen && now - new Date(p.last_seen as string).getTime() < ONLINE_MS,
  })).sort((a, b) => Number(b.online) - Number(a.online) || a.username.localeCompare(b.username));
}

/** Latest active (24h) betslip story per person, for the profile owner + their friends. */
export async function getStoriesForCircle(profileId: string, friendIds: string[]): Promise<Story[]> {
  const ids = [...new Set([profileId, ...friendIds])];
  const list = ids.map((id) => `"${id}"`).join(",");
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  let rows: Record<string, unknown>[];
  try {
    rows = await pg(
      `stories?user_id=in.(${list})&created_at=gt.${cutoff}&order=created_at.desc&limit=200` +
      `&select=id,user_id,slip,caption,created_at,user:profiles!stories_user_id_fkey(username,role,avatar_url)`,
    );
  } catch { return []; }
  const seen = new Set<string>();
  const out: Story[] = [];
  for (const r of rows) {
    const uid = r.user_id as string;
    if (seen.has(uid)) continue;
    seen.add(uid);
    const u = r.user as { username?: string; role?: string; avatar_url?: string } | null;
    out.push({
      id: r.id as string,
      userId: uid,
      username: u?.username ?? "member",
      role: u?.role ?? "member",
      avatarUrl: u?.avatar_url ?? null,
      slip: Array.isArray(r.slip) ? (r.slip as SlipItem[]) : [],
      caption: (r.caption as string) ?? null,
      createdAt: r.created_at as string,
    });
  }
  return out;
}

export async function getWall(profileId: string): Promise<WallPost[]> {
  // wall_posts has two FKs to profiles — disambiguate the embed to the author FK.
  // `slip` is optional (added later); if the column isn't there yet, fall back so the
  // profile page never 500s on a not-yet-migrated database.
  const base = `wall_posts?profile_id=eq.${profileId}` +
    `&order=created_at.desc&limit=500` +
    `&select=id,body,SLIPcreated_at,author_id,author:profiles!wall_posts_author_id_fkey(username,role,title)`;
  let rows: Record<string, unknown>[];
  try {
    rows = await pg(base.replace("SLIP", "slip,"));
  } catch {
    rows = await pg(base.replace("SLIP", ""));
  }
  return rows.map((r) => ({
    id: r.id as string,
    body: r.body as string,
    createdAt: r.created_at as string,
    authorId: r.author_id as string,
    author: author(r.author),
    slip: Array.isArray(r.slip) ? (r.slip as SlipItem[]) : null,
  }));
}
