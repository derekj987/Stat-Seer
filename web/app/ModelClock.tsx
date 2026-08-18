"use client";

// Live current date + time for The Model masthead (replaces the old static subtitle
// and "published" stamp). Ticks each second; renders blank on the server to avoid a
// hydration mismatch, then fills in on mount.
import { useEffect, useState } from "react";

export default function ModelClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!now) return <span className="modelclock" aria-hidden="true" />;
  const date = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const time = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });
  return (
    <span className="modelclock">
      <span className="modelclock__d">{date}</span>
      <span className="modelclock__t">{time}</span>
    </span>
  );
}
