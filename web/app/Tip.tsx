// A scroll "?" that explains a table/section. PURE CSS — no client JS, no hydration, no
// focus tricks. Desktop: hover. Phones: tapping the scroll flips a hidden checkbox (inside
// the <label>) that reveals the bubble via :has(:checked) — 100% reliable on touch. The
// bubble is anchored to its positioned ".tblhelp"/".pmcat__legend" row (left:0/right:0), so
// it spans that row's full width and can't clip. Lives in the body, so it never toggles a
// panel. Tap the scroll again to dismiss.
export default function Tip({ text, label = "What am I looking at?" }: { text: React.ReactNode; label?: string }) {
  return (
    <span className="tip">
      <label className="tip__seal" aria-label={label}>
        <input type="checkbox" className="tip__chk" tabIndex={-1} aria-hidden="true" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/scroll1.png?v=1" alt="" className="tip__icon" width={22} height={22} />
      </label>
      <span className="tip__bubble" role="tooltip">{text}</span>
    </span>
  );
}
