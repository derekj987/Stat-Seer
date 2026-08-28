import type { ChaosEntry } from "@/lib/chaos";

// The Upset Lab / Chaos Board — a SPECULATIVE panel for aggressive bettors. It ranks games
// by how upset-ripe they FEEL (a boom/bust favorite, a high-ceiling dog, wildcard variance,
// juicy payout), deliberately ignoring the priced factors. It is explicitly not a pick and
// not an edge — the copy says so — and it never touches The Model or Value Finder.

const PIPS: { key: keyof ChaosEntry["subs"]; label: string }[] = [
  { key: "boom", label: "Boom/bust" },
  { key: "ceiling", label: "Dog ceiling" },
  { key: "wild", label: "Wildcard" },
  { key: "payout", label: "Payout" },
];
const EARLY_PIP: { key: keyof ChaosEntry["subs"]; label: string } = { key: "early", label: "Early X-factor" };
const COMFORT_PIP: { key: keyof ChaosEntry["subs"]; label: string } = { key: "comfort", label: "Comfort zone" };
const IMPROVE_PIP: { key: keyof ChaosEntry["subs"]; label: string } = { key: "improved", label: "Improved?" };

// A legend chip that explains its factor on hover (desktop) or tap (mobile) — pure CSS, no JS,
// same mechanism as the Tip component (a hidden checkbox flipped by the <label> reveals the note).
function FactorChip({ emoji, label, tip, cls }: { emoji: string; label: string; tip: string; cls?: string }) {
  // The bubble is a SIBLING of the label (not inside it), exactly like the Tip component: the
  // label stays a clean tap target that the bubble never covers, so a phone re-tap reliably
  // toggles the checkbox off. Anchored to the .cb__chipwrap.
  return (
    <span className="cb__chipwrap">
      <label className={`cb__chip cb__chip--tip${cls ? " " + cls : ""}`}>
        <input type="checkbox" className="cb__chiptchk" tabIndex={-1} aria-hidden="true" />
        <span>{emoji} {label}</span>
      </label>
      <span className="cb__chiptip" role="tooltip">{tip}</span>
    </span>
  );
}

