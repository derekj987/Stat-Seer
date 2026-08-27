import { notFound } from "next/navigation";
import { getProfileByUsername, getWall, getFriends, getStoriesForCircle } from "@/lib/profile";
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

export const dynamic = "force-dynamic";

const since = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });
const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const when = (iso: string) => fmt.format(new Date(iso)) + " ET";

export default async function ProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const profile = await getProfileByUsername(username);
  if (!profile) notFound();

  const [wall, friends] = await Promise.all([getWall(profile.id), getFriends(profile.id)]);
  const stories = await getStoriesForCircle(profile.id, friends.map((f) => f.id));

  let me: { id: string; role: string } | null = null;
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: prof } = await supabase.from("profiles").select("role").eq("id", user.id).single();
      me = { id: user.id, role: (prof?.role as string) ?? "member" };
    }
  } catch { /* auth env not configured (local dev) — render as a signed-out visitor */ }
  const isOwner = me?.id === profile.id;
  const initial = profile.username.charAt(0).toUpperCase();

  return (
    <main className="pmain">
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
            {profile.title && <span className="phead__title">{profile.title}</span>}
          </h1>
          <p className="phead__meta">
            {friends.length > 0 && <span className="phead2__fc">{friends.length} friend{friends.length === 1 ? "" : "s"} · </span>}
            Member since {since.format(new Date(profile.createdAt))}
          </p>
        </div>
        <div className="phead2__actions">
          <FriendButton profileId={profile.id} />
        </div>
      </header>

      <StoriesRail stories={stories} isOwner={isOwner} />

      {/* ---- Two-column body ---- */}
      <div className="pbody">
        <aside className="pcol pcol--side">
          <section className="pcard">
            <h2 className="pcard__h">About</h2>
            <EditBio userId={profile.id} bio={profile.bio} canEdit={!!isOwner} />
          </section>

          <section className="pcard">
            <h2 className="pcard__h">Friends {friends.length > 0 && <span className="pcard__count">{friends.length}</span>}</h2>
            {friends.length === 0 ? (
              <p className="pcard__empty">No friends yet.</p>
            ) : (
              <ul className="pfriends">
                {friends.map((f) => (
                  <li key={f.id}>
                    <a className="pfriend" href={`/u/${f.username}`}>
                      <span className="pfriend__avwrap">
                        <span className="pfriend__av">
                          {f.avatarUrl
                            ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={f.avatarUrl} alt="" />
                            : f.username.charAt(0).toUpperCase()}
                        </span>
                        {f.online && <span className="pfriend__dot" title="Online" />}
                      </span>
                      <span className={f.role === "founder" ? "pfriend__name founder" : "pfriend__name"}>{f.username}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {isOwner && (
            <section className="pcard">
              <h2 className="pcard__h">People you may know</h2>
              <SuggestedFriends />
            </section>
          )}
        </aside>

        <div className="pcol pcol--main">
          <section className="pcard">
            <h2 className="pcard__h">Wall</h2>
            <WallForm profileId={profile.id} ownName={isOwner ? profile.username : null} />
            {wall.length === 0 ? (
              <p className="pcard__empty">
                No posts yet.{" "}
                {isOwner ? "Your wall is public — anyone can leave a note here." : `Be the first to write on ${profile.username}'s wall.`}
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
                    {p.body && <div className="wpost__body">{p.body}</div>}
                    {p.slip && p.slip.length > 0 && <WallSlipCard items={p.slip} />}
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
