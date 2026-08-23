// A small medieval "?" seal that explains what a table/section shows. Pure CSS — the
// bubble reveals on hover (desktop) and on focus (tap on phones), so it needs no client
// JS or hydration and can't be broken by anything upstream. Safe inside a <summary>: the
// seal is focusable but not a form control, so a tap focuses it (showing the tip) without
// being swallowed. Keep tips short enough to sit within the (open) panel body.
export default function Tip({ text, label = "What am I looking at?" }: { text: React.ReactNode; label?: string }) {
  return (
    <span className="tip">
      <span className="tip__seal" tabIndex={0} role="button" aria-label={label}>?</span>
      <span className="tip__bubble" role="tooltip">{text}</span>
    </span>
  );
}
