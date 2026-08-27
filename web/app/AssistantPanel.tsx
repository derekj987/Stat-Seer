"use client";

// The AI slip assistant's interactive core — used both on the /assistant page and inside
// the floating gold chat bubble. Members-only. Two ways to build a slip from the week's
// real, priced board: a free "Quick menu" (deterministic) and "Ask in words" (Claude).
import { useEffect, useState } from "react";
import { useSlip, type SlipItem } from "@/lib/slip";
import { createClient } from "@/lib/supabase/client";
import { fmtOdds, bookName } from "@/lib/slipPricing";

type Result = { legs: SlipItem[]; combined: { american: string; decimal: number } | null; note: string };
type Opt = { v: string; label: string; markets: string[]; og: "Game lines" | "Player props"; rankByModel?: boolean };

const OPTS: Opt[] = [
  { v: "spread", label: "Spreads", markets: ["spread"], og: "Game lines" },
  { v: "total", label: "Totals", markets: ["total"], og: "Game lines" },
  { v: "st", label: "Spreads & totals", markets: ["spread", "total"], og: "Game lines" },
  { v: "td", label: "Anytime-TD scorers (by model %)", markets: ["player_anytime_td"], rankByModel: true, og: "Player props" },
  { v: "pass_yds", label: "QB passing yards", markets: ["player_pass_yds"], og: "Player props" },
  { v: "pass_tds", label: "QB passing TDs", markets: ["player_pass_tds"], og: "Player props" },
  { v: "rush_yds", label: "Rushing yards", markets: ["player_rush_yds"], og: "Player props" },
  { v: "rush_att", label: "Rush attempts", markets: ["player_rush_attempts"], og: "Player props" },
  { v: "rec_yds", label: "Receiving yards", markets: ["player_reception_yds"], og: "Player props" },
  { v: "receptions", label: "Receptions", markets: ["player_receptions"], og: "Player props" },
];
const OGROUPS: Array<"Game lines" | "Player props"> = ["Game lines", "Player props"];
const TARGETS = [
  { v: 0, label: "Any odds" }, { v: 300, label: "≈ +300" }, { v: 500, label: "≈ +500" },
  { v: 1000, label: "≈ +1000" }, { v: 1500, label: "≈ +1500" }, { v: 2500, label: "≈ +2500" },
];
const EXAMPLES = [
  "Make me a 4-leg anytime-TD parlay of the model's highest-% scorers this week.",
  "Build a 4-leg parlay around +1500 using only game spreads and totals.",
  "Give me a 3-leg slip of spreads the model likes most.",
];

export default function AssistantPanel() {
  const { addMany } = useSlip();
  const [me, setMe] = useState<boolean | null | undefined>(undefined);
  const [tab, setTab] = useState<"menu" | "text">("menu");
  const [kind, setKind] = useState<string>("st");
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

  const cur = OPTS.find((o) => o.v === kind) ?? OPTS[0];
  const runMenu = () => build({ mode: "menu", markets: cur.markets, rankByModel: !!cur.rankByModel, legs, targetOdds: cur.rankByModel ? null : (target || null) });
  const runText = () => prompt.trim() && build({ mode: "text", prompt: prompt.trim() });

  if (me === null) {
    return <p className="asst__lock">This is a member feature. <a href="/login">Log in</a> or <a href="/signup">create an account</a> to build slips with the assistant.</p>;
  }

  return (
    <>
      <div className="asst__tabs" role="tablist">
        <button className={tab === "menu" ? "asst__tab active" : "asst__tab"} onClick={() => setTab("menu")}>Quick menu</button>
        <button className={tab === "text" ? "asst__tab active" : "asst__tab"} onClick={() => setTab("text")}>Ask in words</button>
      </div>

      {tab === "menu" ? (
        <div className="asst__panel">
          <label className="asst__field">What kind?
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {OGROUPS.map((og) => (
                <optgroup key={og} label={og}>
                  {OPTS.filter((o) => o.og === og).map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="asst__field">Legs
            <select value={legs} onChange={(e) => setLegs(Number(e.target.value))}>
              {[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          {!cur.rankByModel && (
            <label className="asst__field">Target payout
              <select value={target} onChange={(e) => setTarget(Number(e.target.value))}>
                {TARGETS.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
              </select>
            </label>
          )}
          <button className="btn btn--primary asst__go" onClick={runMenu} disabled={loading}>{loading ? "Building…" : "Build my slip"}</button>
        </div>
      ) : (
        <div className="asst__panel asst__panel--text">
          <textarea className="asst__ta" rows={3} maxLength={600} value={prompt} placeholder="e.g. a 4-leg +1500 parlay of spreads and totals…"
            onChange={(e) => setPrompt(e.target.value)} />
          <div className="asst__egs">
            {EXAMPLES.map((ex) => <button key={ex} className="asst__eg" onClick={() => setPrompt(ex)}>{ex}</button>)}
          </div>
          <button className="btn btn--primary asst__go" onClick={runText} disabled={loading || !prompt.trim()}>{loading ? "Thinking…" : "Build my slip"}</button>
        </div>
      )}

      {error && <p className="asst__err">{error}</p>}

      {result && (
        <div className="asst__result">
          <p className="asst__note">{result.note}</p>
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
        </div>
      )}
    </>
  );
}
