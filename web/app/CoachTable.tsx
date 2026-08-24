// Coaching context (not an edge): a plain line per head coach with their team's
// points/game, offensive yards/game, and defensive yards allowed/game (their tenure in
// our play-by-play, 2021-24). Data from web/lib/coachTendencies.ts.
import { COACH_TENDENCIES } from "@/lib/coachTendencies";

const fmtY = (v?: number | null) => (v == null ? "—" : String(Math.round(v)));
const fmtP = (v?: number | null) => (v == null ? "—" : v.toFixed(1));
const lastName = (n: string) => n.split(" ").filter(Boolean).slice(-1)[0] || n;

function CoachLine({ team }: { team: string }) {
  const c = COACH_TENDENCIES[team];
  if (!c) return null;
  const noHist = c.ptsCareer == null && c.ydsCareer == null;
  return (
    <div className="cxcoachln">
      <span className="cxcoachln__tm">{team} <b className="cxcoachln__nm">{lastName(c.coach)}</b></span>
      {noHist ? (
        <span className="cxcoachln__none">first year — no head-coach history yet</span>
      ) : (
        <span className="cxcoachln__stats">
          <b>{fmtP(c.ptsCareer)}</b> pts/g · <b>{fmtY(c.ydsCareer)}</b> off yds/g ·{" "}
          <b>{fmtY(c.defYdsCareer)}</b> def yds/g allowed
        </span>
      )}
    </div>
  );
}

/** Per-coach production line for both head coaches in a game. Null when neither is known. */
export default function CoachTable({ away, home }: { away: string; home: string }) {
  if (!COACH_TENDENCIES[away] && !COACH_TENDENCIES[home]) return null;
  return (
    <div className="cxcoachlns">
      <CoachLine team={away} />
      <CoachLine team={home} />
      <p className="cxcoachlns__foot">Per game, under this coach · 2021–24</p>
    </div>
  );
}
