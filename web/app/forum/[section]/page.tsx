import { notFound } from "next/navigation";
import { sectionBySlug, listThreads } from "@/lib/forum";
import { Brand } from "../../Nav";
import { AuthorTag } from "../AuthorTag";

export const dynamic = "force-dynamic";

const fmt = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});
const when = (iso: string) => fmt.format(new Date(iso)) + " ET";

export default async function SectionPage({ params }: PageProps<"/forum/[section]">) {
  const { section } = await params;
  const sec = sectionBySlug(section);
  if (!sec) notFound();
  const threads = await listThreads(section);

  return (
    <main className="wrap">
      <header className="masthead">
        <Brand sub={`Community · ${sec.name}`} />
      </header>

      <nav className="crumbs"><a href="/forum">Community</a><span>›</span>{sec.name}</nav>

      <div className="secthead">
        <div>
          <h1 className="secthead__h">{sec.name}</h1>
          <p className="secthead__d">{sec.desc}</p>
        </div>
        <a href={`/forum/${section}/new`} className="btn btn--primary">New thread</a>
      </div>

      {threads.length === 0 ? (
        <p className="foot">No threads yet — <a href={`/forum/${section}/new`}>start the first one</a>.</p>
      ) : (
        <div className="fthreads">
          {threads.map((t) => (
            <a key={t.id} href={`/forum/${section}/${t.id}`} className="fthread">
              <span className="fthread__title">{t.title}</span>
              <span className="fthread__meta">
                <AuthorTag author={t.author} plain />
                <span className="fthread__sep">·</span>
                {t.replyCount} {t.replyCount === 1 ? "reply" : "replies"}
                <span className="fthread__sep">·</span>
                {when(t.lastReplyAt)}
              </span>
            </a>
          ))}
        </div>
      )}
    </main>
  );
}
