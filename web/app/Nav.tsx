// Shared navigation. Mostly presentational so it can be used from both server pages
// and the client BoardView island. Brand embeds the route-aware MastheadSport badge.
import MastheadSport from "./MastheadSport";

//
// Three top-level SECTIONS (the canonical architecture):
//   Value Finder — where's the price wrong?  (Game Lines + Player Props live here)
//   The Model    — line-blind predictions
//   Context      — what to understand (informs, doesn't vote)

/** Prominent "Week N" label for the top of a section page. An optional `tip` (the info "?"
 *  popover) sits just to its right — the page's informational scroll. */
export function WeekBadge({ week, note, tip }: { week: number; note?: string; tip?: import("react").ReactNode }) {
  return (
    <div className="pageweekrow">
      <div className="pageweek">
        <span className="pageweek__k">Week</span>
        <span className="pageweek__n">{week}</span>
        {note && <span className="pageweek__note">{note}</span>}
      </div>
      {tip}
    </div>
  );
}

/** The guided journey: analyze → read the context → find the best price. */
export function FlowSteps({ active, base = "nfl" }: {
  active: "analyze" | "context" | "value"; base?: "nfl" | "ncaaf";
}) {
  const hrefs = base === "ncaaf"
    ? { analyze: "/ncaaf/model", context: "/ncaaf/considerations", value: "/ncaaf/lines" }
    : { analyze: "/model", context: "/considerations", value: "/lines" };
  const steps = [
    { key: "analyze", n: "1", label: "The Model", sub: "make your analysis", href: hrefs.analyze },
    { key: "context", n: "2", label: "Context", sub: "read the room", href: hrefs.context },
    { key: "value", n: "3", label: "Value Finder", sub: "find the best price", href: hrefs.value },
  ] as const;
  return (
    <nav className="flow" aria-label="How to use StatSeer">
      {steps.map((s, i) => (
        <span key={s.key} className="flow__item">
          <a href={s.href} className={s.key === active ? "flow__step active" : "flow__step"}>
            <span className="flow__n">{s.n}</span>
            <span className="flow__l">{s.label}<span className="flow__sub">{s.sub}</span></span>
          </a>
          {i < 2 && <span className="flow__arrow" aria-hidden="true">→</span>}
        </span>
      ))}
    </nav>
  );
}

// Sports on the roadmap. NFL is live; the rest turn on here as each is built + validated.
// The vision: every sport gets the same layout across Home / The Model / Context / Value Finder.
// Sports on the roadmap. NFL + NCAAF are live; the rest turn on here as each is
// built + validated. `home` is where the sport's tab links. The vision: every sport
// gets the same layout across Home / The Model / Context / Value Finder.
export const SPORTS = [
  { key: "nfl", label: "NFL", live: true, home: "/model" },
  { key: "ncaaf", label: "NCAAF", live: true, home: "/ncaaf/model" },
  { key: "mlb", label: "MLB", live: false, home: "/mlb" },
  { key: "nba", label: "NBA", live: false, home: "" },
  { key: "wnba", label: "WNBA", live: false, home: "" },
  { key: "soccer", label: "Soccer", live: false, home: "" },
];

/** Sport selector shown across The Model / Context / Value Finder. Live sports link
 *  to their section; `active` marks the current one; the rest read "Soon". */
export function SportTabs({ active = "nfl" }: { active?: string }) {
  return (
    <div className="sporttabs" aria-label="Sport">
      {SPORTS.map((s) => {
        if (!s.live) {
          return (
            <span key={s.key} className="sporttab sporttab--soon">
              {s.label}<em className="sporttab__soon">Soon</em>
            </span>
          );
        }
        const isActive = s.key === active;
        return (
          <a key={s.key} href={s.home}
            className={isActive ? "sporttab sporttab--active" : "sporttab sporttab--link"}
            aria-current={isActive ? "page" : undefined}>
            {s.label}
          </a>
        );
      })}
    </div>
  );
}

/** The "Find the best price" right-edge slide-out (same one as the homepage). A pure-CSS
 *  checkbox drawer: a slim tab pinned to the right; click to slide an example slip out. */
