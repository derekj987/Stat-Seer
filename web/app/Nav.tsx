// Shared navigation. Pure presentational (no hooks / server-only code) so it can
// be used from both server pages and the client BoardView island.
//
// Three top-level SECTIONS (the canonical architecture):
//   Value Finder — where's the price wrong?  (Game Lines + Player Props live here)
//   The Model    — line-blind predictions
//   Context      — what to understand (informs, doesn't vote)

/** The guided journey: read the model → pressure-test it → find the price. */
export function FlowSteps({ active }: { active: "model" | "context" | "value" }) {
  const steps = [
    { key: "model", n: "1", label: "The Model", sub: "our read", href: "/model" },
    { key: "context", n: "2", label: "Context (Upset Watch)", sub: "pressure-test it", href: "/context" },
    { key: "value", n: "3", label: "Value Finder", sub: "place it", href: "/lines" },
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

/** Masthead brand: logo mark + STATSEER wordmark + a section subtitle. */
export function Brand({ sub }: { sub: string }) {
  return (
    <div className="brand">
      <a href="/" className="brand__home" aria-label="StatSeer home">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-mark.png" alt="StatSeer" className="brand__logo" width={46} height={46} />
      </a>
      <div className="brand__text">
        <a href="/" className="brand__marklink"><span className="brand__mark">STATSEER</span></a>
        <span className="brand__sub">{sub}</span>
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
        aria-current={active === "value" ? "page" : undefined}>Value Finder</a>
    </nav>
  );
}

/** Secondary toggle shown only inside Value Finder. */
export function ValueSubnav({ active }: { active: "best" | "lines" | "props" }) {
  return (
    <nav className="subnav" aria-label="Value Finder view">
      <a href="/lines" className={active === "lines" ? "subnav__t active" : "subnav__t"}
        aria-current={active === "lines" ? "page" : undefined}>Game Lines</a>
      <a href="/props" className={active === "props" ? "subnav__t active" : "subnav__t"}
        aria-current={active === "props" ? "page" : undefined}>Player Props</a>
      <a href="/best" className={active === "best" ? "subnav__t active" : "subnav__t"}
        aria-current={active === "best" ? "page" : undefined}>Best Bets</a>
    </nav>
  );
}