export function ChaosBoard({
  sport,
  entries,
  windowLabel,
}: {
  sport: "NFL" | "NCAAF";
  entries: ChaosEntry[];
  windowLabel: string;
}) {
  if (entries.length === 0) return null;
  const earlyOn = entries.some((e) => e.earlyActive);
  const comfortOn = entries.some((e) => e.comfortActive);
  const improveOn = entries.some((e) => e.improveActive);
  return (
    <section className="ctxsec cb">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/chaosboard.jpg?v=2" alt="Chaos Board" className="cb__banner" />
      <p className="cb__caption">See what we&apos;re brewing in the <b>Upset Lab</b>.</p>
      <details className="cb__intro">
        <summary className="cb__introsum">What is this? — the aggressive bettor&apos;s chaos board · just for fun, not a pick</summary>
        <div className="cb__introbody">
          <p className="ctxsec__d">
            For the aggressive bettor: which underdogs <em>could</em> pull the outright upset — <b>win the game
            straight up</b> (the moneyline, not the spread) — ranked by <b>chaos potential</b>, not how likely it is.
            It rewards upside and mayhem (a shaky favorite, a high-ceiling dog, weather, a fat payout) and openly
            ignores the priced factors. The market thinks all of these are long shots — <b>that&apos;s the appeal</b>.
            Just for fun; not a pick.
          </p>
          {earlyOn && (
            <p className="cb__early">
              <b>⚡ Early X-factor is live (weeks 1–3).</b> The season&apos;s first few weeks are its most
              chaotic: rosters were overhauled and no one has current-season form, so the market works with
              the least information — and dogs win a bit more often at the same price (~+1.5 pts vs mid-season).
              This factor rewards a live dog in the sweet spot. It fades to zero after week 3, and it&apos;s a
              variance flag, <b>not an edge</b> —{" "}
              {sport === "NFL"
                ? "early NFL dogs still cover only ~53.5% ATS, within a coin flip of the vig"
                : "early college dogs actually cover under 50% ATS (the early slate is full of cupcake blowouts), so there's no dog edge here at all"}.
            </p>
          )}
        </div>
      </details>
      <div className="cb__legend">
        <span className="cb__legttl">Chaos Index blends <span className="cb__legttl-hint">(hover / tap a chip)</span></span>
        <FactorChip emoji="🌪" label="Boom/bust favorite"
          tip="How wildly the favorite's scores swing week to week. A boom-or-bust favorite is easier to catch on an off day." />
        <FactorChip emoji="🚀" label="Dog ceiling"
          tip="The underdog's best-day ceiling — how big they can go when everything clicks, not their average." />
        <FactorChip emoji="🎲" label="Wildcard"
          tip="Variance amplifiers that push a game toward a coin flip — chiefly high wind at kickoff." />
        <FactorChip emoji="💰" label="Payout"
          tip="What a $100 bet on the underdog pays if it hits. Longer shots pay more — the aggressive-bettor draw." />
        {earlyOn && <FactorChip emoji="⚡" label="Early X-factor" cls="cb__chip--early"
          tip="Weeks 1–3 only: the season's start is its most chaotic — new rosters, no current form — so live dogs spring more surprises. Fades to zero after week 3." />}
        {comfortOn && <FactorChip emoji="🏟" label="Comfort zone" cls="cb__chip--comfort"
          tip="Is the road dog in a stadium like home? A dome team at another dome is at ease; a warm/dome team out in the late-season cold is not." />}
        {improveOn && <FactorChip emoji="📈" label="Improved?" cls="cb__chip--improve"
          tip={sport === "NFL"
            ? "How much the dog's roster improved this offseason — ESPN's preseason power index vs where they ended last year (draft + free agency). A rising team a favorite can underestimate."
            : "How much the dog's preseason rating (SP+) jumped above last year's results — an improved/underrated team the market is slow to respect."} />}
        <span className="cb__win">traits: last 2 seasons ({windowLabel})</span>
      </div>

      <ol className="cb__board">
        {entries.map((e, i) => (
          <li className={`cb__card cb__card--${e.tier}`} key={`${e.away}-${e.home}`}>
            <div className="cb__rank">
              <span className="cb__no">{i + 1}</span>
              <span className={`cb__sport cb__sport--${sport === "NFL" ? "nfl" : "cfb"}`}>{sport}</span>
            </div>
            <div className="cb__mid">
              <div className="cb__match">
                <b>{e.dog}</b> <span className="cb__at">to win outright {e.dog === e.home ? "vs" : "at"} {e.fav}</span>
                {e.dog === e.home && <span className="cb__home">home dog</span>}
              </div>
              <p className="cb__story">{e.story}</p>
              <div className="cb__pips">
                {[...PIPS, ...(e.earlyActive ? [EARLY_PIP] : []), ...(e.comfortActive ? [COMFORT_PIP] : []), ...(e.improveActive ? [IMPROVE_PIP] : [])].map((p) => (
                  <div className={`cb__pip${p.key === "early" ? " cb__pip--early" : p.key === "comfort" ? " cb__pip--comfort" : p.key === "improved" ? " cb__pip--improve" : ""}`} key={p.key}>
                    <span className="cb__piplab">{p.label}</span>
                    <span className="cb__piptrack">
                      <span className="cb__pipfill" style={{ width: `${Math.round(e.subs[p.key])}%` }} />
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="cb__score">
              <span className="cb__chaoslab">CHAOS</span>
              <span className="cb__chaos">{e.index}</span>
              <span className="cb__meter"><span className="cb__meterfill" style={{ width: `${e.index}%` }} /></span>
              <span className="cb__pay">
                moneyline <b>+{(e.dogReturn - 100).toLocaleString()}</b>{e.returnEst && <span className="cb__est"> est</span>}
                <br />wins → $100 returns <b>${e.dogReturn.toLocaleString()}</b>
              </span>
            </div>
          </li>
        ))}
      </ol>

      <p className="cb__foot">
        Entertainment only. The Chaos Index is <b>not predictive</b> and <b>not a bet recommendation</b> —
        our tested read is that these auxiliary factors don&apos;t beat the market, and the spread already
        prices upsets. Chase at your own risk; bet responsibly.
      </p>
    </section>
  );
}