export function ValueFinderDrawer({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return (
    <div className="vf-drawer">
      <input type="checkbox" id="vf-toggle" className="vf-drawer__chk" aria-hidden="true" tabIndex={-1} defaultChecked={defaultOpen} />
      <label htmlFor="vf-toggle" className="vf-drawer__tab" title="Value Finder">
        <span className="vf-drawer__chev" aria-hidden="true">‹</span>
        <span className="vf-drawer__tabtext">Find the best price</span>
      </label>
      <label htmlFor="vf-toggle" className="vf-drawer__scrim" aria-hidden="true" />
      <aside className="vf-drawer__panel" aria-label="Value Finder">
        <label htmlFor="vf-toggle" className="vf-drawer__close" title="Close" aria-label="Close">✕</label>
        <section className="vf-pitch">
          <h2 className="vf-pitch__h">Find the <b>best price</b>.</h2>
          <p className="vf-pitch__sub">
            <b>Value Finder</b> shops every pick across <b>~10 sportsbooks</b> and shows you the single
            best place to bet each one — plus the <b>one book that pays the most</b> on your whole parlay.
            Same bets, better price.
          </p>

          <div className="vf-slip">
            <div className="vf-slip__tag">Example slip · 5 picks</div>
            <ul className="vf-slip__legs">
              <li className="vf-slip__leg">
                <span className="vf-slip__bet">NE <b>+3.5</b><small>NE @ SEA</small></span>
                <span className="vf-slip__book">FanDuel</span>
                <span className="vf-slip__odds">-108</span>
              </li>
              <li className="vf-slip__leg">
                <span className="vf-slip__bet">Under <b>48.5</b><small>SF @ LA</small></span>
                <span className="vf-slip__book">DraftKings</span>
                <span className="vf-slip__odds">-105</span>
              </li>
              <li className="vf-slip__leg">
                <span className="vf-slip__bet">D. Maye <b>o223.5</b><small>Pass Yds</small></span>
                <span className="vf-slip__book">FanDuel</span>
                <span className="vf-slip__odds">-110</span>
              </li>
              <li className="vf-slip__leg">
                <span className="vf-slip__bet">C. McCaffrey <b>o59.5</b><small>Rush Yds</small></span>
                <span className="vf-slip__book">BetMGM</span>
                <span className="vf-slip__odds">-112</span>
              </li>
              <li className="vf-slip__leg">
                <span className="vf-slip__bet">P. Nacua <b>o5.5</b><small>Rec</small></span>
                <span className="vf-slip__book">Caesars</span>
                <span className="vf-slip__odds">-120</span>
              </li>
            </ul>
            <div className="vf-slip__best">
              <div className="vf-slip__besth">Best book for all 5 picks</div>
              <div className="vf-slip__bestbig">
                <b className="vf-slip__bestbook">FanDuel</b>
                <span className="vf-slip__bestodds">+2280</span>
              </div>
              <p className="vf-slip__bestnote">
                The single sportsbook that pays the most on this exact 5-pick parlay — Value Finder
                checks all ~10 books for you and gives you the winner.
              </p>
            </div>
          </div>

          <a href="/lines" className="btn btn--primary vf-pitch__cta">Open the Value Finder →</a>
        </section>
      </aside>
    </div>
  );
}

/** Prominent "build your betslip" explainer for the shopping pages. */
export function SlipCallout({ kind }: { kind: "lines" | "props" }) {
  return (
    <div className="slipcta">
      <div className="slipcta__text">
        <b className="slipcta__h">Build your own betslip</b>
        <span>
          {kind === "lines"
            ? "Tap any moneyline, spread, or total to add it to your slip. StatSeer then tells you the single best sportsbook to place each bet — so you never leave value on the table."
            : "Tap any prop to add it to your slip or parlay. StatSeer finds the best sportsbook for each pick — and for a parlay, the one book with the best combined price."}
        </span>
      </div>
    </div>
  );
}

/** The full "Build your own bet slip" explainer (was the homepage Betslip). Shared so
 *  the homepage and the Player Props page show the identical section. */
export function BetslipPromo() {
  return (
    <details className="hb-slipf">
      <summary className="hb-slipf__bar">
        <span className="hb-slipf__h">Build your own bet slip — we tell you where to place it</span>
        <span className="hb-tav__right">
          <span className="hb-tav__ic hb-tav__ic--shut" aria-hidden="true">🍺</span>
          <span className="hb-tav__ic hb-tav__ic--open" aria-hidden="true">🍻</span>
          <span className="hb-tav__chev" aria-hidden="true">▾</span>
        </span>
      </summary>
      <div className="hb-slipf__body">
        <p className="hb-slipf__p">
          Tap any pick anywhere on StatSeer — a model suggestion, a moneyline, a spread, a prop — and it
          lands on your slip. When you&apos;re ready, we show you the <b>single best sportsbook for every
          leg</b>, and for a parlay, the <b>one book with the best combined price</b>.
        </p>
        <div className="hb-slipf__steps">
          <div className="hb-slipf__step"><span className="hb-slipf__n">1</span><b>Add your picks</b><span>Tap to save anything you like as you read the board.</span></div>
          <div className="hb-slipf__step"><span className="hb-slipf__n">2</span><b>We shop it</b><span>StatSeer compares every book and finds the best price.</span></div>
          <div className="hb-slipf__step"><span className="hb-slipf__n">3</span><b>You place it</b><span>Bet at the book we name — the same wager at a better number.</span></div>
        </div>
        <p className="hb-slipf__lead">Start on a game-lines board — tap a line to add it to your slip:</p>
        <div className="hb-slipf__cta">
          <a href="/lines" className="btn btn--primary">NFL Game Lines →</a>
          <a href="/ncaaf/lines" className="btn btn--primary">College Football Game Lines →</a>
          <a href="/how" className="btn">How it works →</a>
        </div>
      </div>
    </details>
  );
}

/** Masthead brand: logo mark + a section subtitle. The "StatSeer" wordmark lives in
 *  the global top bar now, so the masthead no longer repeats it. */
export function Brand({ sub, art, tip }: { sub: import("react").ReactNode; art?: { src: string; alt: string }; tip?: import("react").ReactNode }) {
  // Returns two masthead-level siblings: the brand cluster (left) and the sport badge.
  // As a flex sibling the badge sits in the masthead's open band without ever
  // overlapping the subtitle. It renders nothing on non-sport pages.
  // `art` is an optional per-sport image shown to the right of the subtitle (e.g. the
  // Heisman on NCAAF, the NFL mark on NFL — the model pages pass it).
  return (
    <>
      <div className="brand">
        <a href="/" className="brand__home" aria-label="StatSeer home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark.png?v=5" alt="StatSeer" className="brand__logo" width={46} height={46} />
        </a>
        <div className="brand__text">
          {sub ? <span className="brand__sub">{sub}</span> : null}
        </div>
        {tip ? <span className="brand__tip">{tip}</span> : null}
        {art ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={art.src} alt={art.alt} className="brand__art" />
        ) : null}
      </div>
      <MastheadSport />
    </>
  );
}

