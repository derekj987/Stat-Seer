// Hand-written review for each weekly report card — what the numbers in reportCards.ts (generated)
// say, what we learned, and what changed because of it. Keyed `${sport}-${season}-${week}` so a
// regeneration of the numbers never touches the words. Write the review AFTER reading the card,
// and cite its numbers; a review that could have been written before the games is not a review.

export interface ReportNote {
  headline: string;                 // one line, the honest summary
  learned: string[];                // what the week taught us, each tied to a number on the card
  changed: string[];                // what we changed in the model / data / boards because of it
  caveat?: string;                  // sample-size or data caveats a reader should hold
}

export const REPORT_NOTES: Record<string, ReportNote> = {
  "nfl-2026-1": {
    headline: "A losing week against the number: our reads were on the right side of the spread 4 times in 16, and the projections leaned the wrong way on totals 11 times.",
    learned: [
      "The market's closing spread predicted the margins better than we did — 11.2 points of average error to our 12.6 — and it was better calibrated on the winner too (Brier 0.210 vs our 0.244). That is the finding we published before the season and it held on the first week: a line-blind rating does not beat the close.",
      "Our margins are compressed. On 11 of 16 games our number sat inside the market's, so the board leaned toward the underdog's points; underdogs covered 3 of those 11. Week-1 ratings are still mostly last season, and last season's ratings say less about a team than the market already knows in September.",
      "Totals leaned under on 6 games and 1 came in. The week scored 49.4 points a game; we averaged 46.0 and the market 45.1, so everyone was low and the under was the wrong side of it. The totals model is the weakest piece we publish, and it showed.",
      "Player props were the better half. The board's over/under leans went 183-175 on yardage and receptions — a coin flip, which is what an honest, un-edged lean should do — and the anytime-TD numbers were well calibrated: we said 20.8%, the books' prices implied 21.8%, and 21.0% of them scored.",
      "Our yardage projections sit above the book's number more often than the results do: 69% of receiving rows and 67% of rushing rows projected over the line, while 49% and 53% actually went over. That is the mean-versus-median gap the board already corrects for in the arrow — but the projection column still reads high, and the book's line had the smaller error (20.0 vs 21.5 receiving yards; 16.5 vs 18.3 rushing).",
      "The biggest prop misses were availability, not projection: Sam Darnold (13 passing yards) and Kyler Murray (18) left early. No projection survives that, and the board cannot know it in advance — which is why the live inactives tag exists.",
    ],
    changed: [
      "The market column on the player boards now shows PREGAME lines only. A sweep that ran three hours into Panthers–Bears captured FanDuel's live 130.5 receiving yards for Jalen Coker (he had 120 at the time) and the board published it as the market. Pregame it was 37.5. Every reader and the projections export now ignore rows captured after kickoff, and the capture job no longer polls games in play.",
      "Completed games keep their closing line and their teams. The model board read \"? @ CAR\" for every finished game because the newest odds sweep only contained the game still to be played. Each played game now carries its last pregame sweep — its close — which is also the number this report grades against.",
      "The report card itself: what you see here is graded against the files as they were committed before each kickoff, not the working copy, and against FanDuel's closing line.",
    ],
    caveat: "Sixteen games and one week. The prop leans are 358 graded rows, which is enough to say \"coin flip\"; the game reads are not enough to say anything except that the market was better this week.",
  },
  "ncaaf-2026-2": {
    headline: "We picked the winner in 72 of 86 games and still lost against the number, 38-48 — the market's spread knew the margins better than our rating did.",
    learned: [
      "Straight-up 72-14 (84%) is the rating working as a rating: it orders teams well. Against the close it went 38-48, laying the points 19-19 and taking them 19-29. The average margin error was 12.6 points to the market's 11.1. Same story as the NFL and the same one we published in the model's track record: a competent rating is not an edge.",
      "Totals split 42-44 with overs 22-21 and unders 20-23 — nothing to read.",
      "Prop leans went 183-153 (54.5%) across the four yardage and reception markets, led by rushing (41-29) and receiving (56-42). One Saturday at 54% is inside the noise band of a coin flip; it is not a signal until it holds for a month.",
      "The projections run HIGH. Rushing projected above the line on 66% of rows while 44% went over, and the average projection sat 11.6 yards above what the player actually gained; receiving ran 5.2 high, passing 5.8. The book's line beat our number on error in every category (25.1 vs 28.4 rushing, 24.0 vs 25.9 receiving, 27.3 vs 30.2 passing). This is the role-volume lift again — a starter's projected workload is still generous relative to what he demonstrates.",
      "Anytime TD: our numbers averaged 27.4% against 34.6% implied by the books' prices, and 23.8% of those players scored. The books' prices carry the vig, so they read high by construction; we were closer on level but the books ranked scorers slightly better (Brier 0.184 to our 0.194).",
      "Coverage was the real fix of the week. The Saturday board had been missing whole games and most players — 6 of 45 games at one point — from a paged read that stopped at 1,000 rows, a name key that kept \"Isaiah Sategna III\" and CFBD's \"Isaiah Sategna\" apart, and depth slots built without this season's usage. Every priced player in every priced game is on the board now, at FanDuel's number.",
    ],
    changed: [
      "Player board coverage: every priced player and game (1,314 of 1,314 priced player-markets), depth slots re-ranked on this season's usage, book spellings (\"Gio Lopez\") reconciled to CFBD's (\"Giovanni Lopez\"), team-defense scoring props kept off the player boards.",
      "Market freshness: props captured every 2 hours instead of twice a day, projections refreshed twice daily, and the anytime-TD market column is FanDuel's live price, not the median baked into the file.",
      "Grading: this card grades what was committed before each kickoff against the last pregame FanDuel line captured for that game.",
    ],
    caveat: "Eighty-six games is a real sample for the straight-up and spread records; the prop leans are one Saturday. 288 priced prop rows could not be graded — players who did not record a stat line, or names CFBD spells differently from the book — and they are excluded rather than counted as losses.",
  },
};

export const noteKey = (sport: string, season: number, week: number) => `${sport}-${season}-${week}`;
