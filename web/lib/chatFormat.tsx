import React from "react";

// Lightweight inline formatting for chat messages: **bold**, *italic*, `code`, ~~strike~~,
// and auto-linked URLs. No external markdown dependency — a single-pass tokenizer over the
// escaped text, so user input can never inject markup. Non-nested (good enough for chat).

const TOKEN = /(\*\*[^*]+\*\*|(?<!\*)\*(?!\s)[^*]+\*|`[^`]+`|~~[^~]+~~|https?:\/\/[^\s]+)/g;

export function formatMessage(text: string): React.ReactNode {
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const key = `f${i++}`;
    if (t.startsWith("**")) out.push(<b key={key}>{t.slice(2, -2)}</b>);
    else if (t.startsWith("~~")) out.push(<s key={key}>{t.slice(2, -2)}</s>);
    else if (t.startsWith("`")) out.push(<code key={key} className="cw-code">{t.slice(1, -1)}</code>);
    else if (t.startsWith("*")) out.push(<i key={key}>{t.slice(1, -1)}</i>);
    else out.push(
      <a key={key} href={t} target="_blank" rel="noopener noreferrer" className="cw-link">{t}</a>
    );
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// Wrap the current textarea selection (or caret) with a marker for a formatting button.
export function wrapSelection(el: HTMLInputElement | HTMLTextAreaElement, marker: string): string {
  const { selectionStart, selectionEnd, value } = el;
  const s = selectionStart ?? value.length;
  const e = selectionEnd ?? value.length;
  const sel = value.slice(s, e) || "text";
  const next = value.slice(0, s) + marker + sel + marker + value.slice(e);
  // Restore a sensible selection after React re-renders.
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(s + marker.length, s + marker.length + sel.length);
  });
  return next;
}

// A compact, curated emoji palette for the picker (common reactions + sports).
export const EMOJIS = [
  "😀", "😂", "🤣", "😅", "😊", "😍", "😎", "🤔", "😬", "😴",
  "👍", "👎", "🙌", "👏", "🙏", "🤝", "💪", "🔥", "💯", "⚡",
  "🎉", "🥳", "😤", "😭", "😱", "🤯", "🫡", "🤑", "💸", "💰",
  "🏈", "🎯", "📈", "📉", "🧊", "🏆", "🐐", "🤞", "🍀", "🫰",
];
