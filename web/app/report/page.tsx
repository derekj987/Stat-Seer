import type { Metadata } from "next";
import { Brand } from "../Nav";
import Tip from "@/app/Tip";
import { REPORT_CARDS, type ReportCard, type ReportGame, type ReportProp, type Tally, type WL } from "@/lib/reportCards";
import { REPORT_NOTES, noteKey } from "@/lib/reportNotes";
import { abbrevTeam } from "@/lib/ncaafAbbrev";

export const metadata: Metadata = {
  title: "StatSeer — Weekly Report Card",
  description: "Every read we published, graded against the closing line and the final score — wins, losses, and what we learned.",
};

// The weekly report card: what we PUBLISHED, graded. Every number here comes from
// weekly_report.py, which reads the files as they were committed before each kickoff (not the
// working copy) and grades them against FanDuel's last pregame line and the final score. The
// review under each card is written by hand after reading it (lib/reportNotes.ts).
//
// This page is the trust engine's receipt. It shows losing weeks in full, because a track record
// that only appears in good weeks is not one.

const CAT_LABEL: Record<string, string> = {
  passing: "Passing", rushing: "Rushing", receiving: "Receiving", receptions: "Receptions", td: "Anytime TD",
};
const CAT_ORDER = ["passing", "rushing", "receiving", "receptions", "td"];
const MARKET_LABEL: Record<string, string> = {
  pass_yds: "Pass yds", pass_tds: "Pass TDs", rush_yds: "Rush yds", rec_yds: "Rec yds", receptions: "Receptions", anytime_td: "Anytime TD",
};
const GAME_CAP = 6;
const PROP_CAP = 8;

const fmtRec = (t: Tally) => `${t.w}-${t.l}${t.p ? `-${t.p}` : ""}`;
const pct = (t: Tally) => (t.w + t.l ? Math.round((100 * t.w) / (t.w + t.l)) : null);
const spread = (n: number | null) => (n === null ? "—" : n > 0 ? `+${n}` : n === 0 ? "PK" : String(n));
const kickFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" });
const team = (sport: string, t: string) => (sport === "ncaaf" ? abbrevTeam(t) : t);

function Grade({ r }: { r: WL | null | undefined }) {
  if (!r) return <span className="rc-wl rc-wl--none">—</span>;
  return <span className={`rc-wl rc-wl--${r}`}>{r === "win" ? "W" : r === "loss" ? "L" : "P"}</span>;
}

function RecordCard({ label, t, sub }: { label: string; t: Tally; sub?: string }) {
  const p = pct(t);
  const tone = p === null ? "" : p >= 55 ? " rc-rec--good" : p < 45 ? " rc-rec--bad" : "";
  return (
    <div className={`rc-rec${tone}`}>
      <span className="rc-rec__l">{label}</span>
      <span className="rc-rec__v">{fmtRec(t)}</span>
      <span className="rc-rec__s">{p === null ? "no reads" : `${p}%`}{sub ? ` · ${sub}` : ""}</span>
    </div>
  );
}



