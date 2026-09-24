import { redirect } from "next/navigation";

// RETIRED with the Context section. Derek: "I want to remove the Context section completely
// because I received feedback that there is too much data spread across the app and website. We
// need to centralize." What was worth keeping moved onto the model board, under each game:
// Special Considerations (scoring, weather, referee, injuries) and the Upset Meter, which is
// where the Upset Lab's chaos index now lives.
//
// A redirect rather than a 404 — these routes are pinned on dashboards and linked from the
// homepage, and the board they land on carries the same facts, per game.
export default function Page() {
  redirect("/ncaaf/model");
}
