import { Brand, FlowSteps, ContextSubnav, WeekBadge } from "../../Nav";
import Tip from "@/app/Tip";
import { NcaafWeekNav, NcaafOffWeek, readNcaafWeek } from "../NcaafWeek";
import { NCAAF_MODEL, type NcaafConf, type NcaafCardGame } from "../model-data";
import { StatCard } from "../StatCard";
import { abbrevTeam } from "@/lib/ncaafAbbrev";
import { kickET } from "../CardCells";

// College Football — Context · Special Considerations. Mirrors the NFL page: one card per
// game with the situational context around it, plus the durable measured backdrop (home
// field + league strength). Context arms judgment; it is never a pick.
export const metadata = {
  title: "StatSeer — CFB Special Considerations",
  description: "The situational context for every college game — site, poll stakes, our power read, and scoring environment — plus home field and conference strength.",
};

const M = NCAAF_MODEL;
// Power ratings + national rank exist for the top 25; look a team up by name.
const RATING = new Map<string, { rank: number; team: string; conf: string; rating: number }>(
  M.top.map((t) => [t.team, t]));

function ratingCell(team: string) {
  const r = RATING.get(team);
  return r
    ? <>{abbrevTeam(team)} <b>{r.rating > 0 ? "+" : ""}{r.rating}</b> <span className="cxrank">(#{r.rank})</span></>
    : <>{abbrevTeam(team)} <span className="muted">outside top 25</span></>;
}

function pollCell(team: string, ap?: number | null) {
  return ap ? <><b>#{ap}</b> {abbrevTeam(team)}</> : <>{abbrevTeam(team)} <span className="muted">unranked</span></>;
}

function ConsiderationCard({ g, hfa }: { g: NcaafCardGame; hfa: number }) {
  const ranked = Boolean(g.apAway || g.apHome);
  return (
    <article className={`cxcard${g.off ? " cxcard--wind" : ""}`}>
      <header className="cxcard__head">
        <span className="matchup">{abbrevTeam(g.away)}<span className="at">@</span>{abbrevTeam(g.home)}</span>
        {g.commence && <time className="kick">{kickET(g.commence)}</time>}
        {g.neutral ? <span className="badge neutral">NEUTRAL</span> : null}
        {g.off ? <span className="badge neutral" title="off consensus">◆ OFF</span> : null}
      </header>
      <dl className="cxcard__rows">
        <div className="cxrow">
          <dt className="cxrow__k">Site</dt>
          <dd className="cxrow__v">
            {g.neutral
              ? <>Neutral site — <b>no home edge</b> applied</>
              : <>{abbrevTeam(g.home)} at home · <b>+{hfa}</b> <span className="cxinc__prog">home field</span></>}
          </dd>
        </div>
        <div className="cxrow">
          <dt className="cxrow__k">Poll</dt>
          <dd className="cxrow__v">
            {ranked
              ? <>{pollCell(g.away, g.apAway)} <span className="at">vs</span> {pollCell(g.home, g.apHome)} <span className="cxinc__prog">AP Top 25</span></>
              : <span className="muted">Unranked matchup — neither team in the AP Top 25</span>}
          </dd>
        </div>
        <div className="cxrow">
          <dt className="cxrow__k">Power</dt>
          <dd className="cxrow__v">{ratingCell(g.away)} · {ratingCell(g.home)} <span className="cxinc__prog">our rating</span></dd>
        </div>
        <div className="cxrow">
          <dt className="cxrow__k">Scoring</dt>
          <dd className="cxrow__v">
            our total <b>{g.projTotal}</b>{g.marketTotal != null ? <> · market <b>{g.marketTotal}</b></> : null} <span className="cxinc__prog">implied environment</span>
          </dd>
        </div>
        <div className="cxrow">
          <dt className="cxrow__k">Conference</dt>
          <dd className="cxrow__v">{g.conf}</dd>
        </div>
      </dl>
    </article>
  );
}

export default async function Page({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const cx = M.context;
  const c = M.card;
  const week = readNcaafWeek((await searchParams).week, c.week);
  const top = cx.conferences[0];
  const games: readonly NcaafCardGame[] = c.games;
  const lead = games.slice(0, 6);
  const rest = games.slice(6);

  return (
    <main className="wrap">
      <header className="masthead">
        <Brand
          sub={<><span className="brand__sport">NCAAF</span> · Special Considerations</>}
          art={{ src: "/coach.png?v=1", alt: "Coach" }}
        />
      </header>

      <section className="explainer explainer--wide">
        <p>
          <b>The stuff that doesn&apos;t fit in a number.</b> One card per game with the context around it — the
          <b> site</b>, the <b>poll stakes</b>, our <b>power read</b>, and the <b>scoring environment</b>. These
          <b> arm your judgment</b>; they are <b>not</b> an adjusted line or a pick. The durable measured backdrop —
          home field and league strength — sits below.
        </p>
      </section>

      <WeekBadge week={c.week} />
      <FlowSteps active="context" base="ncaaf" />

      <div className="subnavrow">
        <ContextSubnav active="special" base="ncaaf" />
        <Tip text={<>One card per game with the context around it: the <b>site</b> (neutral sites drop the home edge), the <b>AP poll</b> stakes, each side&apos;s <b>power rating</b> and national rank, and the <b>scoring environment</b> (our total vs the market&apos;s). Context to arm your read — <b>not</b> a pick.</>} />
      </div>
      <NcaafWeekNav base="/ncaaf/considerations" week={week} />
      <NcaafOffWeek current={c.week} week={week} />

      <section className="ncf-sec">
        <h2 className="ncf-h">Game considerations — Week {c.week}
          <span className="ncf-h__note">{games.length} games · site, poll, power &amp; scoring</span>
        </h2>
        <p className="ncf-note" style={{ marginTop: 0 }}>
          <b>Note:</b> weather, referee crews, and coaching tendencies are tracked for the NFL today; the
          college site-level feeds fill in here as the season runs — until then a card shows the context we
          measure now.
        </p>
        {games.length === 0 ? (
          <p className="foot">No games on the board yet.</p>
        ) : (
          <>
            <section className="cxgrid" aria-label={`Week ${c.week} considerations`}>
              {lead.map((g) => <ConsiderationCard key={`${g.away}-${g.home}`} g={g} hfa={cx.hfa} />)}
            </section>
            {rest.length > 0 && (
              <details className="hb-more cxmore">
                <summary className="hb-more__sum">
                  <span className="hb-more__chev" aria-hidden="true">▸</span>
                  See {rest.length} more {rest.length === 1 ? "game" : "games"}
                </summary>
                <section className="cxgrid" aria-label={`Week ${c.week} considerations — more games`}>
                  {rest.map((g) => <ConsiderationCard key={`${g.away}-${g.home}`} g={g} hfa={cx.hfa} />)}
                </section>
              </details>
            )}
          </>
        )}
      </section>

      <div className="ncf-cards">
        <StatCard label="Home field" value={`+${cx.hfa}`}
          sub={`points, fit from ${M.seasons}. Dropped to zero at neutral sites — bowls, kickoff classics, neutral-city rivalries.`} />
        <StatCard label="Conferences ranked" value={`${cx.conferences.length}`}
          sub="by average member rating — the strength-of-schedule backdrop behind any cross-conference matchup" />
        <StatCard label="Strongest league" value={top.conf}
          sub={`the top conference by our rating (avg +${top.avgRating} per team)`} />
      </div>

      <section className="ncf-sec">
        <h2 className="ncf-h">Conference strength
          <span className="ncf-h__note">average team rating, end of {M.season}</span></h2>
        <div className="ncf-tbl">
          <div className="ncf-row ncf-row--head">
            <span>#</span><span>Conference</span><span>Teams</span><span>Avg</span>
          </div>
          {cx.conferences.map((cf: NcaafConf, i: number) => (
            <div className="ncf-row" key={cf.conf}>
              <span className="ncf-row__rk">{i + 1}</span>
              <span className="ncf-row__tm">{cf.conf}</span>
              <span className="ncf-row__cf">{cf.teams}</span>
              <span className="ncf-row__rt">{cf.avgRating > 0 ? "+" : ""}{cf.avgRating}</span>
            </div>
          ))}
        </div>
        <p className="ncf-note">
          League strength is <b>backdrop, not a lean</b>. It explains why a middling SEC team can be favored over a
          strong Sun Belt team on a neutral field — the schedules they survived differ — but it never sets a
          number by itself.
        </p>
      </section>

      <footer className="foot">
        <p>
          <b>Understand the game — don&apos;t get handed a pick.</b> For the line-blind read see
          <a href="/ncaaf/model"> The Model</a>; for where the price is wrong, <a href="/ncaaf/lines">Value Finder</a>.
        </p>
      </footer>
    </main>
  );
}
