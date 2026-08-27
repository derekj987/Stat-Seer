"use client";

// The AI slip assistant's interactive core — used both on the /assistant page and inside
// the floating gold chat bubble. Members-only. Two ways to build a slip from the week's
// real, priced board: a free "Quick menu" (deterministic) and "Ask in words" (Claude).
import { useEffect, useState } from "react";
import { useSlip, type SlipItem } from "@/lib/slip";
import { createClient } from "@/lib/supabase/client";
import { fmtOdds, bookName } from "@/lib/slipPricing";

type Result = { legs: SlipItem[]; combined: { american: string; decimal: number } | null; note: string };
type Opt = { mkt: string; label: string; og: "Game lines" | "Player props" };

// Every bet type is its own checkbox, so a slip can mix markets (e.g. rec yds + rush yds + TD).
const OPTS: Opt[] = [
  { mkt: "spread", label: "Spreads", og: "Game lines" },
  { mkt: "total", label: "Totals", og: "Game lines" },
  { mkt: "moneyline", label: "Moneylines", og: "Game lines" },
  { mkt: "player_anytime_td", label: "Anytime TD scorers", og: "Player props" },
  { mkt: "player_pass_yds", label: "QB passing yards", og: "Player props" },
  { mkt: "player_pass_tds", label: "QB passing TDs", og: "Player props" },
  { mkt: "player_rush_yds", label: "Rushing yards", og: "Player props" },
  { mkt: "player_rush_attempts", label: "Rush attempts", og: "Player props" },
  { mkt: "player_reception_yds", label: "Receiving yards", og: "Player props" },
  { mkt: "player_receptions", label: "Receptions", og: "Player props" },
];
const OGROUPS: Array<"Game lines" | "Player props"> = ["Game lines", "Player props"];
type SportId = "nfl" | "ncaaf";
const SPORTS: { id: SportId; label: string; sub: string }[] = [
  { id: "nfl", label: "NFL", sub: "Pro football" },
  { id: "ncaaf", label: "NCAAF", sub: "College football" },
];
// NCAAF has no per-book moneyline capture yet, so that market is hidden for college.
const MKT_UNAVAILABLE: Record<SportId, Set<string>> = { nfl: new Set(), ncaaf: new Set(["moneyline"]) };
const EXAMPLES_BY_SPORT: Record<SportId, string[]> = {
  nfl: [
    "What are the off-consensus picks this week? Add those to my slip.",
    "Make me a 4-leg anytime-TD parlay of the model's highest-% scorers this week.",
    "Build a 4-leg parlay around +1500 using only game spreads and totals.",
  ],
  ncaaf: [
    "What are the off-consensus picks this week? Add those to my slip.",
    "Make me a 4-leg anytime-TD parlay of this weekend's likeliest scorers.",
    "Build a 4-leg parlay around +2500 using props and game lines.",
  ],
};
const TARGETS = [
  { v: 0, label: "Any odds" }, { v: 300, label: "≈ +300" }, { v: 500, label: "≈ +500" },
  { v: 1000, label: "≈ +1000" }, { v: 1500, label: "≈ +1500" }, { v: 2500, label: "≈ +2500" },
  { v: 3500, label: "≈ +3500" }, { v: 5000, label: "≈ +5000" }, { v: 7500, label: "≈ +7500" },
  { v: 10000, label: "≈ +10000" },
];

