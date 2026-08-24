import type { ChaosEntry } from "@/lib/chaos";
import Tip from "@/app/Tip";

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
  return (
    <section className="ctxsec cb">
      <div className="ctxsec__head">
        <h2 className="ctxsec__h">The Upset Lab <span className="cb__tag">chaos board</span></h2>
        <Tip text={<>A <b>just-for-fun</b> ranking of which games could go sideways — scored on chaos
          potential, <b>not probability</b>. It blends a boom/bust favorite, the dog&apos;s ceiling, wildcard
          variance and the payout. The market says every one of these is a long shot; that&apos;s the whole
          point. <b>Not a pick, not an edge</b> — it never touches our model.</>} />
      </div>
      <p className="ctxsec__d">
        For the aggressive bettor: which games <em>could</em> blow up — ranked by <b>chaos potential</b>,
        not how likely it is. It rewards upside and mayhem (a shaky favorite, a high-ceiling dog, weather,
        a fat payout) and openly ignores the priced factors. The market thinks all of these are long shots —
        <b> that&apos;s the appeal</b>. Just for fun; not a pick.
      </p>
      <div className="cb__legend">
        <span className="cb__legttl">Chaos Index blends</span>
        <span className="cb__chip">🌪 Boom/bust favorite</span>
        <span className="cb__chip">🚀 Dog ceiling</span>
        <span className="cb__chip">🎲 Wildcard</span>
        <span className="cb__chip">💰 Payout</span>
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
                <b>{e.dog}</b> <span className="cb__line">+{e.line}</span>
                <span className="cb__at"> at {e.fav}</span>
              </div>
              <p className="cb__story">{e.story}</p>
              <div className="cb__pips">
                {PIPS.map((p) => (
                  <div className="cb__pip" key={p.key}>
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
                if it hits · $100 → <b>${e.dogReturn.toLocaleString()}</b>
                {e.returnEst && <span className="cb__est"> est</span>}
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
