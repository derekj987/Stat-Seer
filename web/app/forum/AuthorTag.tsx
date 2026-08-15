import type { Author } from "@/lib/forum";

// `plain` renders a non-link span — use it where the tag sits inside another link
// (e.g. a thread-list row), since nested anchors are invalid HTML.
export function AuthorTag({ author, plain }: { author: Author | null; plain?: boolean }) {
  if (!author) return <span className="fauthor fauthor--gone">[deleted]</span>;
  const cls = author.role === "founder" ? "fauthor founder" : "fauthor";
  const inner = (
    <>
      {author.username}
      {author.title && <span className="fauthor__title">{author.title}</span>}
    </>
  );
  if (plain) return <span className={cls}>{inner}</span>;
  return <a href={`/u/${encodeURIComponent(author.username)}`} className={cls}>{inner}</a>;
}