function Card({ c }: { c: ReportCard }) {
  const s = c.gameSummary;
  const note = REPORT_NOTES[noteKey(c.sport, c.season, c.week)];
  // Prop leans across the continuous markets (TD is graded as calibration, not W/L).
  const leanTally: Tally = { w: 0, l: 0, p: 0 };
  for (const [cat, ps] of Object.entries(c.propSummary)) {
    if (cat === "td") continue;
    leanTally.w += ps.lean.w; leanTally.l += ps.lean.l; leanTally.p += ps.lean.p;
  }
  const td = c.propSummary.td;
  // Worst projection misses (continuous markets), then every graded lean, capped.
  const graded = c.props.filter((p) => p.actual !== null);
  const misses = graded.filter((p) => p.market !== "anytime_td" && p.proj !== null)
    .sort((a, b) => Math.abs((b.proj ?? 0) - (b.actual ?? 0)) - Math.abs((a.proj ?? 0) - (a.actual ?? 0)))
    .slice(0, PROP_CAP);
  const leans = graded.filter((p) => p.lean && p.result && p.market !== "anytime_td")
    .sort((a, b) => a.game.localeCompare(b.game) || a.player.localeCompare(b.player));
  const gameId = `rc-g-${c.sport}-${c.week}`;
  const leanId = `rc-l-${c.sport}-${c.week}`;
  const wins = c.games.filter((g) => g.ats?.result === "win").length;
  return (
    <section className="rc" id={`${c.sport}-${c.week}`}>
      <header className="rc__head">
        <h2 className="rc__h">{c.label}
          <Tip label={c.label} text={<>
            <span className="tip__lead">Every read we published for {c.label}, graded against FanDuel&apos;s closing line and the final score.</span><br /><br />
            <b>What was graded:</b> the files as they were committed before each kickoff — not what the boards show today — so a projection refreshed after a game cannot flatter the record.<br /><br />
            <b>Straight-up</b> is our projected winner. <b>Vs the close</b> is the side of the market spread our margin implied. <b>Totals</b> is our number against the market&apos;s. <b>Prop leans</b> are the ▲/▼ the player board showed, graded over/under against the closing line; anytime TD is graded as calibration (our % vs the books&apos; vs how many scored) because a lean on a 15% player who does not score is the expected outcome, not a miss.
          </>} />
        </h2>
        {note && <p className="rc__headline">{note.headline}</p>}
      </header>

      <div className="rc-recs">
        <RecordCard label="Straight-up" t={s.su} />
        <RecordCard label="Vs the close" t={s.ats} sub={`laying ${fmtRec(s.lay)} · taking ${fmtRec(s.dog)}`} />
        <RecordCard label="Totals" t={s.totals} sub={`overs ${fmtRec(s.overs)} · unders ${fmtRec(s.unders)}`} />
        <RecordCard label="Prop leans" t={leanTally} sub="yardage & receptions" />
      </div>
      <p className="rc-line">
        Margin error: ours <b className="rc-ours">{s.marginMae}</b> · market <b>{s.marketMarginMae}</b> points
        {s.brier !== null && <> · Winner calibration (Brier, lower is better): ours <b className="rc-ours">{s.brier}</b> · market <b>{s.marketBrier}</b></>}
        {td && td.tdRows ? <> · Anytime TD: we said <b className="rc-ours">{td.meanOurs}%</b>, the books&apos; prices implied <b>{td.meanBook}%</b>, <b>{td.scoredPct}%</b> scored (Brier ours {td.brierOurs} · books {td.brierBook})</> : null}
      </p>

      {note && (
        <div className="rc-note">
          <h3 className="rc-note__h">What we learned</h3>
          <ul className="rc-note__list">{note.learned.map((t, i) => <li key={i}>{t}</li>)}</ul>
          <h3 className="rc-note__h">What changed because of it</h3>
          <ul className="rc-note__list">{note.changed.map((t, i) => <li key={i}>{t}</li>)}</ul>
          {note.caveat && <p className="rc-note__caveat">{note.caveat}</p>}
        </div>
      )}

      <section className="rc-chart">
      <h3 className="rc-sub">Game by game <span className="rc-muted">— {c.games.length} games, {wins} on the right side of the number</span></h3>
      <div className="hb-moretbl">
        <input type="checkbox" id={gameId} className="hb-moretbl__chk" aria-hidden="true" tabIndex={-1} />
        <div className="pmscroll">
          <table className="rc-tbl">
            <thead><tr><th>Game</th><th>Final</th><th>Our winner</th><th>Our side of the close</th><th>Total</th></tr></thead>
            <tbody>
              {c.games.map((g, i) => (
                <tr key={`${g.away}-${g.home}`} className={i >= GAME_CAP ? "hb-row--more" : undefined}>
                  <GameRowCells g={g} sport={c.sport} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {c.games.length > GAME_CAP && (
          <label htmlFor={gameId} className="hb-moretbl__sum">
            <span className="hb-more__chev" aria-hidden="true">▸</span>
            <span className="hb-moretbl__more">Show {c.games.length - GAME_CAP} more games</span>
            <span className="hb-moretbl__less">Show fewer</span>
          </label>
        )}
      </div>
      </section>

      <section className="rc-chart">
      <h3 className="rc-sub">Player props by category</h3>
      <div className="pmscroll">
        <table className="rc-tbl rc-tbl--cat">
          <thead><tr><th>Category</th><th>Graded</th><th>Leans</th><th>▲ over</th><th>▼ under</th><th>Our error</th><th>Book&apos;s error</th><th>Projected over</th><th>Went over</th></tr></thead>
          <tbody>
            {CAT_ORDER.filter((k) => c.propSummary[k]).map((k) => {
              const ps = c.propSummary[k];
              const p = pct(ps.lean);
              return (
                <tr key={k}>
                  <td><b>{CAT_LABEL[k]}</b></td>
                  <td className="rc-g__num">{ps.graded}<span className="rc-muted">/{ps.n}</span></td>
                  <td className="rc-g__num">{k === "td" ? <span className="rc-muted">calibration</span> : <>{fmtRec(ps.lean)}{p !== null && <span className="rc-muted"> {p}%</span>}</>}</td>
                  <td className="rc-g__num">{k === "td" ? "—" : fmtRec(ps.overLean)}</td>
                  <td className="rc-g__num">{k === "td" ? "—" : fmtRec(ps.underLean)}</td>
                  <td className="rc-g__num rc-ours">{ps.projMae ?? "—"}</td>
                  <td className="rc-g__num">{ps.lineMae ?? "—"}</td>
                  <td className="rc-g__num">{ps.projAboveLine === null ? "—" : `${ps.projAboveLine}%`}</td>
                  <td className="rc-g__num">{ps.actualOver === null ? "—" : `${ps.actualOver}%`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </section>

      {misses.length > 0 && (
        <section className="rc-chart">
          <h3 className="rc-sub">Biggest projection misses</h3>
          <div className="pmscroll">
            <table className="rc-tbl rc-tbl--props">
              <thead><tr><th>Player</th><th>Market</th><th>Close</th><th>Ours</th><th>Actual</th><th>Lean</th></tr></thead>
              <tbody>{misses.map((p) => <tr key={`${p.player}-${p.market}`}><PropRowCells p={p} /></tr>)}</tbody>
            </table>
          </div>
        </section>
      )}

      {leans.length > 0 && (
        <section className="rc-chart">
          <h3 className="rc-sub">Every graded lean <span className="rc-muted">— {leans.length} rows</span></h3>
          <div className="hb-moretbl">
            <input type="checkbox" id={leanId} className="hb-moretbl__chk" aria-hidden="true" tabIndex={-1} />
            <div className="pmscroll">
              <table className="rc-tbl rc-tbl--props">
                <thead><tr><th>Player</th><th>Market</th><th>Close</th><th>Ours</th><th>Actual</th><th>Lean</th></tr></thead>
                <tbody>
                  {leans.map((p, i) => (
                    <tr key={`${p.player}-${p.market}-${p.game}`} className={i >= PROP_CAP ? "hb-row--more" : undefined}>
                      <PropRowCells p={p} cont={i > 0 && leans[i - 1].player === p.player && leans[i - 1].game === p.game} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {leans.length > PROP_CAP && (
              <label htmlFor={leanId} className="hb-moretbl__sum">
                <span className="hb-more__chev" aria-hidden="true">▸</span>
                <span className="hb-moretbl__more">Show {leans.length - PROP_CAP} more rows</span>
                <span className="hb-moretbl__less">Show fewer</span>
              </label>
            )}
          </div>
        </section>
      )}
    </section>
  );
}

// Cell-only variants so the capped tables can own the <tr> (the hb-row--more class lives there).
function GameRowCells({ g, sport }: { g: ReportGame; sport: string }) {
  const a = team(sport, g.away), h = team(sport, g.home);
  const ourFav = g.model.homeMargin >= 0 ? h : a;
  const atsSide = g.ats ? (g.ats.side === "home" ? h : a) : null;
  return (
    <>
      <td className="rc-g__game"><b>{a}</b> @ <b>{h}</b><span className="rc-g__kick">{kickFmt.format(new Date(g.kickoff))}</span></td>
      <td className="rc-g__num">{g.final.away}–{g.final.home}</td>
      <td>{ourFav} by {Math.abs(g.model.homeMargin).toFixed(1)}<Grade r={g.su} /></td>
      <td>{g.ats ? <>{atsSide} {spread(g.ats.num)}<Grade r={g.ats.result} /></> : <span className="rc-muted">no line</span>}</td>
      <td>{g.total ? <>{g.total.call === "over" ? "Over" : "Under"} {g.total.num}<span className="rc-muted"> (ours {g.total.ours})</span><Grade r={g.total.result} /></> : <span className="rc-muted">—</span>}</td>
    </>
  );
}
// `cont`: a continuation row (same player as the row above — his receptions under his yards)
// blanks the name so the block reads as one player, the way the model board does it.
function PropRowCells({ p, cont }: { p: ReportProp; cont?: boolean }) {
  const td = p.market === "anytime_td";
  return (
    <>
      <td className="rc-p__player">{cont ? "" : <><b>{p.player}</b>{p.team && <span className="rc-muted"> {p.team}</span>}<span className="rc-p__game">{p.game}</span></>}</td>
      <td>{MARKET_LABEL[p.market] ?? p.market}</td>
      <td className="rc-g__num">{td ? `${p.line}%` : p.line}</td>
      <td className="rc-g__num rc-ours">{p.proj === null ? "—" : td ? `${p.proj.toFixed(1)}%` : p.proj.toFixed(1)}</td>
      <td className="rc-g__num">{p.actual === null ? <span className="rc-muted">n/a</span> : td ? (p.actual ? "scored" : "no") : p.actual}</td>
      <td>{p.lean ? <>{p.lean === "over" ? "▲ over" : "▼ under"}<Grade r={p.result} /></> : <span className="rc-muted">no lean</span>}</td>
    </>
  );
}

export default function Page() {
  const cards = [...REPORT_CARDS].sort((a, b) => b.season - a.season || b.week - a.week || a.sport.localeCompare(b.sport));
  return (
    <main className="wrap">
      <header className="masthead">
        <Brand sub={<><span className="brand__sport">NFL · NCAAF</span> · Report Card</>} />
      </header>
      <nav className="rc-jump" aria-label="Report cards">
        {cards.map((c) => <a key={`${c.sport}-${c.week}`} href={`#${c.sport}-${c.week}`} className="rc-jump__a">{c.label}</a>)}
      </nav>
      {cards.length === 0 ? (
        <p className="rc-muted">No graded weeks yet.</p>
      ) : cards.map((c) => <Card key={`${c.sport}-${c.season}-${c.week}`} c={c} />)}
    </main>
  );
}
