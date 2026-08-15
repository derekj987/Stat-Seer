// Profile-page reads (server-side, service key — profiles + walls are public-read).
// Writes (bio edit, wall post/delete, avatar) happen client-side via RLS.
import { pg, author, type Author } from "./forum";

export interface Profile {
  id: string;
  username: string;
  role: string;
  title: string | null;
  bio: string | null;
  avatarUrl: string | null;
  createdAt: string;
}

export interface WallPost {
  id: string;
  body: string;
  createdAt: string;
  authorId: string;
  author: Author | null;
}

export async function getProfileByUsername(username: string): Promise<Profile | null> {
  const rows = await pg(
    `profiles?username=eq.${encodeURIComponent(username)}` +
    `&select=id,username,role,title,bio,avatar_url,created_at&limit=1`,
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id as string,
    username: r.username as string,
    role: (r.role as string) ?? "member",
    title: (r.title as string) ?? null,
    bio: (r.bio as string) ?? null,
    avatarUrl: (r.avatar_url as string) ?? null,
    createdAt: r.created_at as string,
  };
}

export async function getWall(profileId: string): Promise<WallPost[]> {
  // wall_posts has two FKs to profiles — disambiguate the embed to the author FK.
  const rows = await pg(
    `wall_posts?profile_id=eq.${profileId}` +
    `&select=id,body,created_at,author_id,author:profiles!wall_posts_author_id_fkey(username,role,title)` +
    `&order=created_at.desc&limit=500`,
  );
  return rows.map((r) => ({
    id: r.id as string,
    body: r.body as string,
    createdAt: r.created_at as string,
    authorId: r.author_id as string,
    author: author(r.author),
  }));
}
