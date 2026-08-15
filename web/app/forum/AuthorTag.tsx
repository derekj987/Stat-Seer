import type { Author } from "@/lib/forum";

export function AuthorTag({ author }: { author: Author | null }) {
  if (!author) return <span className="fauthor fauthor--gone">[deleted]</span>;
  return (
    <span className={author.role === "founder" ? "fauthor founder" : "fauthor"}>
      {author.username}
      {author.title && <span className="fauthor__title">{author.title}</span>}
    </span>
  );
}
