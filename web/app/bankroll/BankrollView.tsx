"use client";

// The bankroll + CLV tracker UI. Log a bet, settle it (won/lost/push), and watch your record,
// profit (in $ and units), ROI, win%, and closing-line value. All per-member in localStorage.
import { useState } from "react";
import { useBankroll, betProfit, betCLV, fmtOdds } from "@/lib/bankroll";

const dfmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
const day = (iso: string) => { try { return dfmt.format(new Date(iso)); } catch { return iso.slice(0, 10); } };
const money = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(n).toFixed(2)}`;
const signed = (n: number, suffix = "") => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(1)}${suffix}`;
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

// Parse "+150" / "-110" / "150" → number. Returns null if not a valid american price.
function parseOdds(s: string): number | null {
  const t = s.trim().replace(/^\+/, "");
  if (!/^-?\d+$/.test(t)) return null;
  const n = Number(t);
  if (!n || (n > -100 && n < 100)) return null;   // american odds are ≥100 or ≤−100
  return n;
}

export default function BankrollView() {
  const { bets, settings, stats, addBet, settleBet, setClose, removeBet, updateSettings } = useBankroll();
  const [pick, setPick] = useState("");
  const [book, setBook] = useState("");
  const [odds, setOdds] = useState("");
  const [stake, setStake] = useState(String(settings.unit || 25));
  const [close, setCloseInput] = useState("");
  const [err, setErr] = useState("");
  const [showSettings, setShowSettings] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const o = parseOdds(odds);
    const s = Number(stake);
    if (!pick.trim()) { setErr("Add what you bet on."); return; }
    if (o == null) { setErr("Odds must be American, e.g. -110 or +150."); return; }
    if (!s || s <= 0) { setErr("Stake must be a positive number."); return; }
    const c = close.trim() ? parseOdds(close) : null;
    if (close.trim() && c == null) { setErr("Closing odds must be American too (or leave blank)."); return; }
    setErr("");
    addBet({ pick: pick.trim().slice(0, 120), book: book.trim().slice(0, 40) || undefined, odds: o, stake: s, closeOdds: c, result: "pending", placedAt: todayISO() });
    setPick(""); setBook(""); setOdds(""); setCloseInput(""); setStake(String(settings.unit || 25));
  };

  const plTone = stats.profit > 0 ? "up" : stats.profit < 0 ? "down" : "";
  const roiTone = stats.roi > 0 ? "up" : stats.roi < 0 ? "down" : "";
  const clvTone = stats.avgClv == null ? "" : stats.avgClv > 0 ? "up" : stats.avgClv < 0 ? "down" : "";

  const pending = bets.filter((b) => b.result === "pending");
  const settled = bets.filter((b) => b.result !== "pending");

  return (
    <div className="bank">
      {/* ---- Summary ---- */}
      <div className="bank__stats">
        <div className="bankstat">
          <span className="bankstat__k">Bankroll</span>
          <span className="bankstat__v">{money(stats.bankroll)}</span>
          <span className="bankstat__s">started at {money(settings.startBankroll)}</span>
        </div>
        <div className="bankstat">
          <span className="bankstat__k">Profit / Loss</span>
          <span className={`bankstat__v bankstat__v--${plTone}`}>{stats.profit >= 0 ? "+" : "−"}{money(Math.abs(stats.profit)).replace("$", "$")}</span>
          <span className="bankstat__s">{settings.unit ? `${signed(stats.units)} units` : "set a unit size"}</span>
        </div>
        <div className="bankstat">
          <span className="bankstat__k">ROI</span>
          <span className={`bankstat__v bankstat__v--${roiTone}`}>{signed(stats.roi, "%")}</span>
          <span className="bankstat__s">on {money(stats.staked)} staked</span>
        </div>
        <div className="bankstat">
          <span className="bankstat__k">Record</span>
          <span className="bankstat__v">{stats.wins}-{stats.losses}{stats.pushes ? `-${stats.pushes}` : ""}</span>
          <span className="bankstat__s">{stats.wins + stats.losses ? `${stats.winPct.toFixed(1)}% win` : "no graded bets"}{stats.pending ? ` · ${stats.pending} pending` : ""}</span>
        </div>
        <div className="bankstat bankstat--clv">
          <span className="bankstat__k">CLV <span className="bankstat__tag">the edge metric</span></span>
          <span className={`bankstat__v bankstat__v--${clvTone}`}>{stats.avgClv == null ? "—" : signed(stats.avgClv, "%")}</span>
          <span className="bankstat__s">{stats.clvCount ? `beat the close ${stats.clvBeatPct!.toFixed(0)}% of ${stats.clvCount}` : "add closing odds to track"}</span>
        </div>
      </div>

      <p className="bank__clvnote">
        <b>Closing-line value</b> is how you check your own edge: did you get a better price than where the
        market closed? Beating the close consistently predicts long-term profit better than win/loss does —
        add the closing odds to any bet and it counts here.
      </p>

      {/* ---- Log a bet ---- */}
      <form className="bankform" onSubmit={submit}>
        <div className="bankform__row">
          <input className="bankform__in bankform__in--pick" value={pick} onChange={(e) => setPick(e.target.value)} placeholder="What did you bet? e.g. Chiefs -3.5" maxLength={120} />
          <input className="bankform__in bankform__in--book" value={book} onChange={(e) => setBook(e.target.value)} placeholder="Book" maxLength={40} />
        </div>
        <div className="bankform__row">
          <label className="bankform__f"><span>Odds</span><input className="bankform__in" value={odds} onChange={(e) => setOdds(e.target.value)} placeholder="-110" inputMode="numeric" /></label>
          <label className="bankform__f"><span>Stake $</span><input className="bankform__in" value={stake} onChange={(e) => setStake(e.target.value)} placeholder="25" inputMode="decimal" /></label>
          <label className="bankform__f"><span>Closing odds <em>(optional)</em></span><input className="bankform__in" value={close} onChange={(e) => setCloseInput(e.target.value)} placeholder="-120" inputMode="numeric" /></label>
          <button type="submit" className="btn btn--primary bankform__go">Log bet</button>
        </div>
        {err && <p className="bankform__err">{err}</p>}
      </form>

      {/* ---- Pending ---- */}
      {pending.length > 0 && (
        <section className="bank__sec">
          <h3 className="bank__h">Pending <span className="bank__n">{pending.length}</span></h3>
          <div className="bank__list">
            {pending.map((b) => (
              <div className="bankrow" key={b.id}>
                <div className="bankrow__main">
                  <span className="bankrow__pick">{b.pick}</span>
                  <span className="bankrow__meta">{fmtOdds(b.odds)} · {money(b.stake)}{b.book ? ` · ${b.book}` : ""} · {day(b.placedAt)}{b.closeOdds != null ? ` · close ${fmtOdds(b.closeOdds)}` : ""}</span>
                </div>
                <div className="bankrow__act">
                  <button type="button" className="bankbtn bankbtn--won" onClick={() => settleBet(b.id, "won")}>Won</button>
                  <button type="button" className="bankbtn bankbtn--lost" onClick={() => settleBet(b.id, "lost")}>Lost</button>
                  <button type="button" className="bankbtn bankbtn--push" onClick={() => settleBet(b.id, "push")}>Push</button>
                  {b.closeOdds == null && <CloseAdder onSet={(v) => setClose(b.id, v)} />}
                  <button type="button" className="bankrow__x" title="Delete" aria-label="Delete bet" onClick={() => removeBet(b.id)}>✕</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ---- Settled ---- */}
      {settled.length > 0 && (
        <section className="bank__sec">
          <h3 className="bank__h">History <span className="bank__n">{settled.length}</span></h3>
          <div className="bank__list">
            {settled.map((b) => {
              const p = betProfit(b);
              const clv = betCLV(b);
              return (
                <div className={`bankrow bankrow--${b.result}`} key={b.id}>
                  <div className="bankrow__main">
                    <span className="bankrow__pick"><span className={`bankrow__res bankrow__res--${b.result}`}>{b.result === "won" ? "✓" : b.result === "lost" ? "✕" : "="}</span>{b.pick}</span>
                    <span className="bankrow__meta">{fmtOdds(b.odds)} · {money(b.stake)}{b.book ? ` · ${b.book}` : ""} · {day(b.placedAt)}</span>
                  </div>
                  <div className="bankrow__nums">
                    <span className={`bankrow__pl bankrow__pl--${p > 0 ? "up" : p < 0 ? "down" : ""}`}>{b.result === "push" ? "push" : `${p >= 0 ? "+" : "−"}${money(Math.abs(p)).replace("$", "$")}`}</span>
                    <span className={`bankrow__clv${clv == null ? " bankrow__clv--none" : clv > 0 ? " up" : clv < 0 ? " down" : ""}`}>{clv == null ? <CloseAdder small onSet={(v) => setClose(b.id, v)} /> : `CLV ${signed(clv, "%")}`}</span>
                  </div>
                  <button type="button" className="bankrow__x" title="Delete" aria-label="Delete bet" onClick={() => removeBet(b.id)}>✕</button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {bets.length === 0 && (
        <div className="bank__empty" role="note">
          <span aria-hidden="true">🎯</span>
          <p>No bets logged yet. Log your first above — then settle it Won / Lost / Push and your record, ROI, and CLV fill in.</p>
        </div>
      )}

      {/* ---- Settings ---- */}
      <div className="bank__settings">
        <button type="button" className="bank__setbtn" onClick={() => setShowSettings((v) => !v)} aria-expanded={showSettings}>
          ⚙ Bankroll settings
        </button>
        {showSettings && (
          <div className="bank__setbody">
            <label className="bankform__f"><span>Starting bankroll $</span>
              <input className="bankform__in" defaultValue={settings.startBankroll} inputMode="decimal"
                onBlur={(e) => { const v = Number(e.target.value); if (v > 0) updateSettings({ startBankroll: v }); }} /></label>
            <label className="bankform__f"><span>Unit size $</span>
              <input className="bankform__in" defaultValue={settings.unit} inputMode="decimal"
                onBlur={(e) => { const v = Number(e.target.value); if (v > 0) updateSettings({ unit: v }); }} /></label>
            <p className="bank__setnote">A <b>unit</b> is your standard bet size — profit in units lets you compare across stake sizes. Saved on this device.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// Small inline "add closing odds" control so CLV can be filled in after the fact.
function CloseAdder({ onSet, small }: { onSet: (v: number | null) => void; small?: boolean }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState("");
  if (!open) return <button type="button" className={`bankbtn bankbtn--clv${small ? " bankbtn--sm" : ""}`} onClick={() => setOpen(true)}>+ CLV</button>;
  return (
    <span className="bankclvadd">
      <input className="bankform__in bankform__in--tiny" autoFocus value={val} inputMode="numeric" placeholder="close" maxLength={6}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { const o = parseOdds(val); if (o != null) { onSet(o); setOpen(false); } } else if (e.key === "Escape") setOpen(false); }} />
      <button type="button" className="bankbtn bankbtn--sm" onClick={() => { const o = parseOdds(val); if (o != null) onSet(o); setOpen(false); }}>✓</button>
    </span>
  );
}
