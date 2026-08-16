"use client";

// Drop-in "add to slip" control for any pick/player, usable from server-rendered
// pages (The Model, Fan Analysis). Game Lines / Player Props use their own tappable
// chips wired to the same useSlip store.
import { useSlip, type SlipItem } from "@/lib/slip";

export default function AddToSlip({ item, label = "Add to slip" }: { item: SlipItem; label?: string }) {
  const { has, toggle } = useSlip();
  const saved = has(item.id);
  return (
    <button
      type="button"
      className={saved ? "addslip saved" : "addslip"}
      aria-pressed={saved}
      onClick={() => toggle(item)}
      title={saved ? "Remove from slip" : "Add to slip"}
    >
      <span className="addslip__i" aria-hidden="true">{saved ? "♥" : "+"}</span>
      {saved ? "On your slip" : label}
    </button>
  );
}
