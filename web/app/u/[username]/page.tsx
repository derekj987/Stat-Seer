import { notFound, redirect } from "next/navigation";
import { getProfileByUsername, getWall, getFriends, getStoriesForCircle, getProfileStats, getFriendIds, getFollowStats } from "@/lib/profile";
import FollowButton from "./FollowButton";
import { createClient } from "@/lib/supabase/server";
import { AuthorTag } from "../../forum/AuthorTag";
import EditBio from "./EditBio";
import AvatarUpload from "./AvatarUpload";
import CoverUpload from "./CoverUpload";
import WallForm from "./WallForm";
import WallActions from "./WallActions";
import WallSlipCard from "./WallSlipCard";
import FriendButton from "./FriendButton";
import StoriesRail from "./StoriesRail";
import SuggestedFriends from "./SuggestedFriends";
import MessageButton from "./MessageButton";
import ProfileTabs from "./ProfileTabs";
import RichText from "./RichText";
import FavoriteTeams from "./FavoriteTeams";
import PostReactions from "./PostReactions";
import PostComments from "./PostComments";
import PhotoGrid from "./PhotoGrid";
import type { CSSProperties } from "react";

export const dynamic = "force-dynamic";

const since = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });
const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const when = (iso: string) => fmt.format(new Date(iso)) + " ET";

