// The landing's heart: the Model → Context → Value flow with an NFL | NCAAF toggle that
// also drives the live snapshot (The Model Card, Players We Like, Upsets). Implemented as
// a pure-CSS radio toggle so it never depends on client hydration — both sports render
// server-side and CSS shows the selected one. ?sport=ncaaf sets the initial pick.
import type { CardRow, UpsetRow, PlayerPick } from "@/lib/home";
import type { NcaafCardGame, NcaafUpset } from "./ncaaf/model-data";

type Sport = "nfl" | "ncaaf";
type NflData = { week: number; card: CardRow[]; upsets: UpsetRow[]; players: PlayerPick[] };
type NcaafData = { week: number; games: NcaafCardGame[]; upsets: NcaafUpset[] };

const numStr = (v: number | null) => (v === null ? "—" : String(v));

const STEPS = [
  { n: 1, key: "model", title: "See the Model", lead: "What the data says.", href: { nfl: "/model", ncaaf: "/ncaaf/model" } },
  { n: 2, key: "context", title: "Read the Room", lead: "The factors you may not have thought of.", href: { nfl: "/context", ncaaf: "/ncaaf/context" } },
  { n: 3, key: "value", title: "Find the Value", lead: "Decide your picks — we tell you where to place them.", href: { nfl: "/lines", ncaaf: "/ncaaf/lines" } },
] as const;

function Flow({ sport, label }: { sport: Sport; label: string }) {
  return (
    <div className="lpf__steps">
      {STEPS.map((s) => (
        <a key={s.key} href={s.href[sport]} className={`lpf__step lpf__step--${s.key}`}>
          <span className="lpf__n">{s.n}</span>
          <span className="lpf__title">{s.title}</span>
          <span className="lpf__lead">{s.lead}</span>
          <span className="lpf__go">Open {label} →</span>
        </a>
      ))}
    </div>
  );
}

function Panel({ title, count, hint, open, children }: { title: string; count: React.ReactNode; hint: string; open?: boolean; children: React.ReactNode }) {
  return (
    <details className="hb-panel" open={open}>
      <summary className="hb-bar">
        <span className="hb-bar__title hb-bar__title--gold">{title}</span>
        <span className="hb-bar__count hb-bar__count--gold">{count}</span>
        <span className="hb-bar__hint">{hint}</span>
        <span className="hb-bar__chev" aria-hidden="true">▾</span>
      </summary>
      <div className="hb-body">{children}</div>
    </details>
  );
}

