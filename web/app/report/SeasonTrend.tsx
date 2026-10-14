import Tip from "../Tip";
import { REPORT_CARDS, type ReportCard } from "@/lib/reportCards";

// Week by week, one sport, so the question "are we getting better?" can be read off the page
// instead of inferred from five separate cards (Derek: "I want to know if we are getting better
// each week").
//
// 🚨 THE HONEST ANSWER TO THAT QUESTION IS USUALLY "TOO EARLY TO SAY", AND THE PANEL HAS TO SAY SO
// RATHER THAN DRAW A LINE THROUGH FIVE POINTS. Sixteen games is a standard error of about 12
// percentage points on a win rate, so a week at 11-5 and a week at 6-8 are statistically the same
// week. The project's own rule is already written down — "retuning on one week is how a model gets
// worse" — and a trend panel is exactly the surface that invites it. So this table:
//
//   * prints every week beside the SEASON row, which is the only line with enough games to read;
//   * marks each cell better/worse against THE MARKET's number for that same week, never against
//     our own previous week — a week where everyone was wrong is not a week we got worse;
//   * says in the scroll how wide the noise band is, in the same units as the table.
//
// What a reader should take from it is the SHAPE across the season, not the slope: a column that
// loses every single week is a finding, and one that bounces is not.

const pct = (w: number, l: number) => (w + l ? Math.round((100 * w) / (w + l)) : null);
const rec = (t: { w: number; l: number; p: number }) =>
  `${t.w}-${t.l}${t.p ? `-${t.p}` : ""}`;

/** Better than the market = lower error, lower Brier, and the cell says which by colour. */
function Vs({ ours, mkt, lowerIsBetter = true, dp = 1 }: {
  ours: number | null; mkt: number | null; lowerIsBetter?: boolean; dp?: number;
}) {
  if (ours === null) return <span className="rc-muted">—</span>;
  const better = mkt === null ? null : lowerIsBetter ? ours < mkt : ours > mkt;
  return (
    <>
      <b className={better === null ? "" : better ? "rctr--good" : "rctr--bad"}>{ours.toFixed(dp)}</b>
      {mkt !== null && <span className="rctr__vs"> vs {mkt.toFixed(dp)}</span>}
    </>
  );
}

