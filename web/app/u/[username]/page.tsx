import { notFound } from "next/navigation";
import { getProfileByUsername, getWall } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { AuthorTag } from "../../forum/AuthorTag";
import EditBio from "./EditBio";
import AvatarUpload from "./AvatarUpload";
import WallForm from "./WallForm";
import WallActions from "./WallActions";

export const dynamic = "force-dynamic";

const since = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });
const fmt = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});
const when = (iso: string) => fmt.format(new Date(iso)) + " ET";

export default async function ProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const profile = await getProfileByUsername(username);
  if (!profile) notFound();
  const wall = await getWall(profile.id);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  let me: { id: string; role: string } | null = null;
  if (user) {
    const { data: prof } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    me = { id: user.id, role: (prof?.role as string) ?? "member" };
  }
  const isOwner = me?.id === profile.id;
  const initial = profile.username.charAt(0).toUpperCase();

  return (
    <main className="wrap">
      <nav className="crumbs">
        <a href="/forum">Community</a><span>›</span>
        <span>{profile.username}</span>
      </nav>

      <header className="phead">
        <div className="phead__avatarwrap">
          <div className="pavatar">
            {profile.avatarUrl
              ? /* eslint-disable-next-line @next/next/no-img-element */
                <img src={profile.avatarUrl} alt={profile.username} className="pavatar__img" />
              : <span className="pavatar__ini" aria-hidden="true">{initial}</span>}
          </div>
          {isOwner && <AvatarUpload userId={profile.id} />}
        </div>

        <div className="phead__id">
          <h1 className={profile.role === "founder" ? "phead__name founder" : "phead__name"}>
            {profile.username}
            {profile.title && <span className="phead__title">{profile.title}</span>}
          </h1>
          <p className="phead__meta">
            {profile.role !== "member" && profile.role !== "founder" &&
              <span className="phead__role">{profile.role}</span>}
            Member since {since.format(new Date(profile.createdAt))}
          </p>
          <EditBio userId={profile.id} bio={profile.bio} canEdit={!!isOwner} />
        </div>
      </header>

      <section className="wall">
        <h2 className="wall__h">Wall</h2>
        <WallForm profileId={profile.id} ownName={isOwner ? profile.username : null} />
        {wall.length === 0 ? (
          <p className="wall__empty">
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
                <div className="wpost__body">{p.body}</div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* Static banner across the bottom — the arena (a shared default; per-user later). */}
      <div className="pbottombanner" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/profile-cover.jpg" alt="" className="pbottombanner__img" />
      </div>
    </main>
  );
}
