// Shared navigation. Pure presentational (no hooks / server-only code) so it can
// be used from both server pages and the client BoardView island.
//
// Three top-level SECTIONS (the canonical architecture):
//   Value Finder — where's the price wrong?  (Game Lines + Player Props live here)
//   The Model    — line-blind predictions
//   Context      — what to understand (informs, doesn't vote)

/** The guided journey: analyze → read the context → find the best price. */
export function FlowSteps({ active, base = "nfl" }: {
  active: "analyze" | "context" | "value"; base?: "nfl" | "ncaaf";
}) {
  const hrefs = base === "ncaaf"
    ? { analyze: "/ncaaf/model", context: "/ncaaf/context", value: "/ncaaf/lines" }
    : { analyze: "/model", context: "/context", value: "/lines" };
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
  { key: "nfl", label: "NFL", live: true, home: "/" },
  { key: "ncaaf", label: "NCAAF", live: true, home: "/ncaaf" },
  { key: "mlb", label: "MLB", live: false, home: "" },
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

/** Prominent "build your betslip" explainer for the shopping pages. */
export function SlipCallout({ kind }: { kind: "lines" | "props" }) {
  return (
    <div className="slipcta">
      <span className="slipcta__icon" aria-hidden="true">🎟️</span>
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

/** Masthead brand: logo mark + STATSEER wordmark + a section subtitle (string or node). */
export function Brand({ sub }: { sub: import("react").ReactNode }) {
  return (
    <div className="brand">
      <a href="/" className="brand__home" aria-label="StatSeer home">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-mark.png?v=4" alt="StatSeer" className="brand__logo" width={46} height={46} />
      </a>
      <div className="brand__text">
        <a href="/" className="brand__marklink"><span className="brand__mark">STATSEER</span></a>
        {sub ? <span className="brand__sub">{sub}</span> : null}
      </div>
    </div>
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
    ? { upset: "/ncaaf/context", special: "/ncaaf/considerations", fan: "/ncaaf/tailgate" }
    : { upset: "/context", special: "/considerations", fan: "/tailgate" };
  return (
    <nav className="subnav" aria-label="Context view">
      <a href={h.upset} className={active === "upset" ? "subnav__t active" : "subnav__t"}
        aria-current={active === "upset" ? "page" : undefined}>Upset Watch</a>
      <a href={h.special} className={active === "special" ? "subnav__t active" : "subnav__t"}
        aria-current={active === "special" ? "page" : undefined}>Special Considerations</a>
      <a href={h.fan} className={active === "fan" ? "subnav__t active" : "subnav__t"}
        aria-current={active === "fan" ? "page" : undefined}>Fan Analysis</a>
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
    <nav className="subnav" aria-label="Value Finder view">
      <a href={h.lines} className={active === "lines" ? "subnav__t active" : "subnav__t"}
        aria-current={active === "lines" ? "page" : undefined}>Game Lines</a>
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
