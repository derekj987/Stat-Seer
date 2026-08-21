import { weekRange, fetchWeek, buildBoard } from "@/lib/board";
import { fetchModelWeek, type ModelPrediction } from "@/lib/model";
import { weekRefs } from "@/lib/refAssignments";
import { REF_STATS, REF_LEAGUE } from "@/lib/refStats";
import { Brand, FlowSteps, ContextSubnav } from "../Nav";

const refByName = new Map(REF_STATS.map((s) => [s.name, s]));

/** The ONE crew tendency that persists year-to-year is the penalty rate. */
function crewFlag(pen: number): { label: string; tone: "hot" | "cool" } | null {
  if (pen >= REF_LEAGUE.pen + 0.8) return { label: "Flag-heavy", tone: "hot" };
  if (pen <= REF_LEAGUE.pen - 0.8) return { label: "Lets them play", tone: "cool" };
  return null;
}

export const revalidate = 300;
const SEASON = 2026;

const kickFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});
const et = (iso: string) => kickFmt.format(new Date(iso)) + " ET";

function WeekNav({ min, max, current }: { min: number; max: number; current: number }) {
  const weeks: number[] = [];
  for (let w = min; w <= max; w++) weeks.push(w);
  return (
    <nav className="weeknav" aria-label="Select week">
      <span className="weeknav__label">Week</span>
      <div className="weeknav__list">
        {weeks.map((w) => (
          <a key={w} href={`/considerations?week=${w}`}
            className={w === current ? "weeknav__w active" : "weeknav__w"}
            aria-current={w === current ? "page" : undefined}>{w}</a>
        ))}
      </div>
    </nav>
  );
}

interface Consideration { kind: string; text: string }

