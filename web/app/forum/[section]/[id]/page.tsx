import { notFound } from "next/navigation";
import { sectionBySlug, getThread, getReplies } from "@/lib/forum";
import { createClient } from "@/lib/supabase/server";
import { AuthorTag } from "../../AuthorTag";
import ReplyForm from "./ReplyForm";
import PostActions from "./PostActions";

export const dynamic = "force-dynamic";

const fmt = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});
const when = (iso: string) => fmt.format(new Date(iso)) + " ET";

export default async function ThreadPage({ params }: PageProps<"/forum/[section]/[id]">) {
  const { section, id } = await params;
  const sec = sectionBySlug(section);
  if (!sec) notFound();
  const thread = await getThread(id);
  if (!thread) notFound();
  const replies = await getReplies(id);

  // who's viewing (for the delete/report buttons)
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  let me: { id: string; role: string } | null = null;
  if (user) {
    const { data: prof } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    me = { id: user.id, role: (prof?.role as string) ?? "member" };
  }

  return (
    <main className="wrap">
      <nav className="crumbs">
        <a href="/forum">Community</a><span>›</span>
        <a href={`/forum/${section}`}>{sec.name}</a>
      </nav>

      <article className="fpost fpost--op">
        <div className="fpost__head">
          <AuthorTag author={thread.author} />
          <time className="fpost__time">{when(thread.createdAt)}</time>
          <PostActions kind="thread" id={thread.id} authorId={thread.authorId} section={section} me={me} />
        </div>
        <h1 className="fpost__title">{thread.title}</h1>
        <div className="fpost__body">{thread.body}</div>
      </article>

      <h2 className="freplies__h">
        {replies.length} {replies.length === 1 ? "reply" : "replies"}
      </h2>
      <div className="freplies">
        {replies.map((r) => (
          <article key={r.id} className="fpost">
            <div className="fpost__head">
              <AuthorTag author={r.author} />
              <time className="fpost__time">{when(r.createdAt)}</time>
              <PostActions kind="reply" id={r.id} authorId={r.authorId} section={section} me={me} />
            </div>
            <div className="fpost__body">{r.body}</div>
          </article>
        ))}
      </div>

      <ReplyForm section={section} threadId={id} />
    </main>
  );
}
