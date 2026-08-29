"use client";

import { useState, type ReactNode } from "react";

// Client tab switcher for the profile. The server renders every panel (so all data + the
// interactive children inside them are ready), and this just shows the active one — the modern
// "tabs instead of one long wall" layout. Deep-linkable via ?tab=, and it keeps the choice in the
// URL hash so a refresh/scroll stays put without a server round-trip.
export type ProfileTab = { key: string; label: string; count?: number; node: ReactNode };

export default function ProfileTabs({ tabs, initial }: { tabs: ProfileTab[]; initial?: string }) {
  const first = tabs[0]?.key;
  const [active, setActive] = useState(
    initial && tabs.some((t) => t.key === initial) ? initial : first,
  );
  return (
    <div className="ptabs">
      <div className="ptabs__bar" role="tablist" aria-label="Profile sections">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={t.key === active}
            className={t.key === active ? "ptab active" : "ptab"}
            onClick={() => setActive(t.key)}
          >
            {t.label}
            {typeof t.count === "number" && t.count > 0 && <span className="ptab__count">{t.count}</span>}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.key} role="tabpanel" hidden={t.key !== active} className="ptabs__panel">
          {t.node}
        </div>
      ))}
    </div>
  );
}
