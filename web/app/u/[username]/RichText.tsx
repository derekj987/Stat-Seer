import type { ReactNode } from "react";

// Minimal, SAFE inline markdown for feed posts: **bold**, _italic_, [text](url), "- " bullets, and
// line breaks. Rendered as React elements (never dangerouslySetInnerHTML), and link hrefs are
// restricted to http(s), so user text can never inject markup or a javascript: URL.
function inline(s: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|_([^_]+)_|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/g;
  let last = 0, key = 0, m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) out.push(s.slice(last, m.index));
    if (m[2] != null) out.push(<b key={key++}>{m[2]}</b>);
    else if (m[3] != null) out.push(<i key={key++}>{m[3]}</i>);
    else out.push(<a key={key++} href={m[5]} target="_blank" rel="noopener noreferrer nofollow">{m[4]}</a>);
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

export default function RichText({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <>
      {lines.map((line, i) => (
        <span key={i}>
          {line.startsWith("- ")
            ? <><span className="rt-bul" aria-hidden="true">•</span> {inline(line.slice(2))}</>
            : inline(line)}
          {i < lines.length - 1 && <br />}
        </span>
      ))}
    </>
  );
}
