"use client";

// Favorite NFL teams on a profile: color-chip display, plus an owner-only picker that toggles teams
// and saves to profiles.favorite_teams. Mirrors AccentPicker's save pattern (Supabase update with a
// graceful "run the migration" fallback). Team COLORS, not logos, to avoid the trademark issue.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { NFL_TEAMS, NFL_TEAM } from "@/lib/nflTeams";

const MAX = 6;

function Chip({ abbr }: { abbr: string }) {
  const t = NFL_TEAM.get(abbr);
  if (!t) return null;
  return (
    <span className="fteam">
      <span className="fteam__dot" style={{ background: t.color }} aria-hidden="true" />
      {t.name}
    </span>
  );
}

export default function FavoriteTeams({ userId, teams, canEdit }: { userId: string; teams: string[]; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [sel, setSel] = useState<string[]>(teams);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  function toggle(abbr: string) {
    setSel((s) => s.includes(abbr) ? s.filter((x) => x !== abbr) : (s.length >= MAX ? s : [...s, abbr]));
  }

  async function save() {
    setBusy(true); setErr("");
    const { error } = await createClient().from("profiles").update({ favorite_teams: sel }).eq("id", userId);
    setBusy(false);
    if (error) {
      setErr(/favorite_teams/.test(error.message) ? "Run ingest/favorite_teams.sql in Supabase to enable this." : error.message);
      return;
    }
    setEditing(false);
    router.refresh();
  }

  if (!editing) {
    return (
      <div className="fteams">
        {teams.length === 0 ? (
          <p className="pcard__empty">{canEdit ? "Add the teams you follow." : "No favorite teams yet."}</p>
        ) : (
          <div className="fteams__list">{teams.map((a) => <Chip key={a} abbr={a} />)}</div>
        )}
        {canEdit && (
          <button type="button" className="pbtn pbtn--ghost fteams__edit" onClick={() => { setSel(teams); setEditing(true); }}>
            {teams.length === 0 ? "＋ Add teams" : "Edit teams"}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="fteams fteams--edit">
      <p className="fteams__hint">Pick up to {MAX} — {sel.length}/{MAX} selected</p>
      <div className="fteams__grid">
        {NFL_TEAMS.map((t) => {
          const on = sel.includes(t.abbr);
          return (
            <button key={t.abbr} type="button" className={on ? "fteams__opt on" : "fteams__opt"}
              onClick={() => toggle(t.abbr)} disabled={!on && sel.length >= MAX} aria-pressed={on}>
              <span className="fteam__dot" style={{ background: t.color }} aria-hidden="true" />
              <span className="fteams__abbr">{t.abbr}</span> {t.name}
            </button>
          );
        })}
      </div>
      {err && <p className="paccent__err">{err}</p>}
      <div className="fteams__actions">
        <button type="button" className="btn btn--primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        <button type="button" className="pbtn pbtn--ghost" onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}