export default async function ProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const profile = await getProfileByUsername(username);
  if (!profile) notFound();

  let me: { id: string; role: string } | null = null;
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: prof } = await supabase.from("profiles").select("role").eq("id", user.id).single();
      me = { id: user.id, role: (prof?.role as string) ?? "member" };
    }
  } catch { /* auth env not configured (local dev) — render as a signed-out visitor */ }
  // Profiles are members-only (the proxy gate also enforces this); never expose to a visitor.
  // Gate only where auth is actually configured (prod) — local dev has no client auth env.
  if (!me && process.env.NEXT_PUBLIC_SUPABASE_URL) redirect("/login");

  const [wall, friends, stats] = await Promise.all([
    getWall(profile.id, me?.id), getFriends(profile.id), getProfileStats(profile.id),
  ]);
  const stories = await getStoriesForCircle(profile.id, friends.map((f) => f.id));
  const isOwner = me?.id === profile.id;
  const initial = profile.username.charAt(0).toUpperCase();

  // Mutual friends (only meaningful when a signed-in non-owner views the profile).
  let mutual = 0;
  if (me && !isOwner) {
    const mine = new Set(await getFriendIds(me.id));
    mutual = friends.filter((f) => mine.has(f.id)).length;
  }

  const follow = await getFollowStats(profile.id, me?.id);
  const accentStyle = profile.accentColor ? ({ "--paccent": profile.accentColor } as CSSProperties) : undefined;

  return (
    <main className="pmain" style={accentStyle}>
      {/* ---- Cover ---- */}
      <div className="pcover">
        {profile.coverUrl
          ? /* eslint-disable-next-line @next/next/no-img-element */
            <img src={profile.coverUrl} alt="" className="pcover__img" />
          : <div className="pcover__grad" aria-hidden="true" />}
        {isOwner && <CoverUpload userId={profile.id} />}
      </div>

      {/* ---- Identity header ---- */}
      <header className="phead2">
        <div className="phead2__avatarwrap">
          <div className="pavatar pavatar--lg">
            {profile.avatarUrl
              ? /* eslint-disable-next-line @next/next/no-img-element */
                <img src={profile.avatarUrl} alt={profile.username} className="pavatar__img" />
              : <span className="pavatar__ini" aria-hidden="true">{initial}</span>}
          </div>
          {isOwner && <AvatarUpload userId={profile.id} />}
        </div>
        <div className="phead2__id">
          <h1 className={profile.role === "founder" ? "phead__name founder" : "phead__name"}>
            {profile.username}
          </h1>
          {/* Title tag under the name: "The Creator" (or any custom title) replaces the
              universal "Beta Tester" badge for members who have one. */}
          <div className="phead2__tags"><span className="beta-tag">{profile.title ?? "Beta Tester"}</span></div>
          <p className="phead__meta">
            Member since {since.format(new Date(profile.createdAt))}
            {mutual > 0 && <span className="phead2__mutual"> · {mutual} mutual friend{mutual === 1 ? "" : "s"}</span>}
          </p>
          <div className="pstats">
            <span className="pstat"><b>{follow.followers}</b> followers</span>
            <span className="pstat"><b>{follow.following}</b> following</span>
            <span className="pstat"><b>{stats.friends}</b> friends</span>
            <span className="pstat"><b>{stats.wallPosts}</b> posts</span>
          </div>
        </div>
        {!isOwner && me && (
          <div className="phead2__actions">
            <FollowButton profileId={profile.id} viewerId={me.id} initialFollowing={follow.viewerFollows} />
            <FriendButton profileId={profile.id} />
            <MessageButton userId={profile.id} username={profile.username} />
          </div>
        )}
      </header>

      <StoriesRail stories={stories} isOwner={isOwner} />

      {/* ---- Friends circle: a quick avatar strip right under the stories ---- */}
      {friends.length > 0 && (
        <section className="pfrail" aria-label="Friends">
          <div className="pfrail__hd">
            <h2 className="pfrail__h">Friends</h2>
            <span className="pfrail__n">{stats.friends}</span>
          </div>
          <ul className="pfrail__list">
            {friends.map((f) => (
              <li key={f.id}>
                <a className="pfrail__item" href={`/u/${encodeURIComponent(f.username)}`}>
                  <span className="pfrail__avwrap">
                    <span className="pfrail__av">
                      {f.avatarUrl
                        ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={f.avatarUrl} alt="" />
                        : f.username.charAt(0).toUpperCase()}
                    </span>
                    {f.online && <span className="pfrail__dot" title="Online" />}
                  </span>
                  <span className={f.role === "founder" ? "pfrail__name founder" : "pfrail__name"}>{f.username}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      {isOwner && (
        <section className="pcard pfrail__suggest">
          <h2 className="pcard__h">People you may know</h2>
          <SuggestedFriends />
        </section>
      )}

      {/* ---- Tabs: modern content organization instead of one long wall ---- */}
      <ProfileTabs
        tabs={[
          {
            key: "feed", label: "Feed", count: stats.wallPosts,
            node: (
              <section className="pcard">
                <WallForm profileId={profile.id} ownName={isOwner ? profile.username : null} />
                {wall.length === 0 ? (
                  <p className="pcard__empty">
                    No posts yet.{" "}
                    {isOwner ? "Share a pick or a thought — your feed is public." : `Be the first to write on ${profile.username}'s feed.`}
                  </p>
                ) : (
                  <div className="wall__list">
                    {wall.map((p) => (
                      <article key={p.id} className="wpost">
                        <div className="wpost__head">
                          <AuthorTag author={p.author} />
                          <time className="wpost__time">{when(p.createdAt)}</time>
                          <WallActions postId={p.id} authorId={p.authorId} profileId={profile.id} me={me} />
                        </div>
                        {p.body && <div className="wpost__body"><RichText text={p.body} /></div>}
                        {p.media.length > 0 && <PhotoGrid urls={p.media} variant="post" />}
                        {p.slip && p.slip.length > 0 && <WallSlipCard items={p.slip} />}
                        <footer className="wpost__foot">
                          <PostReactions postId={p.id} viewerId={me?.id ?? null} initial={p.reactions} />
                          <PostComments postId={p.id} profileId={profile.id} me={me} initial={p.comments} />
                        </footer>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            ),
          },
          {
            key: "about", label: "About",
            node: (
              <div className="pabout">
                <section className="pcard">
                  <h2 className="pcard__h">Intro</h2>
                  <ul className="pintro">
                    <li><span className="pintro__i" aria-hidden="true">📅</span> Joined {since.format(new Date(profile.createdAt))}</li>
                    <li><span className="pintro__i" aria-hidden="true">👥</span> {stats.friends} friend{stats.friends === 1 ? "" : "s"} · {stats.wallPosts} post{stats.wallPosts === 1 ? "" : "s"}</li>
                    {mutual > 0 && <li><span className="pintro__i" aria-hidden="true">🤝</span> {mutual} mutual friend{mutual === 1 ? "" : "s"}</li>}
                    <li className="pintro__soon"><span className="pintro__i" aria-hidden="true">📊</span> Public track record — coming with the season</li>
                  </ul>
                </section>
                <section className="pcard">
                  <h2 className="pcard__h">🏈 Favorite teams</h2>
                  <FavoriteTeams userId={profile.id} teams={profile.favoriteTeams} canEdit={!!isOwner} />
                </section>
                <section className="pcard">
                  <h2 className="pcard__h">About</h2>
                  <EditBio userId={profile.id} bio={profile.bio} canEdit={!!isOwner} />
                </section>
              </div>
            ),
          },
          {
            key: "media", label: "Media", count: wall.reduce((n, p) => n + p.media.length, 0) || undefined,
            node: (() => {
              const photos = wall.flatMap((p) => p.media);
              return (
                <section className="pcard">
                  <h2 className="pcard__h">Media {photos.length > 0 && <span className="pcard__count">{photos.length}</span>}</h2>
                  {photos.length === 0 ? (
                    <p className="pcard__empty">
                      No photos yet.{isOwner ? " Photos you add to a post show up here." : ""}
                    </p>
                  ) : (
                    <PhotoGrid urls={photos} variant="gallery" />
                  )}
                </section>
              );
            })(),
          },
        ]}
      />
    </main>
  );
}
