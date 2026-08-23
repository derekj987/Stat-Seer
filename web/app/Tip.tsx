// A scroll "?" that explains a table/section. PURE CSS — no client JS or hydration, so it
// works everywhere regardless of how the surrounding tree hydrates. Reveals on hover
// (desktop) and on focus (tap on phones, since the seal is focusable). Always lives in a
// positioned ".tblhelp" legend in the body (never a <summary>), so the bubble spans that
// row's full width (can't clip / run off-screen) and tapping it can't toggle a panel.
export default function Tip({ text, label = "What am I looking at?" }: { text: React.ReactNode; label?: string }) {
  return (
    <span className="tip">
      <span className="tip__seal" tabIndex={0} role="button" aria-label={label}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/scroll1.png?v=1" alt="" className="tip__icon" width={22} height={22} />
      </span>
      <span className="tip__bubble" role="tooltip">{text}</span>
    </span>
  );
}
