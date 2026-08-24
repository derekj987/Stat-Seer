// Coach production table (CONTEXT, not an edge) — mirrors the Player Model's QB tables:
// one row per coach, career vs prior-season columns. Shows offensive yards/game and
// points/game. Data from web/lib/coachTendencies.ts (analysis/coach_tendencies.py).
import { COACH_TENDENCIES } from "@/lib/coachTendencies";

const fmtY = (v?: number | null) => (v == null ? "—" : String(Math.round(v)));
const fmtP = (v?: number | null) => (v == null ? "—" : v.toFixed(1));
const lastName = (n: string) => n.split(" ").filter(Boolean).slice(-1)[0] || n;

function CoachRow({ team }: { team: string }) {
  const c = COACH_TENDENCIES[team];
  if (!c) return null;
  const noHist = c.ydsCareer == null && c.ptsCareer == null;
  return (
    <div className="cxctrow" role="row">
      <span className="cxctcell cxctcell--tm">
        {team} <b className="cxct__nm">{lastName(c.coach)}</b>
      </span>
      {noHist ? (
        <span className="cxctcell cxctcell--none">First year — no head-coach history yet</span>
      ) : (
        <>
          <span className="cxctcell cxctcell--num">{fmtY(c.ydsCareer)}</span>
          <span className="cxctcell cxctcell--num">{fmtY(c.ydsPrior)}</span>
          <span className="cxctcell cxctcell--num">{fmtP(c.ptsCareer)}</span>
          <span className="cxctcell cxctcell--num">{fmtP(c.ptsPrior)}</span>
        </>
      )}
    </div>
  );
}

/** Career-vs-prior offensive production for both head coaches in a game. Returns null
 *  when neither coach is in the table. */
export default function CoachTable({ away, home }: { away: string; home: string }) {
  if (!COACH_TENDENCIES[away] && !COACH_TENDENCIES[home]) return null;
  return (
    <div className="cxctscroll">
      <div className="cxcoachtbl" role="table" aria-label="Head-coach offensive production">
        <div className="cxctrow cxctrow--head" role="row">
          <span className="cxctcell cxctcell--tm">Coach</span>
          <span className="cxctcell cxctcell--num">Yds/G<small>Career</small></span>
          <span className="cxctcell cxctcell--num">Yds/G<small>2024</small></span>
          <span className="cxctcell cxctcell--num">Pts/G<small>Career</small></span>
          <span className="cxctcell cxctcell--num">Pts/G<small>2024</small></span>
        </div>
        <CoachRow team={away} />
        <CoachRow team={home} />
      </div>
      <p className="cxct__foot">Offense · Career = 2021–24 (our play-by-play)</p>
    </div>
  );
}