export default async function Page({ searchParams }: PageProps<"/considerations">) {
  const sp = await searchParams;
  let range: { min: number; max: number } | null = null;
  try { range = await weekRange(SEASON); } catch { range = null; }
  const min = range?.min ?? 1;
  const max = range?.max ?? 1;
  const requested = typeof sp.week === "string" ? parseInt(sp.week, 10) : NaN;
  const week = Number.isFinite(requested) ? Math.min(max, Math.max(min, requested)) : min;

  const board = buildBoard(await fetchWeek(week, SEASON));
  const modelById = new Map<string, ModelPrediction>();
  try {
    for (const p of await fetchModelWeek(week, SEASON)) modelById.set(p.eventId, p);
  } catch { /* predictions may not be published yet */ }
  const refs = await weekRefs(week, SEASON);

  const games = board.map((g) => {
    const mp = modelById.get(g.eventId);
    const crew = refs.get(g.home);
    const items: Consideration[] = [];

    // Site / travel — from the schedule truth in the locked prediction.
    if (mp?.neutral) {
      items.push({
        kind: "Site",
        text: `Neutral site${mp.venue ? ` — ${mp.venue}` : ""}. The Model applies no home-field edge; long travel/body-clock effects are real but too small to price.`,
      });
    }

    // Referee crew — set only once assignments post game-week. Penalty rate is the
    // one persistent tendency; the O/U + favorite/underdog history is context, not a lean.
    if (crew) {
      const s = refByName.get(crew.referee);
      const read = crew.tendency === "flag-happy"
        ? "flag-heavy — more penalties than average, so more variance"
        : crew.tendency === "flag-light"
          ? "lets them play — fewer flags than average"
          : "average penalties";
      let text = `${crew.referee} (${read}, ~${crew.pen}/g).`;
      if (s) {
        text += ` Their games average ${s.total} total points (${s.over}% over), and the favorite`
          + ` covers ${s.atsFav}% ATS vs the underdog ${100 - s.atsFav}% — historical context, not a lean.`;
      }
      items.push({ kind: "Referee", text });
    }

    return { g, kickoff: g.commence, items };
  });

  const flagged = games.filter((x) => x.items.length > 0).length;

  return (
    <main className="wrap">
      <header className="masthead">
        <Brand sub={`The Context · Special Considerations · Week ${week}, ${SEASON}`} />
      </header>

      <FlowSteps active="context" />
      <ContextSubnav active="special" />
      <WeekNav min={min} max={max} current={week} />

      <section className="explainer">
        <p>
          <b>The stuff that doesn&apos;t fit in a number.</b> Every game, in one place: the situational
          factors around it — site &amp; travel, weather, referee crew, player incentives, and what&apos;s at
          stake. These <b>arm your judgment</b>; they are <b>not</b> an adjusted line. Open a game to see what&apos;s
          flagged{flagged > 0 ? <> ({flagged} of {games.length} games have something this week)</> : null}.
        </p>
      </section>

      {games.length === 0 ? (
        <p className="foot">No games captured for Week {week} yet.</p>
      ) : (
        <details className="tgweek" open>
          <summary className="tgweek__h">
            NFL Week {week}
            <span className="tgweek__n">{games.length} games</span>
            <span className="tgweek__chev" aria-hidden="true">▾</span>
          </summary>
          <div className="scglist">
            {games.map(({ g, kickoff, items }) => (
              <details className="scg" key={g.eventId}>
                <summary className="scg__h">
                  <span className="scg__game">{g.away}<span className="at">@</span>{g.home}</span>
                  <time className="scg__time">{et(kickoff)}</time>
                  {items.length > 0
                    ? <span className="scg__count">{items.length}</span>
                    : <span className="scg__count scg__count--none">—</span>}
                  <span className="scg__chev" aria-hidden="true">▾</span>
                </summary>
                <div className="scg__body">
                  {items.length > 0 ? (
                    <ul className="scg__items">
                      {items.map((it, i) => (
                        <li key={i}><b className="scg__k">{it.kind}</b> {it.text}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="scg__none">Nothing flagged for this game yet.</p>
                  )}
                  <div className="scg__soon">
                    <b>Arriving game week:</b> weather (wind &amp; rain — wind is our one measured edge), player
                    incentives (contract bonuses in reach), referee assignment, and playoff stakes for late-season games.
                  </div>
                </div>
              </details>
            ))}
          </div>
        </details>
      )}

      {/* --- Referee crews (moved here from Upset Watch) --- */}
      <details className="ctxsec ctxdrop reftbl" open>
        <summary className="ctxsec__h ctxsec__h--big">Referee crews</summary>
        <div className="refbottom">
          <span className="refbottom__k">Bottom line — what to actually use</span>
          <p>
            One crew tendency carries over year to year: <b>how many flags they throw</b>. Crews tagged
            <b className="hot"> Flag-heavy</b> throw more than league average ({REF_LEAGUE.pen}/g) and
            <b className="cool"> Lets them play</b> throw fewer — that&apos;s the real read (more flags = more
            variance). The rest — average total, over/under lean, favorite vs underdog cover — is <b>historical
            context, not a reliable lean</b>: mostly noise that doesn&apos;t carry to the next game. When a crew is
            assigned game-week, its flag tendency shows up in that game&apos;s considerations above.
          </p>
        </div>
        <div className="reftable">
          <div className="refrow refrow--head">
            <span>crew</span><span>games</span><span>read</span><span>pen/g</span><span>avg total</span><span>leans O/U</span><span>leans ATS</span>
          </div>
          {REF_STATS.map((r) => {
            const flag = crewFlag(r.pen);
            const ou = r.over >= 50 ? { d: "Over", p: r.over } : { d: "Under", p: 100 - r.over };
            const ats = r.atsFav >= 50 ? { d: "Fav", p: r.atsFav } : { d: "Dog", p: 100 - r.atsFav };
            return (
              <div className="refrow" key={r.name}>
                <span className="refrow__name">{r.name}</span>
                <span className="refrow__v muted">{r.games}</span>
                <span className="refrow__read">
                  {flag ? <b className={flag.tone}>{flag.label}</b> : <span className="muted">Average flags</span>}
                </span>
                <span className={r.pen >= REF_LEAGUE.pen ? "refrow__v hot" : "refrow__v cool"}>{r.pen}</span>
                <span className="refrow__v">{r.total}</span>
                <span className="reflean"><b className="reflean__d">{ou.d}</b><span className="reflean__p">{ou.p}%</span></span>
                <span className="reflean"><b className="reflean__d">{ats.d}</b><span className="reflean__p">{ats.p}%</span></span>
              </div>
            );
          })}
        </div>
        <p className="ctxsec__note">
          Historical crew tendencies, 2021–25. Assignments post during game week and map to each game above.
        </p>
      </details>
    </main>
  );
}
