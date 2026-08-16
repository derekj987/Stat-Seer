"use client";

// A thin brand-motto strip under the nav on every page. Starts on a random line
// and gently rotates through them (respecting reduced-motion).
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
    setI(Math.floor(Math.random() * MOTTOS.length)); // fresh on each visit
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setI((v) => (v + 1) % MOTTOS.length), 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="mottobar">
      <span key={i} className="mottobar__text">{MOTTOS[i]}</span>
    </div>
  );
}