function NflCardTable({ rows }: { rows: CardRow[] }) {
  if (!rows.length) return <p className="hb-empty">The NFL board opens when this week&apos;s odds and reads post.</p>;
  return (
    <div className="hb-formwrap">
      <table className="hb-form">
        <thead><tr><th className="hb-l">Game</th><th>Market Spread</th><th>Market O/U</th><th>Our Model Suggests</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.eventId} className={r.off ? "hb-off" : undefined}>
              <td className="hb-l"><span className="hb-game">{r.away}<span className="hb-at">at</span>{r.home}</span>{r.off && <span className="hb-dia hb-dia--end">◆</span>}</td>
              <td className="hb-num">{r.marketSpread ?? "—"}</td>
              <td className="hb-num hb-tot">{numStr(r.marketTotal)}</td>
              <td className="hb-suggest">
                {r.spreadLean || r.totalLean ? (
                  <span className="hb-sugwrap">
                    {r.spreadLean && <span className="hb-sug"><span className="hb-sug__t">{r.spreadLean.side} {r.spreadLean.num}</span></span>}
                    {r.totalLean && <span className="hb-sug"><span className="hb-sug__t">{r.totalLean.dir === "OVER" ? "Over" : "Under"} {r.totalLean.num}</span></span>}
                  </span>
                ) : <span className="hb-leannone">even</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NcaafCardTable({ games }: { games: NcaafCardGame[] }) {
  const featured = games.filter((g) => g.featured);
  const show = (featured.length ? featured : games).slice(0, 14);
  return (
    <div className="hb-formwrap">
      <table className="hb-form">
        <thead><tr><th className="hb-l">Game</th><th>Market Spread</th><th>Market O/U</th><th>Our Model Suggests</th></tr></thead>
        <tbody>
          {show.map((g) => {
            const ms = g.marketSpread; const ps = g.projSpread; const tl = g.totalLean; const pk = g.pick;
            const pick = pk ? `${pk.side} ${pk.num > 0 ? "+" : ""}${pk.num}` : `${ps.fav} ${ps.num}`;
            return (
              <tr key={`${g.away}-${g.home}`} className={g.off ? "hb-off" : undefined}>
                <td className="hb-l"><span className="hb-game">{g.away}<span className="hb-at">at</span>{g.home}</span>{g.neutral ? <span className="ncf-site"> · N</span> : null}{g.off && <span className="hb-dia hb-dia--end">◆</span>}</td>
                <td className="hb-num">{ms ? `${ms.fav} ${ms.num}` : "—"}</td>
                <td className="hb-num hb-tot">{g.marketTotal ?? "—"}</td>
                <td className="hb-suggest"><span className="hb-sugwrap"><span className="hb-sug"><span className="hb-sug__t">{pick}</span></span>{tl && <span className="hb-sug"><span className="hb-sug__t">{tl.dir === "OVER" ? "Over" : "Under"} {tl.num}</span></span>}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function playLine(p: PlayerPick): string {
  if (p.side === "Yes") { const l = p.marketLabel ?? "anytime TD"; return l.charAt(0).toUpperCase() + l.slice(1); }
  return [p.side, p.line != null ? String(p.line) : null, p.marketLabel].filter(Boolean).join(" ");
}
function PlayersTable({ players }: { players: PlayerPick[] }) {
  if (!players.length) return <p className="hb-empty">Player reads post with the week&apos;s props — see <a href="/tailgate">Fan Analysis</a>.</p>;
  return (
    <div className="hb-formwrap">
      <table className="hb-form hb-plrtable">
        <thead><tr><th className="hb-l">Player</th><th>Team</th><th>The play</th><th>Best book</th><th>Trending on</th></tr></thead>
        <tbody>
          {players.slice(0, 14).map((p) => (
            <tr key={p.id}>
              <td className="hb-l"><a className="hb-plrlink" href="/tailgate">{p.player}</a></td>
              <td className="hb-num">{p.team}</td>
              <td><span className={p.dir === "down" ? "hb-plr__up hb-plr__down" : "hb-plr__up"} aria-hidden="true">{p.dir === "down" ? "▼" : "▲"}</span> {playLine(p)}</td>
              <td>{p.book ?? "—"}</td>
              <td className="hb-plr__srccell">{p.sources.length ? p.sources.join(" · ") : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UpsetCards({ children }: { children: React.ReactNode }) { return <div className="hb-cols">{children}</div>; }

export default function LandingHub({ initialSport, nfl, ncaaf }: { initialSport: Sport; nfl: NflData; ncaaf: NcaafData }) {
  return (
    <section className="lp-hub" aria-label="How StatSeer works">
      {/* pure-CSS sport toggle — no client JS needed */}
      <input type="radio" name="lpsport" id="lps-nfl" className="lp-r" defaultChecked={initialSport === "nfl"} />
      <input type="radio" name="lpsport" id="lps-ncaaf" className="lp-r" defaultChecked={initialSport === "ncaaf"} />

      <div className="lpf__head">
        <h2 className="lpf__h">Three steps, in order.</h2>
        <div className="lpf__toggle" role="tablist" aria-label="Choose a sport">
          <label htmlFor="lps-nfl" className="lpf__t">NFL</label>
          <label htmlFor="lps-ncaaf" className="lpf__t">NCAAF</label>
        </div>
      </div>
      <p className="lpf__sub">Read what the model sees, weigh what it can&apos;t, then find the best price. Everything below opens the sport you pick.</p>

      {/* NFL panel */}
      <div className="lp-sport lp-sport--nfl">
        <Flow sport="nfl" label="NFL" />
        <div className="lp-snaplabel">NFL · Week {nfl.week} — a snapshot</div>
        <Panel title="The Model Card — NFL" count={`${nfl.card.length} games`} hint="our model’s read beside the market’s" open>
          <NflCardTable rows={nfl.card} />
          <p className="lp-cardfoot"><a href="/model">See the full model →</a></p>
        </Panel>
        <Panel title="Players the model likes — NFL" count={nfl.players.length || "—"} hint="rising on the fan boards this week">
          <PlayersTable players={nfl.players} />
        </Panel>
        <Panel title="Potential Upsets of the Week — NFL" count={nfl.upsets.length} hint="the market has them losing — our model says they win">
          {nfl.upsets.length === 0 ? <p className="hb-empty">No upset alerts this week — our model and the market agree on every game&apos;s side.</p> : (
            <UpsetCards>{nfl.upsets.map((u) => (
              <div className="hb-up" key={u.eventId}>
                <div className="hb-up__hd"><span className="hb-up__team">{u.dog}<small>{u.matchup}</small></span>{u.spread && <span className="hb-up__spread">{u.spread}</span>}</div>
                <div className="hb-up__note">The market has the {u.dog} losing. Our model has them <b>winning</b> by {u.byPoints.toFixed(1)}.</div>
                <div className="hb-up__ft"><span className="hb-up__edge">Model likes them +{u.modelPct - u.marketPct}%</span></div>
              </div>
            ))}</UpsetCards>
          )}
        </Panel>
      </div>

      {/* NCAAF panel */}
      <div className="lp-sport lp-sport--ncaaf">
        <Flow sport="ncaaf" label="College Football" />
        <div className="lp-snaplabel">College Football · Week {ncaaf.week} — a snapshot</div>
        <Panel title="The Model Card — NCAAF" count={`${ncaaf.games.length} ranked`} hint="our line-blind read beside the market" open>
          <NcaafCardTable games={ncaaf.games} />
          <p className="lp-cardfoot"><a href="/ncaaf/model">See the full model →</a></p>
        </Panel>
        <Panel title="Players the model likes — NCAAF" count="—" hint="arriving with the season">
          <p className="hb-empty">College player reads land here once the CFB fan scan is wired — the same read we run for the NFL on <a href="/ncaaf/tailgate">Fan Analysis</a>.</p>
        </Panel>
        <Panel title="Potential Upsets of the Week — NCAAF" count={ncaaf.upsets.length} hint="the market has them losing — our model says they win">
          {ncaaf.upsets.length === 0 ? <p className="hb-empty">No upset alerts this week — our rating agrees with the market&apos;s favorite on the board.</p> : (
            <UpsetCards>{ncaaf.upsets.map((u) => (
              <div className="hb-up" key={`${u.dog}-${u.matchup}`}>
                <div className="hb-up__hd"><span className="hb-up__team">{u.dog}<small>{u.matchup}</small></span><span className="hb-up__spread">{u.spread}</span></div>
                <div className="hb-up__note">The market has the {u.dog} losing. Our model has them <b>winning</b> by {u.byPoints.toFixed(1)}.</div>
                <div className="hb-up__ft"><span className="hb-up__edge">Model likes them +{u.modelPct - u.marketPct}%</span></div>
              </div>
            ))}</UpsetCards>
          )}
        </Panel>
      </div>
    </section>
  );
}
