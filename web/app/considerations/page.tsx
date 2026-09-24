import { redirect } from "next/navigation";

// RETIRED. Its four factors — referee crew, weather, injured players, each team's offensive and
// defensive scoring ratings — now sit on the model board under each game's Bottom Line
// (app/SpecialConsiderations.tsx). Derek: "remove the 'Special Considerations' section completely
// from the Context section."
//
// The route stays as a redirect rather than a 404 because members have it pinned to their
// dashboards and it has been linked from the homepage all season; a dead link is a worse answer
// than landing on the board that now carries the same facts. The old page's other panels
// (coaching tendencies, stakes, incentives, the referee-crew table) are retired with it — they
// were not among the four Derek asked to keep.
export default async function Page({ searchParams }: PageProps<"/considerations">) {
  const sp = await searchParams;
  const week = typeof sp.week === "string" ? `?week=${encodeURIComponent(sp.week)}` : "";
  redirect(`/model${week}`);
}