export default function AssistantPanel() {
  const { addMany } = useSlip();
  const [me, setMe] = useState<boolean | null | undefined>(undefined);
  const [sport, setSport] = useState<SportId | null>(null);
  const [tab, setTab] = useState<"menu" | "text">("menu");
  const [selected, setSelected] = useState<string[]>(["spread", "total"]);
  const [legs, setLegs] = useState(4);
  const [target, setTarget] = useState(0);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) { setMe(null); return; }
    createClient().auth.getUser().then(({ data }) => setMe(!!data.user));
  }, []);

  async function build(payload: object) {
    setLoading(true); setError(""); setResult(null); setAdded(false);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      setResult(data as Result);
    } catch {
      setError("Something went wrong building that slip. Try again.");
    } finally {
      setLoading(false);
    }
  }

  const onlyTd = selected.length === 1 && selected[0] === "player_anytime_td";
  const toggle = (m: string) => setSelected((s) => (s.includes(m) ? s.filter((x) => x !== m) : [...s, m]));
  const runMenu = () => build({ mode: "menu", sport, markets: selected, rankByModel: onlyTd, legs, targetOdds: onlyTd ? null : (target || null) });
  const runText = () => prompt.trim() && build({ mode: "text", sport, prompt: prompt.trim() });
  const reset = () => { setResult(null); setAdded(false); setError(""); };
  const pickSport = (s: SportId) => { setSport(s); setSelected(["spread", "total"]); setResult(null); setError(""); setPrompt(""); };
  const opts = sport ? OPTS.filter((o) => !MKT_UNAVAILABLE[sport].has(o.mkt)) : OPTS;
  const examples = EXAMPLES_BY_SPORT[sport ?? "nfl"];

  if (me === null) {
    return <p className="asst__lock">This is a member feature. <a href="/login">Log in</a> or <a href="/signup">create an account</a> to build slips with the assistant.</p>;
  }

  // Step 1 — always pick the sport first. Everything below is scoped to this sport.
  if (!sport && !result) {
    return (
      <div className="asst__sportpick">
        <p className="asst__sporth">Which sport?</p>
        <div className="asst__sports">
          {SPORTS.map((s) => (
            <button key={s.id} className="asst__sport" onClick={() => pickSport(s.id)}>
              <span className="asst__sportl">{s.label}</span>
              <span className="asst__sports2">{s.sub}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Once the assistant responds, show ONLY the response (hide the inputs) + a Start over
  // button. A response with legs is a slip; a response with none is a conversational reply.
  if (result) {
    const hasSlip = result.legs.length > 0;
    return (
      <div className="asst__result asst__result--solo">
        <div className="asst__resulthd">
          <span className="asst__resh">{hasSlip ? "Your slip" : "Assistant"}</span>
          <button className="asst__startover" onClick={reset}>↺ Start over</button>
        </div>
        {result.note && <p className="asst__note">{result.note}</p>}
        {hasSlip && (
          <>
            <ul className="asst__legs">
              {result.legs.map((l) => (
                <li key={l.id} className="asst__leg">
                  <span className="asst__legt">{l.title}</span>
                  {l.detail && <span className="asst__legd">{l.detail}</span>}
                  {l.price !== undefined && <span className="asst__odds">{fmtOdds(l.price)}</span>}
                  {l.books?.length ? <span className="asst__book">{l.books.map(bookName).join(" / ")}</span> : null}
                </li>
              ))}
            </ul>
            {result.combined && (
              <p className="asst__combined">Parlay price: <b>{result.combined.american}</b> across {result.legs.length} legs.</p>
            )}
            <div className="asst__act">
              {added ? (
                <a href="/lines" className="btn btn--primary">Added ✓ — open Value Finder →</a>
              ) : (
                <button className="btn btn--primary" onClick={() => { addMany(result.legs); setAdded(true); }}>Add all to my slip</button>
              )}
            </div>
            <p className="asst__disc">Assembled from published numbers — <b>not a StatSeer pick and not betting advice</b>. Confirm every price in Value Finder and do your own research.</p>
          </>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="asst__sportbar">
        <span className="asst__sportchip">{SPORTS.find((s) => s.id === sport)?.label}</span>
        <button className="asst__sportswap" onClick={() => setSport(null)}>Change sport</button>
      </div>
      <div className="asst__tabs" role="tablist">
        <button className={tab === "menu" ? "asst__tab active" : "asst__tab"} onClick={() => setTab("menu")}>Quick menu</button>
        <button className={tab === "text" ? "asst__tab active" : "asst__tab"} onClick={() => setTab("text")}>Ask in words</button>
      </div>

      {tab === "menu" ? (
        <div className="asst__panel">
          <div className="asst__field asst__field--full">Bet types <span className="asst__hint">— pick any mix</span>
            <div className="asst__checks">
              {OGROUPS.map((og) => (
                <div className="asst__checkgrp" key={og}>
                  <span className="asst__checkog">{og}</span>
                  {opts.filter((o) => o.og === og).map((o) => (
                    <label className={selected.includes(o.mkt) ? "asst__check on" : "asst__check"} key={o.mkt}>
                      <input type="checkbox" checked={selected.includes(o.mkt)} onChange={() => toggle(o.mkt)} />
                      <span>{o.label}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div className="asst__row">
            <label className="asst__field">Legs
              <select value={legs} onChange={(e) => setLegs(Number(e.target.value))}>
                {[2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            {!onlyTd && (
              <label className="asst__field">Target payout
                <select value={target} onChange={(e) => setTarget(Number(e.target.value))}>
                  {TARGETS.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
                </select>
              </label>
            )}
          </div>
          <button className="btn btn--primary asst__go" onClick={runMenu} disabled={loading || !selected.length}>{loading ? "Building…" : "Build my slip"}</button>
        </div>
      ) : (
        <div className="asst__panel asst__panel--text">
          <textarea className="asst__ta" rows={3} maxLength={600} value={prompt} placeholder="e.g. a 4-leg +1500 parlay of spreads and totals…"
            onChange={(e) => setPrompt(e.target.value)} />
          <div className="asst__egs">
            {examples.map((ex) => <button key={ex} className="asst__eg" onClick={() => setPrompt(ex)}>{ex}</button>)}
          </div>
          <button className="btn btn--primary asst__go" onClick={runText} disabled={loading || !prompt.trim()}>{loading ? "Thinking…" : "Build my slip"}</button>
        </div>
      )}

      {error && <p className="asst__err">{error}</p>}
    </>
  );
}
