"use client";

// Rotating brand motto, centered inside the top bar between the logo and the
// hamburger (all widths).
import { useEffect, useState } from "react";

const MOTTOS = [
  "Win the day.",
  "Proof over promises.",
  "Read the game before it's played.",
  "The house has its edge. Now you have yours.",
];

export default function MottoBar() {
  const [i, setI] = useState(0);
  useEffect(() => {
    setI(Math.floor(Math.random() * MOTTOS.length));
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setI((n) => (n + 1) % MOTTOS.length), 5000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="mottobar" aria-hidden="true">
      <span key={i} className="mottobar__text">{MOTTOS[i]}</span>
    </div>
  );
}
