// Which game gets the homepage weather spotlight.
//
// Derek: "always use an interesting game that has terrible weather or high wind to highlight what
// our analysis can provide." Ranked on how much the forecast actually MATTERS -- wind, then gusts,
// then rain, with a jump for freezing -- not on how dramatic it reads.
//
// Lives here rather than inside the panel because the homepage's server component has to pick the
// same game in order to fetch its referee crew and injuries. Two copies of this rule would drift.
import { GAME_WEATHER, type GameWeather } from "@/lib/weatherData";
import type { CardRow } from "@/lib/home";

export interface Spotlight { wx: GameWeather; row: CardRow }

export function weatherSpotlight(card: CardRow[], now = Date.now()): Spotlight | null {
  const byEvent = new Map(card.map((r) => [r.eventId, r]));
  const ranked = GAME_WEATHER
    .filter((w) => !w.indoor && w.status === "ok" && Date.parse(w.commence) > now)
    .map((w) => ({
      wx: w,
      row: byEvent.get(w.eventId),
      score: (w.windMph ?? 0) + 0.5 * (w.gustMph ?? 0) + (w.precipPct ?? 0) / 8
        + ((w.tempF ?? 99) <= 32 ? 12 : 0),
    }))
    .filter((x): x is { wx: GameWeather; row: CardRow; score: number } => !!x.row)
    .sort((a, b) => b.score - a.score);
  const top = ranked[0];
  if (!top) return null;
  const w = top.wx;
  // If nothing on the slate clears the bar the panel does not render. A "weather spotlight" on a
  // calm 6 mph afternoon teaches a reader to scroll past it.
  const notable = (w.windMph ?? 0) >= 12 || (w.gustMph ?? 0) >= 18
    || (w.precipPct ?? 0) >= 40 || (w.tempF ?? 99) <= 32;
  return notable ? { wx: w, row: top.row } : null;
}
