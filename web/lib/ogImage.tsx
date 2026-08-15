// Turf-palette social/share image, generated at build time via next/og (satori).
// Replaces the old raster "seer" PNGs. Pure typographic — no external assets — so
// it runs on the default runtime with no fs/font files. Shared by the OpenGraph and
// Twitter routes. Satori rule of thumb: any element with >1 child needs display:flex.
import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const FIELD = "#0c2b1c";      // deep turf ground
const CHALK = "#eef5ef";      // sideline chalk / wordmark
const FLAG = "#f4c430";       // penalty-flag yellow
const MINT = "#9ec3ad";       // faded field text
const GRASS = "#5bbe86";      // brighter field green
const LINE = "rgba(238,245,239,0.06)"; // faint yard-lines

export function BrandOg() {
  const yardLines = Array.from({ length: 11 }, (_, i) => (
    <div
      key={i}
      style={{ position: "absolute", top: 0, bottom: 0, left: `${(i + 1) * 100}px`, width: "2px", background: LINE }}
    />
  ));
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", background: FIELD, fontFamily: "sans-serif" }}>
      {yardLines}
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "16px", background: FLAG }} />
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", height: "100%", padding: "0 96px" }}>
        <div style={{ display: "flex", fontSize: 116, letterSpacing: 14, color: CHALK, lineHeight: 1 }}>STATSEER</div>
        <div style={{ display: "flex", width: "172px", height: "8px", background: FLAG, marginTop: "28px", marginBottom: "36px" }} />
        <div style={{ display: "flex", fontSize: 46 }}>
          <span style={{ color: FLAG }}>See the edge.</span>
          <span style={{ color: CHALK, marginLeft: "16px" }}>Trust the data.</span>
        </div>
        <div style={{ display: "flex", fontSize: 30, color: MINT, marginTop: "24px" }}>NFL betting analysis you can actually check.</div>
        <div style={{ display: "flex", fontSize: 26, color: GRASS, marginTop: "44px", letterSpacing: 2 }}>Value Finder · The Model · Context</div>
      </div>
    </div>
  );
}

export function renderBrandOg() {
  return new ImageResponse(<BrandOg />, { ...size });
}
