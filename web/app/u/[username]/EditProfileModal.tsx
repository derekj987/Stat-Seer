"use client";

// One "Edit profile" button → a modal that edits cover, avatar, bio, and favorite teams in a single
// place (replacing the scattered inline pencils). Avatar/cover upload + save immediately (reusing
// AvatarUpload/CoverUpload); bio + teams save together on "Save changes".
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import AvatarUpload from "./AvatarUpload";
import CoverUpload from "./CoverUpload";
import { NFL_TEAMS } from "@/lib/nflTeams";

const BIO_MAX = 500;
const TEAM_MAX = 6;

export default function EditProfileModal({ userId, username, avatarUrl, coverUrl, bio, teams }: {
  userId: string;
  username: string;
  avatarUrl: string | null;
  coverUrl: string | null;
  bio: string | null;
  teams: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [bioText, setBioText] = useState(bio ?? "");
  const [sel, setSel] = useState<string[]>(teams);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy]);

  function toggleTeam(abbr: string) {
    setSel((s) => s.includes(abbr) ? s.filter((x) => x !== abbr) : (s.length >= TEAM_MAX ? s : [...s, abbr]));
  }

  async function save() {
    setBusy(true); setErr("");
    const c = createClient();
    // Bio first, so it still saves even if the favorite_teams column isn't migrated yet.
    const r1 = await c.from("profiles").update({ bio: bioText.trim() || null }).eq("id", userId);
    if (r1.error) { setBusy(false); setErr(r1.error.message); return; }
    const r2 = await c.from("profiles").update({ favorite_teams: sel }).eq("id", userId);
    setBusy(false);
    if (r2.error) {
      setErr(/favorite_teams|column|does not exist/.test(r2.error.message)
        ? "Bio saved. Run ingest/favorite_teams.sql to enable favorite teams." : r2.error.message);
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button type="button" className="pbtn pbtn--edit" onClick={() => setOpen(true)}>✎ Edit profile</button>

      {open && (
        <div className="epm" role="dialog" aria-modal="true" aria-label="Edit profile"
          onClick={() => { if (!busy) setOpen(false); }}>
          <div className="epm__panel" onClick={(e) => e.stopPropagation()}>
            <div className="epm__hd">
              <h2 className="epm__title">Edit profile</h2>
              <button type="button" className="epm__x" onClick={() => setOpen(false)} disabled={busy} aria-label="Close">×</button>
            </div>

            <div className="epm__body">
              {/* Cover */}
              <section className="epm__sec">
                <span className="epm__label">Cover photo</span>
                <div className="epm__cover">
                  {coverUrl
                    ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={coverUrl} alt="" />
                    : <div className="epm__cover-grad" aria-hidden="true" />}
                  <div className="epm__cover-btn"><CoverUpload userId={userId} /></div>
                </div>
              </section>

              {/* Avatar */}
              <section className="epm__sec epm__sec--row">
                <div className="epm__avatar">
                  {avatarUrl
                    ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={avatarUrl} alt="" />
                    : <span>{username.charAt(0).toUpperCase()}</span>}
                </div>
                <div className="epm__rowmain">
                  <span className="epm__label">Profile photo</span>
                  <AvatarUpload userId={userId} />
                </div>
              </section>

              {/* Bio */}
              <section className="epm__sec">
                <span className="epm__label">Bio</span>
                <textarea className="composer__body" rows={3} maxLength={BIO_MAX} value={bioText}
                  placeholder="A line or two about you…" onChange={(e) => setBioText(e.target.value)} />
                <span className="epm__count">{bioText.length}/{BIO_MAX}</span>
              </section>

              {/* Favorite teams */}
              <section className="epm__sec">
                <span className="epm__label">🏈 Favorite teams <span className="epm__sub">{sel.length}/{TEAM_MAX}</span></span>
                <div className="fteams__grid">
                  {NFL_TEAMS.map((t) => {
                    const on = sel.includes(t.abbr);
                    return (
                      <button key={t.abbr} type="button" className={on ? "fteams__opt on" : "fteams__opt"}
                        onClick={() => toggleTeam(t.abbr)} disabled={!on && sel.length >= TEAM_MAX} aria-pressed={on}>
                        <span className="fteam__dot" style={{ background: t.color }} aria-hidden="true" />
                        <span className="fteams__abbr">{t.abbr}</span> {t.name}
                      </button>
                    );
                  })}
                </div>
              </section>

              {err && <p className="paccent__err">{err}</p>}
            </div>

            <div className="epm__foot">
              <button type="button" className="pbtn pbtn--ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
              <button type="button" className="btn btn--primary" onClick={save} disabled={busy}>
                {busy ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
