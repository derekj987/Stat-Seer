// Landing hub — the single front door. The flow (Model → Context → Value) with one
// NFL | NCAAF toggle leads; that toggle also drives the live snapshot below it (The
// Model Card, Players We Like, Upsets) — the views that used to live on separate sport
// homepages. Then the bet-slip + community invites. Sections live at /model, /ncaaf/model, …
import { fetchHome, type CardRow, type UpsetRow, type PlayerPick } from "@/lib/home";
import { fetchWeek, buildBoard } from "@/lib/board";
import { NCAAF_MODEL, type NcaafCardGame, type NcaafUpset } from "./ncaaf/model-data";
import LandingHub, { type VfRow } from "./LandingHub";
import { createClient } from "@/lib/supabase/server";
import HomePromo from "./HomePromo";
import { weatherSpotlight } from "@/lib/weatherSpotlight";
import { weekRefs } from "@/lib/refAssignments";
import { weekInjuries, weekReturning, type InjuryNote, type ReturningNote } from "@/lib/nflInactives";
import type { SpecialCtx } from "./SpecialConsiderations";

export const metadata = {
  title: "StatSeer — the model vs the market, every sport",
  description: "See the Model, read the Room, find the Value — NFL and College Football. Published probabilities, an honest track record, and the best price on every pick.",
};

const SEASON = 2026;

