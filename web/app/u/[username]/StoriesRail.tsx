"use client";

// Instagram-style story rail: a row of circles for the profile owner + their friends who
// have shared a betslip to their "story" in the last 24h. Tapping a circle opens the slip.
// (Members post a story from the Value Finder slip bar — "Add to story".)
import { useState } from "react";
import type { Story } from "@/lib/profile";
import WallSlipCard from "./WallSlipCard";

const ago = (iso: string) => {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return `${Math.max(1, m)}m ago`;
  return `${Math.floor(m / 60)}h ago`;
};

export default function StoriesRail({ stories, isOwner }: { stories: Story[]; isOwner: boolean }) {
  const [open, setOpen] = useState<Story | null>(null);
  if (!isOwner && stories.length === 0) return null;

  return (
    <section className="stories" aria-label="Stories">
      {isOwner && (
        <a className="story story--add" href="/lines" title="Share a slip to your story from the Value Finder bar">
          <span className="story__ring story__ring--add"><span className="story__plus" aria-hidden="true">＋</span></span>
          <span className="story__name">Your story</span>
        </a>
      )}
      {stories.map((s) => (
        <button className="story" key={s.userId} onClick={() => setOpen(s)}>
          <span className="story__ring">
            <span className="story__av">
              {s.avatarUrl
                ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={s.avatarUrl} alt="" />
                : s.username.charAt(0).toUpperCase()}
            </span>
          </span>
          <span className="story__name">{s.username}</span>
        </button>
      ))}

      {open && (
        <div className="storyview" role="dialog" aria-modal="true" onClick={() => setOpen(null)}>
          <div className="storyview__card" onClick={(e) => e.stopPropagation()}>
            <div className="storyview__hd">
              <span className="storyview__who"><b>{open.username}</b> · {ago(open.createdAt)}</span>
              <button className="storyview__x" onClick={() => setOpen(null)} aria-label="Close">✕</button>
            </div>
            {open.caption && <p className="storyview__cap">{open.caption}</p>}
            <WallSlipCard items={open.slip} />
          </div>
        </div>
      )}
    </section>
  );
}