export default function SeasonTrend({ sport, label }: { sport: "nfl" | "ncaaf"; label: string }) {
  const weeks = REPORT_CARDS.filter((c) => c.sport === sport).sort((a, b) => a.week - b.week);
  if (weeks.length < 2) return null;

  // The season line, summed from the weeks rather than re-derived — one place for the arithmetic.
  const sum = (pick: (c: ReportCard) => { w: number; l: number; p: number }) =>
    weeks.reduce((a, c) => { const t = pick(c); return { w: a.w + t.w, l: a.l + t.l, p: a.p + t.p }; },
                 { w: 0, l: 0, p: 0 });
  const season = {
    games: weeks.reduce((n, c) => n + c.gameSummary.games, 0),
    su: sum((c) => c.gameSummary.su),
    ats: sum((c) => c.gameSummary.ats),
    totals: sum((c) => c.gameSummary.totals),
  };
  // Error and Brier are averaged by GAMES, not by week — a 15-game week and a 16-game week are not
  // equal weights, and a straight mean of the weekly numbers quietly says they are.
  const weighted = (pick: (c: ReportCard) => number | null) => {
    let num = 0, den = 0;
    for (const c of weeks) {
      const v = pick(c);
      if (v !== null) { num += v * c.gameSummary.games; den += c.gameSummary.games; }
    }
    return den ? num / den : null;
  };

  // Prop leans, pooled per week across the YARDAGE and RECEPTION categories — the per-category
  // split lives on each week's own card, and five categories x five weeks is a wall rather than a
  // trend.
  //
  // 🚨 ANYTIME TOUCHDOWN IS EXCLUDED, AND IT IS THE BIGGEST CATEGORY, so leaving it in is not a
  // rounding decision. A TD lean is a probability against a probability: an "over" on a 15% player
  // who does not score is the EXPECTED outcome, not a loss, and counting it as one buries the four
  // markets where a win and a loss mean what they say. Pooled with TDs this column read 48/52/55/52;
  // without them it reads the yardage board, which is what it claims to. Touchdowns are graded as
  // calibration — ours vs the book vs what actually happened — on each week's own card.
  const SCORED_CATS = (c: ReportCard) =>
    Object.entries(c.propSummary).filter(([cat]) => cat !== "td").map(([, p]) => p);
  const propLean = (c: ReportCard) =>
    SCORED_CATS(c).reduce((a, p) => ({ w: a.w + p.lean.w, l: a.l + p.lean.l, p: 0 }),
                          { w: 0, l: 0, p: 0 });
  const propGraded = (c: ReportCard) => SCORED_CATS(c).reduce((n, p) => n + p.graded, 0);
  // A week whose results have not landed yet grades almost nothing, and a 4-row week printed beside
  // a 400-row one reads as a collapse rather than as missing data. Named, not hidden.
  const THIN = 60;

  const seasonProp = weeks.reduce((a, c) => {
    const t = propLean(c);
    return { w: a.w + t.w, l: a.l + t.l, p: 0 };
  }, { w: 0, l: 0, p: 0 });

  return (
    <section className="rc rc-trend" id={`${sport}-trend`}>
      <div className="rc__head">
        <h2 className="rc__h">{label} — week by week
          <Tip label="Reading the trend" text={<>
            <span className="tip__lead">Every graded week side by side, with the season row
              underneath. <b>Blue beats the market that week, red does not.</b></span><br /><br />
            <b>How much of this is noise.</b> A sixteen-game week carries a standard error of about
            <b> 12 points</b> on a win rate, so 11-5 and 6-8 are the same week as far as the
            arithmetic is concerned. Two weeks apart means nothing; a column that loses in
            <i> every</i> week is a finding. Read the shape, not the slope — and the season row is
            the only line with enough games behind it to argue with.<br /><br />
            <b>Straight up</b> is our projected winner. <b>Against the close</b> is the side our
            margin implies against the market&apos;s closing spread, which is the hard test —
            break-even is 52.4% after the vig. <b>Totals</b> is our number against the
            market&apos;s.<br /><br />
            <b>Margin error</b> and <b>Brier</b> are ours against the market&apos;s on the same
            games, so they answer &quot;were we closer than the price&quot; rather than &quot;did we
            have a good week&quot;. Lower is better for both. They are averaged by games played, not
            by week.<br /><br />
            <b>Prop leans</b> pool every category; each week&apos;s card below splits them out.
            Touchdowns are deliberately excluded from that record — an over lean on a 15% player who
            does not score is the expected outcome, not a loss, so they are graded as calibration on
            each week&apos;s own card instead.<br /><br />
            Everything here is graded against <b>what was published before kickoff</b>, read from
            the committed file at the last commit before each game started, against the closing
            line.
          </>} />
        </h2>
      </div>
      <div className="rc-chart">
        <div className="pmscroll">
          <div className="pmtable pmtable--data pmtable--rctr" role="table" aria-label={`${label} week by week`}>
            <div className="pmrow pmrow--head pmrow--data" role="row">
              <span className="pmcell pmcell--player">Week</span>
              <span className="pmcell pmcell--num">Games</span>
              <span className="pmcell pmcell--num">Straight up</span>
              <span className="pmcell pmcell--num">Against the close</span>
              <span className="pmcell pmcell--num">Totals</span>
              <span className="pmcell pmcell--num">Margin error</span>
              <span className="pmcell pmcell--num">Brier</span>
              <span className="pmcell pmcell--num"
                title="Yardage and reception leans. Anytime touchdown is excluded — it is a probability, not a side, and is graded as calibration on each week's card.">
                Prop leans</span>
            </div>
            {weeks.map((c) => {
              const g = c.gameSummary;
              const pl = propLean(c);
              const graded = propGraded(c);
              const thin = graded < THIN;
              return (
                <div className="pmrow pmrow--data" role="row" key={c.week}>
                  <span className="pmcell pmcell--player">
                    <a href={`#${c.sport}-${c.week}`}>Week {c.week}</a>
                  </span>
                  <span className="pmcell pmcell--num">{g.games}</span>
                  <span className="pmcell pmcell--num">{rec(g.su)}
                    <span className="rctr__vs"> {pct(g.su.w, g.su.l)}%</span></span>
                  <span className="pmcell pmcell--num">{rec(g.ats)}
                    <span className="rctr__vs"> {pct(g.ats.w, g.ats.l)}%</span></span>
                  <span className="pmcell pmcell--num">{rec(g.totals)}
                    <span className="rctr__vs"> {pct(g.totals.w, g.totals.l)}%</span></span>
                  <span className="pmcell pmcell--num">
                    <Vs ours={g.marginMae} mkt={g.marketMarginMae} /></span>
                  <span className="pmcell pmcell--num">
                    <Vs ours={g.brier} mkt={g.marketBrier} dp={3} /></span>
                  <span className="pmcell pmcell--num">
                    {thin
                      ? <span className="rc-muted" title={`Only ${graded} prop rows have a result yet — the week's stat lines have not all landed, so this is not a record.`}>
                          {graded} graded
                        </span>
                      : <>{rec(pl)}<span className="rctr__vs"> {pct(pl.w, pl.l)}%</span></>}
                  </span>
                </div>
              );
            })}
            <div className="pmrow pmrow--data rctr__season" role="row">
              <span className="pmcell pmcell--player"><b>Season</b></span>
              <span className="pmcell pmcell--num"><b>{season.games}</b></span>
              <span className="pmcell pmcell--num"><b>{rec(season.su)}</b>
                <span className="rctr__vs"> {pct(season.su.w, season.su.l)}%</span></span>
              <span className="pmcell pmcell--num"><b>{rec(season.ats)}</b>
                <span className="rctr__vs"> {pct(season.ats.w, season.ats.l)}%</span></span>
              <span className="pmcell pmcell--num"><b>{rec(season.totals)}</b>
                <span className="rctr__vs"> {pct(season.totals.w, season.totals.l)}%</span></span>
              <span className="pmcell pmcell--num">
                <Vs ours={weighted((c) => c.gameSummary.marginMae)}
                    mkt={weighted((c) => c.gameSummary.marketMarginMae)} /></span>
              <span className="pmcell pmcell--num">
                <Vs ours={weighted((c) => c.gameSummary.brier)}
                    mkt={weighted((c) => c.gameSummary.marketBrier)} dp={3} /></span>
              <span className="pmcell pmcell--num"><b>{rec(seasonProp)}</b>
                <span className="rctr__vs"> {pct(seasonProp.w, seasonProp.l)}%</span></span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
