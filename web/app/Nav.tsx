// Shared navigation. Pure presentational (no hooks / server-only code) so it can
// be used from both server pages and the client BoardView island.
//
// Three top-level SECTIONS (the canonical architecture):
//   Value Finder — where's the price wrong?  (Game Lines + Player Props live here)
//   The Model    — line-blind predictions
//   Context      — what to understand (informs, doesn't vote)

/** Masthead brand: logo mark + STATSEER wordmark + a section subtitle. */
export function Brand({ sub }: { sub: string }) {
  return (
    <div className="brand">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-mark.png" alt="StatSeer" className="brand__logo" width={46} height={46} />
      <div className="brand__text">
        <span className="brand__mark">STATSEER</span>
        <span className="brand__sub">{sub}</span>
      </div>
    </div>
  );
}

export function TopNav({ active }: { active: "value" | "model" | "context" }) {
  return (
    <nav className="tabs" aria-label="Section">
      <a href="/best" className={active === "value" ? "tab active" : "tab"}
        aria-current={active === "value" ? "page" : undefined}>Value Finder</a>
      <a href="/model" className={active === "model" ? "tab active" : "tab"}
        aria-current={active === "model" ? "page" : undefined}>The Model</a>
      <a href="/context" className={active === "context" ? "tab active" : "tab"}
        aria-current={active === "context" ? "page" : undefined}>Context</a>
    </nav>
  );
}

/** Secondary toggle shown only inside Value Finder. */
export function ValueSubnav({ active }: { active: "best" | "lines" | "props" }) {
  return (
    <nav className="subnav" aria-label="Value Finder view">
      <a href="/best" className={active === "best" ? "subnav__t active" : "subnav__t"}
        aria-current={active === "best" ? "page" : undefined}>Best Bets</a>
      <a href="/" className={active === "lines" ? "subnav__t active" : "subnav__t"}
        aria-current={active === "lines" ? "page" : undefined}>Game Lines</a>
      <a href="/props" className={active === "props" ? "subnav__t active" : "subnav__t"}
        aria-current={active === "props" ? "page" : undefined}>Player Props</a>
    </nav>
  );
}
