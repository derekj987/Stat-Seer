// Profile-page reads (server-side, service key — profiles + walls are public-read).
// Writes (bio edit, wall post/delete, avatar) happen client-side via RLS.
import { pg, author, type Author } from "./forum";
import type { SlipItem } from "./slip";
import { REACTION_EMOJI } from "./reactions";

export interface Profile {
  id: string;
  username: string;
  role: string;
  status: string;   // "approved" | "pending" | "rejected" (beta gate); defaults approved pre-migration
  title: string | null;
  bio: string | null;
  avatarUrl: string | null;
  coverUrl: string | null;
  accentColor: string | null;
  favoriteTeams: string[];
  pinnedPostId: string | null;   // owner-pinned wall post (null until pinned_post migration)
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

// "online" = seen in the last 3 minutes. Defined in ./presence so client components (the chat
// widget's friend bubbles) can share the same threshold without bundling this server-only module.
import { ONLINE_MS } from "./presence";

export interface WallComment {
  id: string;
  body: string;
  createdAt: string;
  authorId: string;
  author: Author | null;
}

export interface Reaction {
  emoji: string;
  count: number;
  mine: boolean;   // did the viewer leave this reaction
}

export interface WallPost {
  id: string;
  body: string;
  createdAt: string;
  authorId: string;
  author: Author | null;
  slip: SlipItem[] | null;   // optional attached bet slip
  media: string[];           // attached image URLs (empty until wall_media migration)
  reactions: Reaction[];     // emoji reactions with counts (empty until wall_social migration)
  comments: WallComment[];   // threaded comments (empty until wall_social migration)
}

// REACTION_EMOJI (the fixed reaction palette) lives in ./reactions so client components can
// import it without bundling this server-only module. Re-exported here for existing callers.
export { REACTION_EMOJI };

export async function getProfileByUsername(username: string): Promise<Profile | null> {
  // cover_url + accent_color are added by the profile_upgrade migration; fall back if not there yet.
  const base = `profiles?username=eq.${encodeURIComponent(username)}&limit=1&select=id,username,role,status,title,bio,avatar_url,created_at`;
  const baseNoStatus = base.replace("role,status,", "role,");   // status added by beta_approval.sql
  const sel = (extra: string) => base.replace("bio,", `bio,${extra}`);
  // Optional columns arrive across separate migrations; degrade one level at a time so a newer
  // column being absent doesn't drop the older ones (cover/accent/teams/status).
  let rows: Record<string, unknown>[];
  try { rows = await pg(sel("cover_url,accent_color,favorite_teams,pinned_post_id,")); }
  catch {
    try { rows = await pg(sel("cover_url,accent_color,favorite_teams,")); }
    catch {
      try { rows = await pg(base); }
      catch { rows = await pg(baseNoStatus); }   // pre-beta_approval.sql: no status column
    }
  }
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id as string,
    username: r.username as string,
    role: (r.role as string) ?? "member",
    status: (r.status as string) ?? "approved",   // fail-open if the column isn't migrated yet
    title: (r.title as string) ?? null,
    bio: (r.bio as string) ?? null,
    avatarUrl: (r.avatar_url as string) ?? null,
    coverUrl: (r.cover_url as string) ?? null,
    accentColor: (r.accent_color as string) ?? null,
    favoriteTeams: (r.favorite_teams as string[] | null) ?? [],
    pinnedPostId: (r.pinned_post_id as string | null) ?? null,
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

/** Follower/following counts + whether the viewer follows this profile. Degrades to zeros/false if
 *  the follows table isn't migrated yet, so the header renders fine pre-migration. */
export async function getFollowStats(profileId: string, viewerId?: string | null):
  Promise<{ followers: number; following: number; viewerFollows: boolean }> {
  try {
    const [followers, following, mine] = await Promise.all([
      pg(`follows?following_id=eq.${profileId}&select=follower_id&limit=5000`),
      pg(`follows?follower_id=eq.${profileId}&select=following_id&limit=5000`),
      viewerId && viewerId !== profileId
        ? pg(`follows?follower_id=eq.${viewerId}&following_id=eq.${profileId}&select=follower_id&limit=1`)
        : Promise.resolve([] as Record<string, unknown>[]),
    ]);
    return { followers: followers.length, following: following.length, viewerFollows: mine.length > 0 };
  } catch {
    return { followers: 0, following: 0, viewerFollows: false };
  }
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

export async function getWall(profileId: string, viewerId?: string | null): Promise<WallPost[]> {
  // wall_posts has two FKs to profiles — disambiguate the embed to the author FK.
  // `slip` is optional (added later); if the column isn't there yet, fall back so the
  // profile page never 500s on a not-yet-migrated database.
  const base = `wall_posts?profile_id=eq.${profileId}` +
    `&order=created_at.desc&limit=500` +
    `&select=id,body,SLIPcreated_at,author_id,author:profiles!wall_posts_author_id_fkey(username,role,title)`;
  // `slip` and `media` are optional columns added by later migrations; degrade one level at a time
  // so a post never fails to load on a DB that has some but not all of them.
  let rows: Record<string, unknown>[];
  try {
    rows = await pg(base.replace("SLIP", "slip,media,"));
  } catch {
    try {
      rows = await pg(base.replace("SLIP", "slip,"));
    } catch {
      rows = await pg(base.replace("SLIP", ""));
    }
  }
  const ids = rows.map((r) => r.id as string);
  const [commentsByPost, reactionsByPost] = await Promise.all([
    getWallComments(ids),
    getWallReactions(ids, viewerId),
  ]);
  return rows.map((r) => {
    const id = r.id as string;
    return {
      id,
      body: r.body as string,
      createdAt: r.created_at as string,
      authorId: r.author_id as string,
      author: author(r.author),
      slip: Array.isArray(r.slip) ? (r.slip as SlipItem[]) : null,
      media: Array.isArray(r.media) ? (r.media as string[]) : [],
      reactions: reactionsByPost.get(id) ?? [],
      comments: commentsByPost.get(id) ?? [],
    };
  });
}

/** Comments for a set of posts, grouped by post_id (chronological). Empty map pre-migration. */
async function getWallComments(postIds: string[]): Promise<Map<string, WallComment[]>> {
  const out = new Map<string, WallComment[]>();
  if (!postIds.length) return out;
  const list = postIds.map((id) => `"${id}"`).join(",");
  let rows: Record<string, unknown>[];
  try {
    rows = await pg(
      `wall_comments?post_id=in.(${list})&order=created_at.asc&limit=2000` +
      `&select=id,post_id,body,created_at,author_id,author:profiles!wall_comments_author_id_fkey(username,role,title)`,
    );
  } catch { return out; }
  for (const r of rows) {
    const pid = r.post_id as string;
    (out.get(pid) ?? out.set(pid, []).get(pid)!).push({
      id: r.id as string,
      body: r.body as string,
      createdAt: r.created_at as string,
      authorId: r.author_id as string,
      author: author(r.author),
    });
  }
  return out;
}

/** Reaction tallies for a set of posts, grouped by post_id (fixed emoji order). Empty pre-migration. */
async function getWallReactions(postIds: string[], viewerId?: string | null): Promise<Map<string, Reaction[]>> {
  const out = new Map<string, Reaction[]>();
  if (!postIds.length) return out;
  const list = postIds.map((id) => `"${id}"`).join(",");
  let rows: Record<string, unknown>[];
  try {
    rows = await pg(`wall_reactions?post_id=in.(${list})&select=post_id,user_id,emoji&limit=10000`);
  } catch { return out; }
  // tally: post_id -> emoji -> {count, mine}
  const tally = new Map<string, Map<string, { count: number; mine: boolean }>>();
  for (const r of rows) {
    const pid = r.post_id as string, emoji = r.emoji as string;
    const perPost = tally.get(pid) ?? tally.set(pid, new Map()).get(pid)!;
    const cell = perPost.get(emoji) ?? perPost.set(emoji, { count: 0, mine: false }).get(emoji)!;
    cell.count += 1;
    if (viewerId && r.user_id === viewerId) cell.mine = true;
  }
  for (const [pid, perPost] of tally) {
    out.set(pid, REACTION_EMOJI
      .filter((e) => perPost.has(e))
      .map((e) => ({ emoji: e, count: perPost.get(e)!.count, mine: perPost.get(e)!.mine })));
  }
  return out;
}