export default async function Landing({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const initialSport = sp.sport === "ncaaf" ? "ncaaf" : sp.sport === "mlb" ? "mlb" : "nfl";

  let nfl: { week: number; card: CardRow[]; upsets: UpsetRow[]; players: PlayerPick[] } = { week: 0, card: [], upsets: [], players: [] };
  try {
    const home = await fetchHome(SEASON);
    nfl = { week: home.week, card: home.card, upsets: home.upsets, players: home.players };
  } catch { /* board not up yet */ }

  // Value Finder teaser — the first 4 games' best spread price across books (line shopping).
  let vf: VfRow[] = [];
  try {
    const board = buildBoard(await fetchWeek(nfl.week, SEASON));
    vf = board.slice(0, 4).flatMap((g) => {
      const homeFav = (g.spread.consensus ?? 0) < 0;
      const line = homeFav ? g.spread.home : g.spread.away;
      if (!line || line.point === null) return [];
      const team = homeFav ? g.home : g.away;
      return [{ eventId: g.eventId, away: g.away, home: g.home, line: `${team} ${line.point > 0 ? "+" : ""}${line.point}`, price: line.price, books: line.books }];
    });
  } catch { /* odds not up yet */ }

  // The weather spotlight carries the SAME block the model board shows for that game -- scoring,
  // weather, referee and both injury lists (Derek: "add the referee data as well, add all the
  // analysis from that chart"). It is fetched for ONE game rather than the slate, so the homepage
  // pays for one crew lookup and one injury read, not sixteen.
  let spotlight: { ctx: SpecialCtx; row: CardRow; wx: ReturnType<typeof weatherSpotlight> } | null = null;
  try {
    const pick = weatherSpotlight(nfl.card);
    if (pick) {
      const [refs, injAll] = await Promise.all([
        weekRefs(nfl.week, SEASON).catch(() => new Map()),
        weekInjuries(SEASON, nfl.week).catch(() => new Map<string, InjuryNote>()),
      ]);
      let backAll = new Map<string, ReturningNote[]>();
      try { backAll = await weekReturning(SEASON, nfl.week, injAll); } catch { /* no feed, no row */ }
      const injuries: { player: string; team: string; note: InjuryNote }[] = [];
      for (const [key, note] of injAll) {
        const team = key.split("|")[1] ?? "";
        if (team === pick.wx.home || team === pick.wx.away) injuries.push({ player: note.player, team, note });
      }
      spotlight = {
        row: pick.row, wx: pick,
        ctx: {
          away: pick.wx.away, home: pick.wx.home,
          crew: refs.get(pick.wx.home),
          wx: pick.wx,
          injuries,
          feedHasAny: injAll.size > 0,
          returning: Object.fromEntries(backAll),
          upset: null,
        },
      };
    }
  } catch { /* the spotlight is an enhancement — never break the homepage for it */ }

  // Members see ＋ Add-to-dashboard on the homepage panels; signed-out visitors don't.
  let isMember = false;
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    isMember = !!user;
  } catch { /* auth env not configured */ }

  const cfb = NCAAF_MODEL.card;
  const ncaaf = {
    week: cfb.week,
    games: cfb.games as unknown as NcaafCardGame[],
    upsets: cfb.upsets as unknown as NcaafUpset[],
  };
  return (
    <>
      {/* Full-bleed hero — a body-level banner so the seer's eyes span the whole
          viewport width; the wordmark now sits over the bottom-left of the image. */}
      <header className="lp-hero">
        <div className="lp-hero__banner">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/seereyes-band.jpg?v=1" alt="" className="lp-hero__img" width={1600} height={384} />
          <div className="lp-hero__lockup">
            <h1 className="lp-hero__wm">StatSeer</h1>
            <span className="lp-hero__wmtag">Arm yourself with data-driven decisions.</span>
          </div>
        </div>
      </header>

      {/* Value prop PINNED to the left edge like the "Message Us" widget — a slim tab that
          slides the panel out OVER the page when clicked. Out of the content flow entirely. */}
      <div className="lp-drawer">
        <input type="checkbox" id="lp-pitch-toggle" className="lp-drawer__chk" aria-hidden="true" tabIndex={-1} />
        <label htmlFor="lp-pitch-toggle" className="lp-drawer__tab" title="Why StatSeer">
          <span className="lp-drawer__tabtext">Why StatSeer</span>
          <span className="lp-drawer__chev" aria-hidden="true">›</span>
        </label>
        <label htmlFor="lp-pitch-toggle" className="lp-drawer__scrim" aria-hidden="true" />
        <aside className="lp-drawer__panel" aria-label="Why StatSeer">
          <label htmlFor="lp-pitch-toggle" className="lp-drawer__close" title="Close" aria-label="Close">✕</label>
          <section className="lp-pitch">
            <h2 className="lp-pitch__h">Make <b>sharper</b> decisions.</h2>
            <p className="lp-pitch__sub">
              Most tools hand you a pick and hope. StatSeer hands you the <b>evidence</b>:{" "}
              <b>line-blind projections</b> you can compare to the market, the <b>context</b> the numbers miss, and
              the <b>single best price</b> on every pick — so you evaluate a bet properly and never leave value on
              the table. Every published read is graded against the closing line, in the open.
            </p>
            <div className="lp-pitch__bars">
              <div className="lp-pitch__row lp-pitch__row--a">
                <span className="lp-pitch__label">Average bettor</span>
                <span className="lp-pitch__bar"><span className="lp-pitch__fill" style={{ ["--w" as string]: "48%" }} /></span>
                <span className="lp-pitch__n">48<span className="lp-pitch__slash">%</span></span>
              </div>
              <div className="lp-pitch__row lp-pitch__row--b">
                <span className="lp-pitch__label">Break-even line</span>
                <span className="lp-pitch__bar"><span className="lp-pitch__fill lp-pitch__fill--good" style={{ ["--w" as string]: "52.4%" }} /></span>
                <span className="lp-pitch__n">52.4<span className="lp-pitch__slash">%</span></span>
              </div>
            </div>
            <p className="lp-pitch__cap">That break-even line is exactly why price matters — a few cents of value on every bet is the whole game. StatSeer makes sure you never overpay.</p>
            <label htmlFor="lp-pitch-toggle" className="btn btn--primary lp-pitch__cta">Got it — show me the board →</label>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/crest.png?v=4" alt="" className="lp-pitch__crest" width={120} height={128} />
          </section>
        </aside>
      </div>

      <main className="lp">
      {/* Value-prop lead — answers "why StatSeer" before the board, then the trust strip. */}
      <section className="lp-lead">
        <h2 className="lp-lead__h">See the edge. <em>Get the best price.</em></h2>
        <p className="lp-lead__p">
          One model reads every game <b>line-blind</b>, shows you exactly where it disagrees with the
          market, then finds the sportsbook paying the most for your <b>exact slip</b>.
        </p>
        {/* Signed-out visitors only: members have already been approved and don't need the ask.
            Wording matches /signup and /pending exactly ("private beta", "small batches", "email you
            when you're in") so the promise doesn't change between the pitch and the form. */}
        {!isMember && (
          <div className="lp-beta">
            <p className="lp-beta__h">Join our <em>FREE</em> beta</p>
            <p className="lp-beta__p">
              StatSeer is in <b>private beta</b> and it&apos;s <b>completely free</b> — nothing to buy.
              These pages show a <b>sample</b> of each board; the full model — every game, every player
              prop, and the graded track record — opens up once you <b>request access and get approved</b>.
              We approve in small batches and email you when you&apos;re in.
            </p>
            <div className="lp-beta__cta">
              <a href="/signup" className="btn btn--primary">Request free beta access</a>
              <a href="/login" className="lp-lead__alt">Already a member? Log in →</a>
            </div>
          </div>
        )}

        {/* Name the destination. "Explore today's board" jumped to an anchor further down this same
            page, which told a first-time visitor nothing about what the site actually contains —
            these go straight into The Model for each sport, and the secondary links name the other
            two sections by name so the whole structure is visible from the hero. */}
        {/* Three sports, three buttons (Derek: "we also need to place an MLB button on the home
            page next to the NFL and NCAAF buttons").
            The labels lost "the Model's ... predictions" to make room. At three buttons the old
            wording summed to 861px inside a 760px column, so the row wrapped 2 + 1 and left MLB
            orphaned on its own line at every width including a 1400px desktop. Shorter labels put
            all three side by side (525px) and still name the destination, which is the whole point
            of these buttons — the section they land in is called The Model. */}
        <div className="lp-lead__cta">
          <a href="/model" className="btn btn--primary lp-lead__go">Explore the NFL Model</a>
          <a href="/ncaaf/model" className="btn btn--primary lp-lead__go">Explore the NCAAF Model</a>
          <a href="/mlb/model" className="btn btn--primary lp-lead__go">Explore the MLB Model</a>
        </div>
        <div className="lp-lead__cta lp-lead__cta--alt">
          <a href="/considerations" className="lp-lead__alt">See the Context that shapes a game →</a>
          <a href="/lines" className="lp-lead__alt">See how Value Finder works →</a>
        </div>
        <ul className="lp-trust" aria-label="What StatSeer stands for">
          <li>Line-blind projections</li>
          <li>Every published read graded</li>
          <li>US sportsbooks compared</li>
          <li>No guaranteed-win claims</li>
        </ul>
      </section>

      {/* The "aha": the same picks pay differently — Value Finder's value prop, made tangible. */}
      <section className="lp-aha">
        <span className="lp-aha__tag">Example · the same 3 picks</span>
        <h2 className="lp-aha__h">The same bet can pay <em>differently</em>.</h2>
        <p className="lp-aha__sub">
          One parlay, three sportsbooks — the payout isn&apos;t the same. StatSeer prices your <b>whole card</b>{" "}
          at every book and hands you the one that pays the most.
        </p>
        <div className="lp-aha__books">
          <div className="lp-ahabook lp-ahabook--best">
            <span className="lp-ahabook__name">FanDuel</span>
            <span className="lp-ahabook__odds">+625</span>
            <span className="lp-ahabook__flag">Best price</span>
          </div>
          <div className="lp-ahabook">
            <span className="lp-ahabook__name">DraftKings</span>
            <span className="lp-ahabook__odds">+580</span>
          </div>
          <div className="lp-ahabook">
            <span className="lp-ahabook__name">BetMGM</span>
            <span className="lp-ahabook__odds">+545</span>
          </div>
        </div>
        <p className="lp-aha__note">
          On a $50 stake that&apos;s <b>$40 more</b> for the exact same bet. <a href="/lines">Build your slip →</a>
        </p>
      </section>

      {/* How we suggest using StatSeer — the intended flow, member-empowerment framing. */}
      <section className="lp-howto" aria-label="How to use StatSeer">
        <span className="lp-howto__tag">How we suggest using StatSeer</span>
        <h2 className="lp-howto__h">Your data, <em>your way.</em></h2>
        <p className="lp-howto__sub">
          StatSeer puts the numbers in your hands — you decide what matters. Here&apos;s the flow we&apos;d run.
        </p>
        <ol className="lp-howto__steps">
          <li className="lp-howstep">
            <span className="lp-howstep__n">1</span>
            <div className="lp-howstep__body">
              <b>Review each page and its subsections.</b> The Model, the Context, the Value Finder —
              see what every number is saying.
            </div>
          </li>
          <li className="lp-howstep">
            <span className="lp-howstep__n">2</span>
            <div className="lp-howstep__body">
              <b>Find picks you&apos;re jiving with.</b> The reads that click for you, on the games you care about.
            </div>
          </li>
          <li className="lp-howstep">
            <span className="lp-howstep__n">3</span>
            <div className="lp-howstep__body">
              <b>Save them to your betslip.</b> Parlay them and let StatSeer shop the <b>best price</b> across books.
            </div>
          </li>
          <li className="lp-howstep">
            <span className="lp-howstep__n">4</span>
            <div className="lp-howstep__body">
              <b>Add any chart or data point to your Custom Dashboard.</b> Your favorites, in one place —
              quick and easy access, no hunting.
            </div>
          </li>
          <li className="lp-howstep lp-howstep--fun">
            <span className="lp-howstep__n">5</span>
            <div className="lp-howstep__body"><b>Go have fun.</b> <span className="lp-howstep__resp">Bet responsibly.</span></div>
          </li>
        </ol>
      </section>

      <LandingHub initialSport={initialSport} nfl={nfl} ncaaf={ncaaf} vf={vf} isMember={isMember}
        spotlight={spotlight ? { ctx: spotlight.ctx, row: spotlight.row } : null} />

      {/* Public track record — the trust engine. Honest preseason state until games grade. */}
      <section className="lp-record" aria-label="Track record">
        <h2 className="lp-record__h">Every read, graded in public.</h2>
        <p className="lp-record__sub">
          Nothing hidden. Every published call is timestamped and scored against the <b>closing line</b> —
          the number the market settled on.
        </p>
        <div className="lp-record__grid">
          <div className="lp-recstat"><span className="lp-recstat__n">—</span><span className="lp-recstat__l">Record</span></div>
          <div className="lp-recstat"><span className="lp-recstat__n">—</span><span className="lp-recstat__l">Win rate</span></div>
          <div className="lp-recstat"><span className="lp-recstat__n">—</span><span className="lp-recstat__l">ROI</span></div>
          <div className="lp-recstat"><span className="lp-recstat__n">—</span><span className="lp-recstat__l">Closing-line value</span></div>
        </div>
        <p className="lp-record__soon">
          <span className="lp-record__tag">Preseason validation underway</span>
          Public grading begins with the Week&nbsp;1 opener. Once games are played we&apos;ll show real,
          completed results — separately by sport and by market — never back-tested or projected numbers.
        </p>
      </section>

      {/* Feature depth — the modules as compact cards: an icon, a line, one action each. */}
      <section className="lp-feats">
        <h2 className="lp-feats__h">Everything under the hood.</h2>
        <p className="lp-feats__sub">Five modules, one job — help you make a sharper bet and never overpay for it.</p>
        <div className="lp-feats__grid">
          <a href="/model" className="lp-feat">
            <span className="lp-feat__ic" aria-hidden="true">📊</span>
            <span className="lp-feat__h">Game Model</span>
            <span className="lp-feat__p">Independent spreads &amp; totals, line-blind and compared to the market.</span>
            <span className="lp-feat__go">Open →</span>
          </a>
          <a href="/model/players" className="lp-feat">
            <span className="lp-feat__ic" aria-hidden="true">🎯</span>
            <span className="lp-feat__h">Player Model</span>
            <span className="lp-feat__p">Line-blind prop projections with published historical hit rates.</span>
            <span className="lp-feat__go">Open →</span>
          </a>
          {/* Context and Local Intelligence retired with that section; the factors they carried
              are under each game on the model board, so the tile points there. */}
          <a href="/model" className="lp-feat">
            <span className="lp-feat__ic" aria-hidden="true">🧭</span>
            <span className="lp-feat__h">Special Considerations</span>
            <span className="lp-feat__p">Weather, officiating, injuries and each team&apos;s scoring — on every game, beside the number.</span>
            <span className="lp-feat__go">Open →</span>
          </a>
          <a href="/lines" className="lp-feat lp-feat--vf">
            <span className="lp-feat__badge">Where the money is</span>
            <span className="lp-feat__ic" aria-hidden="true">🏷️</span>
            <span className="lp-feat__h">Value Finder</span>
            <span className="lp-feat__p">The best price for each bet — and the single best book for your whole slip.</span>
            <span className="lp-feat__go">Open →</span>
          </a>
          <a href="/assistant" className="lp-feat">
            <span className="lp-feat__ic" aria-hidden="true">✨</span>
            <span className="lp-feat__h">Slip Assistant</span>
            <span className="lp-feat__p">Short on time? Tell it what you want and it builds a slip from the real board.</span>
            <span className="lp-feat__go">Open →</span>
          </a>
        </div>
      </section>

      <HomePromo />

      <section className="lp-tagline">
        <p className="lp-hero__tag">
          One model reads every game <b>line-blind</b>, then shows you exactly where it disagrees with the
          market — and the <b>best price</b> on every pick.
        </p>
        <div className="lp-stats">
          <div className="lp-stat"><span className="lp-stat__n">100%</span><span className="lp-stat__l">reads graded in public</span></div>
          <div className="lp-stat lp-stat--wide"><span className="lp-stat__n">Line-blind</span><span className="lp-stat__l">every read, before the line</span></div>
        </div>
      </section>

      <section className="hb-creed">
        <div className="hb-creed__h">Bet smarter. <b>Never overpay.</b></div>
        <p className="hb-creed__p">
          StatSeer finds real edges and proves them in the open — published probabilities, an honest
          track record, and the best price on every pick. <a href="/how">How our model works →</a>
        </p>
      </section>
      </main>
    </>
  );
}
