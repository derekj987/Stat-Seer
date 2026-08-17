"use client";

// Drop-in "add to slip" control for any pick/player, usable from server-rendered
// pages (The Model, Fan Analysis). Game Lines / Player Props use their own tappable
// chips wired to the same useSlip store.
import { useSlip, type SlipItem } from "@/lib/slip";

export default function AddToSlip({ item, label = "Add to slip", compact = false }:
  { item: SlipItem; label?: string; compact?: boolean }) {
  const { has, toggle } = useSlip();
  const saved = has(item.id);
  // Compact = icon only (for dense rows like The Card), with the pick name on the
  // aria-label/title so it stays clear what's being added.
  return (
    <button
      type="button"
      className={`${compact ? "addslip addslip--compact" : "addslip"}${saved ? " saved" : ""}`}
      aria-pressed={saved}
      aria-label={saved ? `${item.title} — on your slip` : `Add ${item.title} to your slip`}
      onClick={() => toggle(item)}
      title={saved ? `${item.title} — remove from slip` : `Add ${item.title} to slip`}
    >
      <span className="addslip__i" aria-hidden="true">{saved ? "♥" : "+"}</span>
      {!compact && (saved ? "On your slip" : label)}
    </button>
  );
}
