"use client";

// "Pin to dashboard" toggle for any view/board. Drop it on a page with a Pin descriptor and
// members can add that view to their Custom Dashboard for one-tap access.
import { useDashboard, type Pin } from "@/lib/dashboard";

export default function PinButton({ pin, size, label = true }: { pin: Pin; size?: "sm"; label?: boolean }) {
  const { has, toggle } = useDashboard();
  const on = has(pin.id);
  return (
    <button type="button"
      className={`pinbtn${size === "sm" ? " pinbtn--sm" : ""}${on ? " pinned" : ""}`}
      aria-pressed={on}
      aria-label={on ? "Remove from your dashboard" : "Add this to your Custom Dashboard"}
      title={on ? "Remove from your dashboard" : "Add this to your Custom Dashboard"}
      // Inside a <summary>/link, don't let the click toggle/navigate the parent.
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); toggle(pin); }}>
      <span className="pinbtn__ic" aria-hidden="true">{on ? "✓" : "＋"}</span>
      {label && <span className="pinbtn__lbl">{on ? "On dashboard" : "Add to dashboard"}</span>}
    </button>
  );
}
