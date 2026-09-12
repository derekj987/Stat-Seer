import { readNcaafWeek } from "../../NcaafWeek";
import { NCAAF_MODEL } from "../../model-data";
import PlayerModelView from "../../../PlayerModelView";

export const metadata = {
  title: "StatSeer — College Football Player Prop Model",
  description: "Our line-blind college player-prop projections — touchdowns, passing, rushing, receiving — published and graded in public.",
};

export default async function Page({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const cat = typeof sp.cat === "string" ? sp.cat : "td";
  // Default to the CURRENT card week, not week 1: with PROJ_WEEK at 2 the bare URL rendered an
  // empty board ("projections publish here as each week's data comes in") all of game week,
  // while ?week=2 had 889 rows. Same helper every other NCAAF page uses.
  const week = readNcaafWeek(sp.week, NCAAF_MODEL.card.week);
  return <PlayerModelView base="ncaaf" cat={cat} week={week} />;
}
