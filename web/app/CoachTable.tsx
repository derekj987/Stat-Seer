// Coaching context (not an edge): each head coach's team points/game, offensive yards/game and
// defensive yards allowed/game over their tenure in our play-by-play (2021-24). Data from
// web/lib/coachTendencies.ts.
//
// Drawn as a small grid rather than a sentence per coach. As prose each line repeated all three
// unit strings — "20.0 pts/g · 311 off yds/g · 340 def yds/g allowed" twice per card — which was
// the widest row on the card and the only one still wrapping to a second line. The units belong
// in a header, said once; the numbers then line up in columns, which is also what lets a reader
// compare the two coaches at a glance instead of reading two sentences.
//
// Same `cxstat` markup as the Scoring block above it, so the two rows share an alignment.
import { Fragment } from "react";
import { COACH_TENDENCIES } from "@/lib/coachTendencies";

const fmtY = (v?: number | null) => (v == null ? "—" : String(Math.round(v)));
const fmtP = (v?: number | null) => (v == null ? "—" : v.toFixed(1));
const lastName = (n: string) => n.split(" ").filter(Boolean).slice(-1)[0] || n;

/** Per-coach production line for both head coaches in a game. Null when neither is known. */
export default function CoachTable({ away, home }: { away: string; home: string }) {
  const teams = [away, home].filter((t) => COACH_TENDENCIES[t]);
  if (!teams.length) return null;
  return (
    <>
      <div className="cxstat cxstat--coach">
        <span className="cxstat__h" />
        <span className="cxstat__h" />
        <span className="cxstat__h">pts/g</span>
        <span className="cxstat__h">off yds</span>
        <span className="cxstat__h">def yds</span>
        {teams.map((tm) => {
          const c = COACH_TENDENCIES[tm]!;
          // A first-year coach has no tenure to report. Say that once, across the stat columns,
          // rather than printing three dashes that read as missing data.
          const noHist = c.ptsCareer == null && c.ydsCareer == null;
          return (
            <Fragment key={tm}>
              <span className="cxstat__tm">{tm}</span>
              <span className="cxstat__nm">{lastName(c.coach)}</span>
              {noHist ? (
                <span className="cxstat__none">first year — no head-coach history yet</span>
              ) : (
                <>
                  <span><b>{fmtP(c.ptsCareer)}</b></span>
                  <span><b>{fmtY(c.ydsCareer)}</b></span>
                  <span><b>{fmtY(c.defYdsCareer)}</b></span>
                </>
              )}
            </Fragment>
          );
        })}
      </div>
      <div className="cxstat__note">their tenure, 2021–24</div>
    </>
  );
}
