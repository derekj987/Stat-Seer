// Turf-palette social/share image, generated at build time via next/og (satori).
// Composition: the gold "seer" analyst on the left, wordmark + tagline on the deep
// field to the right. Reads the pre-cropped panel from assets/ at module scope
// (Node runtime; the file is traced into the function bundle). Shared by the
// OpenGraph and Twitter routes. Satori rule: any element with >1 child needs flex.
import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const FIELD = "#0c2b1c";      // deep turf ground
const CHALK = "#eef5ef";      // sideline chalk / wordmark
const FLAG = "#f4c430";       // penalty-flag yellow
const MINT = "#9ec3ad";       // faded field text
const GRASS = "#5bbe86";      // brighter field green
const LINE = "rgba(238,245,239,0.06)"; // faint yard-lines

export function BrandOg({ seerSrc }: { seerSrc: string }) {
  const yardLines = Array.from({ length: 6 }, (_, i) => (
    <div
      key={i}
      style={{ position: "absolute", top: 0, bottom: 0, left: `${600 + i * 100}px`, width: "2px", background: LINE }}
    />
  ));
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", background: FIELD, fontFamily: "sans-serif" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={seerSrc} width={500} height={630} alt="" />
      <div style={{ position: "absolute", left: "500px", top: 0, bottom: 0, width: "3px", background: FLAG }} />
      {yardLines}
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", height: "100%", width: "700px", padding: "0 66px" }}>
        <div style={{ display: "flex", fontSize: 90, letterSpacing: 11, color: CHALK, lineHeight: 1 }}>STATSEER</div>
        <div style={{ display: "flex", width: "150px", height: "8px", background: FLAG, marginTop: "24px", marginBottom: "32px" }} />
        <div style={{ display: "flex", fontSize: 40 }}>
          <span style={{ color: FLAG }}>See the edge.</span>
          <span style={{ color: CHALK, marginLeft: "14px" }}>Trust the data.</span>
        </div>
        <div style={{ display: "flex", fontSize: 27, color: MINT, marginTop: "22px" }}>NFL betting analysis you can actually check.</div>
        <div style={{ display: "flex", fontSize: 24, color: GRASS, marginTop: "38px", letterSpacing: 2 }}>Value Finder · The Model · Context</div>
      </div>
    </div>
  );
}

export async function renderBrandOg() {
  const seerData = await readFile(join(process.cwd(), "assets/seer-og.png"), "base64");
  const seerSrc = `data:image/png;base64,${seerData}`;
  return new ImageResponse(<BrandOg seerSrc={seerSrc} />, { ...size });
}
