export default function Loading() {
  return (
    <main className="wrap">
      <header className="masthead">
        <div className="brand">
          <span className="brand__mark">STATSEER</span>
          <span className="brand__sub">Loading…</span>
        </div>
      </header>
      <section className="grid" aria-hidden="true">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="game skeleton" />
        ))}
      </section>
    </main>
  );
}
