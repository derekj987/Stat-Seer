import { Brand } from "./Nav";

export default function Loading() {
  return (
    <main className="wrap">
      <header className="masthead">
        <Brand sub="Loading…" />
      </header>
      <section className="grid" aria-hidden="true">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="game skeleton" />
        ))}
      </section>
    </main>
  );
}
