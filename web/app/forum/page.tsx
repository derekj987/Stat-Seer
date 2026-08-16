import { createClient } from "@/lib/supabase/server";
import { SECTIONS } from "@/lib/forum";

export const dynamic = "force-dynamic";

export default async function Forum() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const username = (data.user?.user_metadata?.username as string) ?? null;

  return (
    <main className="wrap">
      <header className="masthead">
        <div className="brand">
          <a href="/" className="brand__marklink"><span className="brand__mark">STATSEER</span></a>
        </div>
      </header>

      <div className="forumlayout">
        <aside className="forumside">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/forum-side.jpg?v=2" alt="" className="forumside__img" />
        </aside>

        <div className="forummain">
          <section className="forumhead">
            <h1 className="forumhead__h">Community</h1>
            {username
              ? <p className="forumhead__p">Welcome, <b>{username}</b>. Pick a room to jump in.</p>
              : <p className="forumhead__p">Read freely. <a href="/signup">Create an account</a> or <a href="/login">log in</a> to post.</p>}
          </section>

          <section className="forumsections">
            {SECTIONS.map((s) => (
              <a key={s.slug} href={`/forum/${s.slug}`} className="forumsec">
                <span className="forumsec__name">{s.name}</span>
                <span className="forumsec__desc">{s.desc}</span>
              </a>
            ))}
          </section>
        </div>
      </div>
    </main>
  );
}
