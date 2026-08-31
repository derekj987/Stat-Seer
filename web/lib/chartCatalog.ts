// The StatSeer chart catalog — every default board/chart a member can drop onto their dashboard,
// organized by sport and category (The Model / Context / Value Finder). Powers the "Add StatSeer
// charts" browser on the dashboard so members don't have to hunt around the site for the ＋ button.
// Each item's href is the page (or a single ?only=<id> chart); the dashboard embeds it live.
import type { Pin, PinKind } from "@/lib/dashboard";

export interface CatalogItem { label: string; detail: string; href: string; kind: PinKind; }
export interface CatalogGroup { key: string; sport: "NFL" | "NCAAF"; category: string; items: CatalogItem[]; }

export const CHART_CATALOG: CatalogGroup[] = [
  { key: "nfl-model", sport: "NFL", category: "The Model", items: [
    { label: "Full Model — every game", detail: "NFL · The Model", href: "/model?only=full-model", kind: "model" },
    { label: "Numbers Crunched", detail: "NFL · The Model", href: "/model?only=numbers-crunched", kind: "model" },
    { label: "Player Prop Model", detail: "NFL · The Model", href: "/model/players?cat=td", kind: "model" },
  ] },
  { key: "nfl-context", sport: "NFL", category: "Context", items: [
    { label: "Upset Watch", detail: "NFL · Context", href: "/context", kind: "considerations" },
    { label: "Special Considerations", detail: "NFL · Context", href: "/considerations", kind: "considerations" },
  ] },
  { key: "nfl-value", sport: "NFL", category: "Value Finder", items: [
    { label: "Pick Auditor", detail: "NFL · Value Finder", href: "/audit", kind: "auditor" },
    { label: "Line Shopping", detail: "NFL · Value Finder", href: "/lines", kind: "lines" },
    { label: "Sweet Spots — best prices", detail: "NFL · Value Finder", href: "/best", kind: "sweetspots" },
    { label: "Player Props", detail: "NFL · Value Finder", href: "/props?cat=td", kind: "props" },
  ] },
  { key: "ncaaf-model", sport: "NCAAF", category: "The Model", items: [
    { label: "AP Top 25 Matchups", detail: "NCAAF · The Model", href: "/ncaaf/model?only=ap-top-25", kind: "model" },
    { label: "Where We Differ Most", detail: "NCAAF · The Model", href: "/ncaaf/model?only=where-we-differ", kind: "model" },
    { label: "Full Model — every game", detail: "NCAAF · The Model", href: "/ncaaf/model?only=full-model", kind: "model" },
    { label: "Player Prop Model", detail: "NCAAF · The Model", href: "/ncaaf/model/players?cat=td", kind: "model" },
  ] },
  { key: "ncaaf-context", sport: "NCAAF", category: "Context", items: [
    { label: "Upset Watch", detail: "NCAAF · Context", href: "/ncaaf/context", kind: "considerations" },
    { label: "Special Considerations", detail: "NCAAF · Context", href: "/ncaaf/considerations", kind: "considerations" },
  ] },
  { key: "ncaaf-value", sport: "NCAAF", category: "Value Finder", items: [
    { label: "Line Shopping", detail: "NCAAF · Value Finder", href: "/ncaaf/lines", kind: "lines" },
    { label: "Sweet Spots", detail: "NCAAF · Value Finder", href: "/ncaaf/best", kind: "sweetspots" },
    { label: "Player Props", detail: "NCAAF · Value Finder", href: "/ncaaf/props?cat=td", kind: "props" },
  ] },
];

export function catalogPin(item: CatalogItem): Pin {
  return { id: item.href, kind: item.kind, label: item.label, detail: item.detail, href: item.href };
}
