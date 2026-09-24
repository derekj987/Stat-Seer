import { redirect } from "next/navigation";

// RETIRED, like its NFL counterpart. Its factors — site and home field, weather, each team's
// scoring rates and our power rating, AP standing, conference — now sit on the NCAAF model board
// under each game's row (app/ncaaf/NcaafSpecialConsiderations.tsx). Derek: "move the NCAAF
// context data over too."
//
// A redirect rather than a 404: the route is pinned on dashboards and linked from the homepage,
// and it now lands on the board that carries the same facts. The old page's client-side
// conference/team filter retired with it — the board has its own week nav and the block is on
// every game, so there is nothing left to filter down to.
export default async function Page({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const week = typeof sp.week === "string" ? `?week=${encodeURIComponent(sp.week)}` : "";
  redirect(`/ncaaf/model${week}`);
}
