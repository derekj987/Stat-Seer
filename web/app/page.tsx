// Home — "The Model Edition" broadsheet. The Card (model vs market, per game) leads,
// open; the Upsets of the Week alert sits collapsed below it. All data is real and
// honest: model columns read "—" until the week's predictions lock (see lib/home.ts).
import { fetchHome, type CardRow, type UpsetRow, type PlayerPick } from "@/lib/home";
import AddToSlip from "./AddToSlip";
import HomePromo from "./HomePromo";

export const revalidate = 120;
const SEASON = 2026;

const kickFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});
const et = (iso: string) => kickFmt.format(new Date(iso)) + " ET";

function TheCard({ rows }: { rows: CardRow[] }) {
  return (
    <details className="hb-panel hb-panel--card" open>
      <summary className="hb-bar">
        <span className="hb-bar__title">The Card — model vs market</span>
        <span className="hb-bar__count">{rows.length} games</span>
        <span className="hb-bar__hint">our model&apos;s read beside the market&apos;s, every game</span>
        <span className="hb-bar__chev" aria-hidden="true">▾</span>
      </summary>
      <div className="hb-body">
        {rows.length === 0 ? (
          <p className="hb-empty">
            The board opens when this week&apos;s odds and model predictions post. Until then, see
            the latest in <a href="/model">The Model</a>.
          </p>
        ) : (
          <>
            <div className="hb-legend">
              <span className="hb-dia">◆</span> Off-consensus — our model and the market disagree on the pick.
            </div>
            <div className="hb-formwrap">
              <table className="hb-form">
                <thead>
                  <tr>
                    <th className="hb-l">Game</th><th>Spread</th><th>Model</th><th>O/U</th><th>Model O/U</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.eventId} className={r.off ? "hb-off" : undefined}>
                      <td className="hb-l">
                        <span className="hb-game" title={et(r.commence)}>
                          {r.away}<span className="hb-at">at</span>{r.home}
                        </span>
                        {r.off && <span className="hb-dia hb-dia--end" aria-label="off consensus">◆</span>}
                        {r.modelSpread && (
                          <span className="hb-slip">
                            <AddToSlip
                              item={{
                                id: `model-${r.eventId}`, kind: "model",
                                title: r.modelSpread, detail: `${r.away} @ ${r.home} · model read`,
                              }}
                              label="Slip"
                            />
                          </span>
                        )}
                      </td>
                      <td className="hb-num">{r.marketSpread ?? "—"}</td>
                      <td className="hb-num hb-model">{r.modelSpread ?? "—"}</td>
                      <td className="hb-num hb-tot">{r.marketTotal ?? "—"}</td>
                      <td className="hb-num hb-model">{r.modelTotal ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </details>
  );
}

function Upsets({ rows }: { rows: UpsetRow[] }) {
  return (
    <details className="hb-panel hb-panel--alert">
      <summary className="hb-bar">
        <span className="hb-dot" aria-hidden="true"></span>
        <span className="hb-bar__title hb-bar__title--gold">Upsets of the Week Alert</span>
        <span className="hb-bar__count hb-bar__count--gold">{rows.length}</span>
        <span className="hb-bar__hint">the market has them losing — our model says they win</span>
        <span className="hb-bar__chev" aria-hidden="true">▾</span>
      </summary>
      {rows.length === 0 ? (
        <div className="hb-body">
          <p className="hb-empty">
            No upset alerts this week — our model and the market agree on every game&apos;s side.
            They fire the moment a line and our read diverge, so check back as the week&apos;s odds move.
          </p>
        </div>
      ) : (
        <div className="hb-cols">
          {rows.map((u) => (
            <div className="hb-up" key={u.eventId}>
              <div className="hb-up__hd">
                <span className="hb-up__team">{u.dog}<small>{u.matchup}</small></span>
                {u.spread && <span className="hb-up__spread">{u.spread}</span>}
              </div>
              <div className="hb-up__note">
                The market has the {u.dog} losing. Our model has them <b>winning</b> by {u.byPoints.toFixed(1)}.
              </div>
              <div className="hb-cap">Chance to win the game</div>
              <div className="hb-prob hb-prob--m">
                <div className="hb-prob__t"><span>Our model says</span><span className="hb-prob__v">{u.modelPct}%</span></div>
                <div className="hb-prob__tr"><span style={{ width: `${u.modelPct}%` }} /></div>
              </div>
              <div className="hb-prob hb-prob--k">
                <div className="hb-prob__t"><span>The market says</span><span className="hb-prob__v">{u.marketPct}%</span></div>
                <div className="hb-prob__tr"><span style={{ width: `${u.marketPct}%` }} /></div>
              </div>
              <div className="hb-up__ft">
                <span className="hb-up__edge">Model likes them +{u.modelPct - u.marketPct}%</span>
                <AddToSlip
                  item={{
                    id: `upset-${u.eventId}`, kind: "model",
                    title: `${u.dog} upset`, detail: `${u.dog} ${u.matchup} · model backs the dog`,
                  }}
                  label="Slip"
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </details>
  );
}

function PlayersWeLike({ players }: { players: PlayerPick[] }) {
  if (players.length === 0) return null;
  return (
    <details className="hb-panel">
      <summary className="hb-bar">
        <span className="hb-bar__title hb-bar__title--gold">Players We Like</span>
        <span className="hb-bar__count hb-bar__count--gold">{players.length}</span>
        <span className="hb-bar__hint">rising on the fan boards this week</span>
        <span className="hb-bar__chev" aria-hidden="true">▾</span>
      </summary>
      <div className="hb-body">
        <p className="hb-players__sub">
          A starting point, not a pick — dig into each in <a href="/tailgate">Fan Analysis</a>.
        </p>
        <div className="hb-players__grid">
          {players.map((p) => (
            <a className="hb-plr" href="/tailgate" key={p.id}>
              <span className="hb-plr__name">{p.player}</span>
              <span className="hb-plr__team">{p.team}</span>
              <span className="hb-plr__angle"><span className="hb-plr__up" aria-hidden="true">▲</span>{p.angle}</span>
              {p.sources.length > 0 && (
                <span className="hb-plr__src">
                  <span className="hb-plr__srck">Heard on</span> {p.sources.join(" · ")}
                </span>
              )}
            </a>
          ))}
        </div>
      </div>
    </details>
  );
}

export default async function Home() {
  const data = await fetchHome(SEASON);
  return (
    <main className="hb">
      <header className="hb-mast">
        <div className="hb-mast__row">
          <span className="hb-mast__side">Week {data.week} · {data.season}</span>
          <a href="/" className="hb-mast__name">StatSeer</a>
          <span className="hb-mast__side hb-r">The Model Edition</span>
        </div>
        <div className="hb-mast__rule"></div>
        <div className="hb-strap">
          <span>Line-blind predictions</span><i>·</i>
          <span>published &amp; locked pre-kickoff</span><i>·</i>
          <span>graded in public</span>
        </div>
      </header>

      <TheCard rows={data.card} />
      <Upsets rows={data.upsets} />
      <PlayersWeLike players={data.players} />

      <section className="hb-creed">
        <div className="hb-creed__h">Bet smarter. <b>Win more often.</b></div>
        <p className="hb-creed__p">
          StatSeer finds real edges and proves them in the open — published probabilities, an honest
          track record, and the best price on every pick. <a href="/model">See the full model →</a> · <a href="/lines">Shop the lines →</a>
        </p>
      </section>

      <HomePromo />
    </main>
  );
}
