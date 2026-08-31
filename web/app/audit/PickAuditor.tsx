"use client";

// Pick Auditor — paste-your-odds Deal Check. Enter both sides of any market; we strip the vig and
// show the FAIR price of each, the book's hold, and whether the price you'd take is value, fair, or
// overpriced. Pure arithmetic on the market's own numbers — no model edge claim.
import { useState } from "react";
import { impliedProb, probToAmerican, deVig, audit, VERDICT_LABEL, type AuditVerdict } from "@/lib/fairValue";

const fmt = (n: number) => (n > 0 ? `+${n}` : String(n));
const pct = (p: number) => `${(p * 100).toFixed(1)}%`;

// Accept "+150", "150", "-180" → number, only valid American odds (|n| ≥ 100).
function parseAm(s: string): number | null {
  const n = parseInt(s.replace(/[^0-9+-]/g, ""), 10);
  return Number.isFinite(n) && Math.abs(n) >= 100 ? n : null;
}

function VerdictPill({ v }: { v: AuditVerdict }) {
  return <span className={`pa-verdict pa-verdict--${v}`}>{VERDICT_LABEL[v]}</span>;
}

export default function PickAuditor() {
  const [aStr, setAStr] = useState("");
  const [bStr, setBStr] = useState("");
  const [aLabel, setALabel] = useState("");

  const a = parseAm(aStr), b = parseAm(bStr);
  const both = a !== null && b !== null;

  let out: null | {
    vig: number; fairAProb: number; fairBProb: number; fairA: number; fairB: number;
    verdictA: AuditVerdict;
  } = null;
  if (both) {
    const fairAProb = deVig(a!, b!);
    const fairBProb = 1 - fairAProb;
    const verdictA = audit(a!, fairAProb)?.verdict ?? "fair";
    out = {
      vig: impliedProb(a!) + impliedProb(b!) - 1,
      fairAProb, fairBProb,
      fairA: probToAmerican(fairAProb), fairB: probToAmerican(fairBProb),
      verdictA,
    };
  }

  return (
    <div className="pa">
      <p className="pa__lead">
        Paste the <b>two sides</b> of any bet — a prop&apos;s over/under, a spread&apos;s two teams, a
        moneyline&apos;s two sides. We strip the book&apos;s vig and show the <b>fair price</b>, so you know
        whether you&apos;re getting a deal or getting cheated.
      </p>

      <div className="pa__form">
        <label className="pa__f pa__f--wide">
          <span className="pa__k">The bet you&apos;re eyeing <span className="pa__opt">(optional label)</span></span>
          <input className="pa__in" value={aLabel} onChange={(e) => setALabel(e.target.value)}
            placeholder="e.g. Saquon Barkley anytime TD" />
        </label>
        <label className="pa__f">
          <span className="pa__k">Its odds</span>
          <input className="pa__in pa__in--odds" value={aStr} onChange={(e) => setAStr(e.target.value)}
            inputMode="text" placeholder="+150" />
        </label>
        <label className="pa__f">
          <span className="pa__k">The OTHER side&apos;s odds</span>
          <input className="pa__in pa__in--odds" value={bStr} onChange={(e) => setBStr(e.target.value)}
            inputMode="text" placeholder="-180" />
        </label>
      </div>

      {both && out ? (
        <div className={`pa__result pa__result--${out.verdictA}`}>
          <div className="pa__headline">
            {aLabel ? <b>{aLabel}</b> : <b>Your side</b>} at <b className="pa__odds">{fmt(a!)}</b> is{" "}
            <VerdictPill v={out.verdictA} />
          </div>
          <p className="pa__verdicttxt">
            The de-vigged fair price is <b>{fmt(out.fairA)}</b> ({pct(out.fairAProb)} true chance).{" "}
            {out.verdictA === "cheat" && <>You&apos;re paying <b>{fmt(a!)}</b> for something that should pay <b>{fmt(out.fairA)}</b> — a worse price than fair. Shop for a longer number, or pass.</>}
            {out.verdictA === "value" && <>You&apos;re getting <b>{fmt(a!)}</b> on something fairly worth <b>{fmt(out.fairA)}</b> — that&apos;s real value. Grab it.</>}
            {out.verdictA === "fair" && <>That&apos;s right on the fair number — a square price, exactly where it should be.</>}
          </p>
          <div className="pa__grid">
            <div className="pa__cell"><span className="pa__cellk">Your side — fair</span><b>{fmt(out.fairA)}</b><span className="pa__cellsub">you&apos;re offered {fmt(a!)}</span></div>
            <div className="pa__cell"><span className="pa__cellk">Other side — fair</span><b>{fmt(out.fairB)}</b><span className="pa__cellsub">offered {fmt(b!)}</span></div>
            <div className="pa__cell"><span className="pa__cellk">Book&apos;s hold (vig)</span><b>{pct(out.vig)}</b><span className="pa__cellsub">{out.vig > 0.06 ? "juicy" : out.vig > 0.04 ? "typical" : "sharp"}</span></div>
          </div>
        </div>
      ) : (
        <p className="pa__hint">
          {(aStr || bStr) && !both
            ? "Enter valid American odds for both sides (e.g. +150 and -180)."
            : "Enter both sides to audit the price."}
        </p>
      )}

      <details className="pa__how">
        <summary className="pa__howsum">How the Pick Auditor works</summary>
        <div className="pa__howbody">
          <p>
            Every price a book posts has its margin — the <b>vig</b> — built into both sides, which is why
            the two implied chances add up to more than 100%. The auditor strips that margin back out to
            recover the market&apos;s own <b>fair probability</b>, then turns it into a fair price.
          </p>
          <p>
            It&apos;s pure arithmetic on the book&apos;s own posted numbers — transparent and easy to check
            for yourself. Line the fair price up against what you&apos;re offered and you can see at a glance
            whether a number is a good deal.
          </p>
          <p>
            For a one-sided market with no posted opposite side, there&apos;s nothing to de-vig — there,
            compare across books on <a href="/props">Player Props</a> to find the best number.
          </p>
        </div>
      </details>
    </div>
  );
}