export function TopNav({ active }: { active: "value" | "model" | "context" }) {
  return (
    <nav className="tabs" aria-label="Section">
      <a href="/model" className={active === "model" ? "tab active" : "tab"}
        aria-current={active === "model" ? "page" : undefined}>The Model</a>
      <a href="/context" className={active === "context" ? "tab active" : "tab"}
        aria-current={active === "context" ? "page" : undefined}>Context (Upset Watch)</a>
      <a href="/lines" className={active === "value" ? "tab active" : "tab"}
        aria-current={active === "value" ? "page" : undefined}>Analysis</a>
    </nav>
  );
}

/** Sub-tabs inside Context. */
export function ContextSubnav({ active, base = "nfl" }: {
  active: "upset" | "fan" | "special"; base?: "nfl" | "ncaaf";
}) {
  const h = base === "ncaaf"
    ? { upset: "/ncaaf/context", special: "/ncaaf/considerations", fan: "/ncaaf/local-intelligence" }
    : { upset: "/context", special: "/considerations", fan: "/tailgate" };
  return (
    <nav className="subnav subnav--context" aria-label="Context view">
      <a href={h.special} className={active === "special" ? "subnav__t active" : "subnav__t"}
        aria-current={active === "special" ? "page" : undefined}>Special Considerations</a>
      <a href={h.upset} className={active === "upset" ? "subnav__t active" : "subnav__t"}
        aria-current={active === "upset" ? "page" : undefined}>Upset Watch</a>
      <a href={h.fan} className={active === "fan" ? "subnav__t active" : "subnav__t"}
        aria-current={active === "fan" ? "page" : undefined}>Local Intelligence</a>
    </nav>
  );
}

/** Mobile-only "there's more to the right" nudge for horizontally-scrolling tables.
 *  Hidden on desktop; shown (with an animated arrow) only on phone widths. */
export function ScrollHint({ label = "Scroll for more" }: { label?: string }) {
  return (
    <p className="scrollnudge" aria-hidden="true">
      {label} <span className="scrollnudge__a">→</span>
    </p>
  );
}

