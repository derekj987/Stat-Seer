import { NCAAF_MODEL, NCAAF_SCORING, type NcaafCardGame } from "./model-data";
import { CFB_GAME_WEATHER, type CfbGameWeather } from "@/lib/cfbWeatherData";
import { abbrevTeam } from "@/lib/ncaafAbbrev";
import { upsetMeter } from "@/lib/upsetMeter";
import { UpsetMeter } from "../UpsetMeter";
import { CFB_CHAOS } from "@/lib/chaosTraits";
import { scoreChaos, returnFromSpread } from "@/lib/chaos";

// Special Considerations for the NCAAF model board, under each game's row — the college
// counterpart of app/SpecialConsiderations.tsx, built after Derek said "move the NCAAF context
// data over too".
//
// WHAT TRAVELS, AND WHAT CANNOT. The NFL block is referee · weather · injuries · scoring ratings.
// College has no pre-game referee crew (CFBD publishes officials only after the fact, the same
// defect the NFL ref feed had) and no injury report at all — the NCAA does not mandate one, and
// no feed we have carries designations. Printing an empty "Referee" or "Injuries" row would be a
// placeholder that never resolves, which this project has a rule against. So the two factors that
// DO exist travel, and two college-specific ones that the old page carried and the NFL has no use
// for come with them:
//
//   Scoring   points scored/allowed per game + national rank   (new: cfb_export.current_scoring)
//   Weather   site forecast, wind-flagged                      (CFB_GAME_WEATHER)
//   Power     our line-blind rating + national rank            (NCAAF_MODEL.top)
//   Poll      AP Top 25 standing for either side               (card apAway/apHome)
//
// Context, never a pick — same discipline as the NFL block.

const RATINGS: Record<string, { rank: number; rating: number }> = {};
for (const t of NCAAF_MODEL.top) RATINGS[t.team] = { rank: t.rank, rating: t.rating };
const WX = new Map(CFB_GAME_WEATHER.map((w) => [w.game, w]));
const CX = NCAAF_MODEL.context;

const ord = (n: number) => {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

function weatherText(w: CfbGameWeather): string {
  if (w.indoor) return "Indoor — weather is a non-factor";
  if (w.status === "ok") {
    const bits = [
      `${w.windMph} mph wind${w.gustMph ? ` (${w.gustMph} gust)` : ""}`,
      w.tempF != null ? `${w.tempF}°` : "",
      w.conditions ?? "",
    ].filter(Boolean);
    return bits.join(" · ") + (w.precipPct != null && w.precipPct >= 40 ? ` · ${w.precipPct}% precip` : "");
  }
  return "Forecast arrives ~2 weeks out";
}

/** One team's column: where it ranks nationally on offence, defence and our own rating. */
function TeamCol({ team, ap }: { team: string; ap?: number | null }) {
  const sc = NCAAF_SCORING[team];
  const rt = RATINGS[team];
  return (
    <div className="impspec__col">
      <div className="impspec__colh">
        <span className="impspec__colt">{abbrevTeam(team)}</span>
        <span className="impspec__coln">{ap ? `AP #${ap}` : "unranked"}</span>
      </div>
      {sc ? (
        <ul className="impspec__stats">
          <li><span className="impspec__sl">scored</span><b>{sc.off}</b>
            <span className="impspec__rank">{ord(sc.offRank)} nationally</span></li>
          <li><span className="impspec__sl">allowed</span><b>{sc.def}</b>
            <span className="impspec__rank">{ord(sc.defRank)} nationally</span></li>
          <li><span className="impspec__sl">our rating</span>
            <b>{rt ? `${rt.rating > 0 ? "+" : ""}${rt.rating}` : "—"}</b>
            <span className="impspec__rank">{rt ? `#${rt.rank}` : "outside top 25"}</span></li>
        </ul>
      ) : (
        <span className="impspec__none">No games played yet this season</span>
      )}
    </div>
  );
}

// College scores more than the NFL; the Upset Meter reads each team's rate against this.
const CFB_LEAGUE_PTS = 27.0;

export function NcaafSpecialConsiderations({ g, week }: { g: NcaafCardGame; week: number }) {
  const wx = WX.get(`${g.away} @ ${g.home}`);
  const season = CX.scoringSeason;
  // The Upset Meter — the Chaos Board folded into the game it is about. College has no referee
  // crew, so that driver simply does not appear and the remaining weights renormalise.
  const ms = g.marketSpread;
  let read = null;
  if (ms) {
    const fav = ms.fav;
    const dog = fav === g.home ? g.away : g.home;
    const line = Math.abs(ms.num);
    const chaos = line >= 3 ? scoreChaos({
      sport: "CFB", away: g.away, home: g.home, dog, fav, line, week,
      dogReturn: returnFromSpread(line, "CFB"), returnEst: true,
      favTrait: CFB_CHAOS[fav], dogTrait: CFB_CHAOS[dog],
      windMph: wx && !wx.indoor ? wx.windMph : null,
      improvePct: fav === g.home ? g.awayRiser : g.homeRiser,
    }).index : null;
    // Both numbers as the HOME side's margin, which is what upsetMeter expects.
    const marketHome = ms.fav === g.home ? -Math.abs(ms.num) : Math.abs(ms.num);
    const projHome = g.projSpread.fav === g.home ? Math.abs(g.projSpread.num) : -Math.abs(g.projSpread.num);
    read = upsetMeter({
      marketSpreadHome: marketHome,
      modelMarginHome: g.rated === false ? null : projHome,
      windMph: wx && !wx.indoor ? wx.windMph : null,
      dogOff: NCAAF_SCORING[dog]?.off ?? null,
      favDef: NCAAF_SCORING[fav]?.def ?? null,
      leaguePts: CFB_LEAGUE_PTS,
      chaosIndex: chaos,
    }, abbrevTeam(dog), abbrevTeam(fav));
  }
  return (
    <section className="impspec" aria-label={`Special considerations, ${g.away} at ${g.home}`}>
      <span className="impspec__k">Special considerations</span>
      {read && <UpsetMeter read={read} />}
      <div className="impspec__cols">
        <div className="impspec__col impspec__col--game">
          <div className="impspec__blk">
            <span className="impspec__bh">Site</span>
            <span className="impspec__v">
              {wx?.venue ? <>{wx.venue}{wx.city ? ` · ${wx.city}, ${wx.state}` : ""}</>
                : (g.neutral ? "Neutral site" : `${abbrevTeam(g.home)} — home`)}
              {g.neutral ? <span className="impspec__rank"> · no home edge</span>
                : <span className="impspec__rank"> · home field +{CX.hfa}</span>}
            </span>
          </div>
          <div className={`impspec__blk${wx?.windFlag ? " impspec__blk--wind" : ""}`}>
            <span className="impspec__bh">Weather</span>
            <span className="impspec__v">
              {wx ? <>{wx.windFlag && <b className="wxflag">⚑&nbsp;WIND</b>} {weatherText(wx)}</>
                : <span className="impspec__none">Forecast arriving</span>}
            </span>
          </div>
          <div className="impspec__blk">
            <span className="impspec__bh">Conference</span>
            <span className="impspec__v">{g.conf}</span>
          </div>
        </div>
        <TeamCol team={g.away} ap={g.apAway} />
        <TeamCol team={g.home} ap={g.apHome} />
      </div>
      <span className="impspec__foot">
        Scoring is points per game this season ({season}{CX.scoringIsPrior ? ", prior season — no games played yet" : ""});
        our rating is line-blind. Context, not a pick.
      </span>
    </section>
  );
}
