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
// Compact kickoff for the table's own column (day + time), e.g. "Sun 1:00 PM".
const kickShortFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit",
});
const etShort = (iso: string) => kickShortFmt.format(new Date(iso)).replace(",", "");
const numStr = (v: number | null) => (v === null ? "—" : String(v));

// Split-flap "odds board" number: each character rolls on its own cadence so the
// board always looks alive, even when the value hasn't changed. Purely cosmetic —
// the real value is exposed to screen readers via aria-label.
function Flap({ text, seed = 0 }: { text: string; seed?: number }) {
  return (
    <span className="flap" aria-label={text}>
      {Array.from(text).map((ch, i) => {
        const roll = ch >= "0" && ch <= "9";
        return (
        <span
          key={i}
          className={roll ? "flap__d" : "flap__s"}
          aria-hidden="true"
          style={roll ? {
            animationDelay: `${((i * 3.1 + seed * 4.3) % 22).toFixed(2)}s`,
            animationDuration: `${(24 + ((i * 3 + seed) % 16)).toFixed(2)}s`,
          } : undefined}
        >
          {ch === " " ? " " : ch}
        </span>
        );
      })}
    </span>
  );
}

function TheCard({ rows }: { rows: CardRow[] }) {
  return (
    <details className="hb-panel hb-panel--card" open>
      <summary className="hb-bar">
        <span className="hb-bar__title hb-bar__title--gold">The Card — model vs market</span>
        <span className="hb-bar__count">{rows.length} games</span>
        <span className="hb-bar__hint">our model&apos;s read beside the market&apos;s, every game</span>
        <span className="hb-bar__chev" aria-hidden="true">▾</span>
      </summary>
      <div className="hb-body">
        {rows.length === 0 ? (
          <p className="hb-empty">
            The board opens when this week&apos;s odds and model reads post. Until then, see
            the latest in <a href="/model">The Model</a>.
          </p>
        ) : (
          <>
            <div className="hb-legend">
              <span className="hb-dia">◆</span> Off-consensus — our model and the market disagree on the pick.
              <span className="hb-x"> · <b>Our Model Suggests</b> is our read at the market number, graded in public — informative, never a guaranteed bet. Tap <b>+</b> to add a pick to your slip.</span>
            </div>
            <div className="hb-formwrap">
              <table className="hb-form">
                <thead>
                  <tr>
                    <th className="hb-l">Game</th><th className="hb-x">Kickoff</th><th>Market Spread</th><th>Market O/U</th>
                    <th>
                      <a className="hb-modeltip" href="/model">Our Model Suggests
                        <span className="hb-modeltip__pop">See how the data works for our model inside.</span>
                      </a>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.eventId} className={r.off ? "hb-off" : undefined}>
                      <td className="hb-l">
                        <span className="hb-game" title={et(r.commence)}>
                          {r.away}<span className="hb-at">at</span>{r.home}
                        </span>
                        {r.off && <span className="hb-dia hb-dia--end" aria-label="off consensus">◆</span>}
                      </td>
                      <td className="hb-x hb-kick2">{etShort(r.commence)}</td>
                      <td className="hb-num"><Flap text={r.marketSpread ?? "—"} seed={i} /></td>
                      <td className="hb-num hb-tot"><Flap text={numStr(r.marketTotal)} seed={i + 4} /></td>
                      <td className="hb-suggest">
                        {r.spreadLean || r.totalLean ? (
                          <span className={r.off ? "hb-sugwrap hb-sugwrap--off" : "hb-sugwrap"}>
                            {r.spreadLean && (
                              <span className="hb-sug">
                                <span className="hb-sug__t">{r.spreadLean.side} {r.spreadLean.num}</span>
                                <AddToSlip compact label="Slip"
                                  item={{ id: `model-sp-${r.eventId}`, kind: "model",
                                    title: `${r.spreadLean.side} ${r.spreadLean.num}`, detail: `${r.away} @ ${r.home} · model spread` }} />
                              </span>
                            )}
                            {r.totalLean && (
                              <span className="hb-sug">
                                <span className="hb-sug__t">{r.totalLean.dir === "OVER" ? "Over" : "Under"} {r.totalLean.num}</span>
                                <AddToSlip compact label="Slip"
                                  item={{ id: `model-ou-${r.eventId}`, kind: "model",
                                    title: `${r.totalLean.dir === "OVER" ? "Over" : "Under"} ${r.totalLean.num}`, detail: `${r.away} @ ${r.home} · model total` }} />
                              </span>
                            )}
                          </span>
                        ) : <span className="hb-leannone">even</span>}
                      </td>
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
        <span className="hb-bar__title hb-bar__title--gold">Potential Upsets of the Week</span>
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
              <span className="hb-plr__angle">
                <span className={p.dir === "down" ? "hb-plr__up hb-plr__down" : "hb-plr__up"} aria-hidden="true">{p.dir === "down" ? "▼" : "▲"}</span>{p.angle}
              </span>
              {p.sources.length > 0 && (
                <span className="hb-plr__src">
                  <span className="hb-plr__srck">Trending on</span> {p.sources.join(" · ")}
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
      <div className="hb-main">
      <header className="hb-mast">
        <div className="hb-mast__eyes">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/seereyes.png" alt="" width={1983} height={793} />
        </div>
        <div className="hb-mast__row">
          <span className="hb-mast__flank">Line-blind reads</span>
          <a href="/" className="hb-mast__name">StatSeer</a>
          <span className="hb-mast__flank hb-mast__flank--r">Published, locked &amp; graded in public</span>
        </div>
        <div className="hb-mast__rule"></div>
      </header>

      <div className="hb-weeklabel">NFL Week {data.week} · {data.season}</div>
      <TheCard rows={data.card} />
      <Upsets rows={data.upsets} />
      <PlayersWeLike players={data.players} />

      <HomePromo />

      <section className="hb-slipf">
        <div className="hb-slipf__hd">
          <span className="hb-slipf__ic" aria-hidden="true">🎟️</span>
          <div>
            <h2 className="hb-slipf__h">Build your own bet slip — we tell you where to place it</h2>
            <p className="hb-slipf__p">
              Tap any pick anywhere on StatSeer — a model suggestion, a moneyline, a spread, a prop — and it
              lands on your slip. When you&apos;re ready, we show you the <b>single best sportsbook for every
              leg</b>, and for a parlay, the <b>one book with the best combined price</b>. Same bets, better
              numbers — you never leave value on the table.
            </p>
          </div>
        </div>
        <div className="hb-slipf__steps">
          <div className="hb-slipf__step"><span className="hb-slipf__n">1</span><b>Add your picks</b><span>Tap to save anything you like as you read the board.</span></div>
          <div className="hb-slipf__step"><span className="hb-slipf__n">2</span><b>We shop it</b><span>StatSeer compares every book and finds the best price.</span></div>
          <div className="hb-slipf__step"><span className="hb-slipf__n">3</span><b>You place it</b><span>Bet at the book we name — the same wager at a better number.</span></div>
        </div>
        <div className="hb-slipf__cta">
          <a href="/lines" className="btn btn--primary">Start a slip →</a>
          <a href="/how" className="btn">How it works →</a>
        </div>
      </section>

      <section className="hb-nav3">
        <h2 className="hb-nav3__h">There&apos;s a lot more inside</h2>
        <p className="hb-nav3__sub">
          The board above is a taste. StatSeer does two things — helps you make <b>smarter, data-driven picks</b>,
          then finds you the <b>maximum return</b> on them. Here&apos;s where each lives:
        </p>
        <div className="hb-nav3__grid">
          <a href="/model" className="hb-nav3__c">
            <span className="hb-nav3__k">The Model</span>
            <span className="hb-nav3__d">Line-blind reads on every game, published and graded in public — plus the calibration to check us.</span>
            <span className="hb-nav3__go">Open The Model →</span>
          </a>
          <a href="/context" className="hb-nav3__c">
            <span className="hb-nav3__k">Context</span>
            <span className="hb-nav3__d">Upset Watch, Special Considerations, and Fan Analysis — everything around a game a number can&apos;t capture.</span>
            <span className="hb-nav3__go">Read the Context →</span>
          </a>
          <a href="/lines" className="hb-nav3__c">
            <span className="hb-nav3__k">Value Finder</span>
            <span className="hb-nav3__d">Once you&apos;ve chosen a bet, we find the single best sportsbook for it — game lines, props, and sweet spots.</span>
            <span className="hb-nav3__go">Find the best price →</span>
          </a>
        </div>
      </section>
      </div>

      {/* Full-width closer below the grid so the seer column ends exactly at this
          rule (desktop) instead of running down alongside the creed + footer. */}
      <section className="hb-creed">
        <div className="hb-creed__h">Bet smarter. <b>Win more often.</b></div>
        <p className="hb-creed__p">
          StatSeer finds real edges and proves them in the open — published probabilities, an honest
          track record, and the best price on every pick. <a href="/model">See the full model →</a> · <a href="/how">How our model works →</a>
        </p>
      </section>

      <div className="hb-side" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-hero.png?v=2" alt="" className="hb-seerimg" width={543} height={580} />
      </div>
    </main>
  );
}