/** One table with a "see more" toggle that reveals the overflow rows IN PLACE — so there's
 *  a single <table> (one scroll container) instead of two stacked tables. Mark overflow
 *  <tr>s with className="hb-row--more". `plr` adds the wide 6-col style + a swipe hint. */
export function MoreTable({ id, head, extra, noun, plr, cls, children }: {
  id: string; head: import("react").ReactNode; extra: number; noun: string; plr?: boolean; cls?: string; children: import("react").ReactNode;
}) {
  return (
    <div className="hb-moretbl">
      <input type="checkbox" id={id} className="hb-moretbl__chk" aria-hidden="true" tabIndex={-1} />
      {plr && <ScrollHint />}
      <div className="hb-formwrap">
        <table className={`${plr ? "hb-form hb-plrtable" : "hb-form"}${cls ? " " + cls : ""}`}>{head}<tbody>{children}</tbody></table>
      </div>
      {extra > 0 && (
        <label htmlFor={id} className="hb-moretbl__sum">
          <span className="hb-more__chev" aria-hidden="true">▸</span>
          <span className="hb-moretbl__more">See more ({extra} more {noun})</span>
          <span className="hb-moretbl__less">See less</span>
        </label>
      )}
    </div>
  );
}

/** Sub-tabs inside The Model (Game Model · Player Model). Sits under the leftmost
 *  "The Model" flow step, so it left-aligns like the flow. */
export function ModelSubnav({ active = "game", base = "nfl" }: {
  active?: "game" | "player"; base?: "nfl" | "ncaaf";
}) {
  const game = base === "ncaaf" ? "/ncaaf/model" : "/model";
  const player = base === "ncaaf" ? "/ncaaf/model/players" : "/model/players";
  return (
    <nav className="subnav subnav--model" aria-label="The Model view">
      <a href={game} className={active === "game" ? "subnav__t active" : "subnav__t"}
        aria-current={active === "game" ? "page" : undefined}>Game Model (spreads, O/U&apos;s)</a>
      <a href={player} className={active === "player" ? "subnav__t active" : "subnav__t"}
        aria-current={active === "player" ? "page" : undefined}>Player Model (props)</a>
    </nav>
  );
}

/** Sub-tabs inside Value Finder (Game Lines · Player Props · Sweet Spots). */
export function ShopSubnav({ active, base = "nfl" }: {
  active: "lines" | "props" | "best"; base?: "nfl" | "ncaaf";
}) {
  const h = base === "ncaaf"
    ? { lines: "/ncaaf/lines", props: "/ncaaf/props", best: "/ncaaf/best" }
    : { lines: "/lines", props: "/props", best: "/best" };
  return (
    <nav className="subnav subnav--value" aria-label="Value Finder view">
      <a href={h.lines} className={active === "lines" ? "subnav__t active" : "subnav__t"}
        aria-current={active === "lines" ? "page" : undefined}>Line Shopping</a>
      <a href={h.props} className={active === "props" ? "subnav__t active" : "subnav__t"}
        aria-current={active === "props" ? "page" : undefined}>Player Props</a>
      <a href={h.best} className={active === "best" ? "subnav__t active" : "subnav__t"}
        aria-current={active === "best" ? "page" : undefined}>Sweet Spots</a>
    </nav>
  );
}

/** The Value Finder is line-shopping only — it points members to the picks pages. */
export function ValueFinderNote() {
  return (
    <p className="vfnote">
      <b>Value Finder is about price, not picks.</b> It finds the single best sportsbook for a bet you&apos;ve
      already chosen. For our data-driven picks and analysis, head to <a href="/model">The Model</a> and{" "}
      <a href="/context">Context</a>.
    </p>
  );
}

/** Regular-season vs preseason toggle within a Shop area. */
export function SeasonSubnav({ area, active }: { area: "lines" | "props"; active: "reg" | "pre" }) {
  const reg = area === "lines" ? "/lines" : "/props";
  const pre = area === "lines" ? "/preseason" : "/props?season=pre";
  return (
    <nav className="subnav subnav--season" aria-label="Season">
      <a href={reg} className={active === "reg" ? "subnav__t active" : "subnav__t"}
        aria-current={active === "reg" ? "page" : undefined}>Regular Season</a>
      <a href={pre} className={active === "pre" ? "subnav__t active" : "subnav__t"}
        aria-current={active === "pre" ? "page" : undefined}>Preseason</a>
    </nav>
  );
}
