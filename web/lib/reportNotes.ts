// Hand-written review for each weekly report card — what the numbers in reportCards.ts (generated)
// say, what we learned, and what changed because of it. Keyed `${sport}-${season}-${week}` so a
// regeneration of the numbers never touches the words. Write the review AFTER reading the card,
// and cite its numbers; a review that could have been written before the games is not a review.

export interface ReportNote {
  headline: string;                 // one line, the honest summary
  learned: string[];                // what the week taught us, each tied to a number on the card
  changed: string[];                // what we changed in the model / data / boards because of it
  caveat?: string;                  // sample-size or data caveats a reader should hold
  watch?: string[];                 // contenders vs pretenders — what next week should test
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
      "Eighteen rows were voided rather than graded — Sam Darnold (13 passing yards), Kyler Murray (18) and the other starters who left early or never dressed. A book voids that slip, so the card does too; it is neither a win nor a loss, and the live inactives tag exists so the board says so before kickoff.",
    ],
    changed: [
      "The market column on the player boards now shows PREGAME lines only. A sweep that ran three hours into Panthers–Bears captured FanDuel's live 130.5 receiving yards for Jalen Coker (he had 120 at the time) and the board published it as the market. Pregame it was 37.5. Every reader and the projections export now ignore rows captured after kickoff, and the capture job no longer polls games in play.",
      "Completed games keep their closing line and their teams. The model board read \"? @ CAR\" for every finished game because the newest odds sweep only contained the game still to be played. Each played game now carries its last pregame sweep — its close — which is also the number this report grades against.",
      "Player projections now read this season's games. They had been last season's per-game volume all year long, so a back who just carried 20 times as the new starter was still projected on last year's 6. Measured on 2023–2025, blending a player's season-to-date usage with his prior season (equal weight after one game) cut the error in next-game volume by 10–20% in every position group — carries 3.87 → 3.13 (2025), targets 2.05 → 1.93, attempts 8.36 → 7.76. Week 2's numbers carry week 1's usage.",
      "The game model itself is unchanged. One week cannot overturn parameters chosen on 2016–2022 and held out on 2023–2025; the in-season blend that folds week 1's results into each team's rating is the designed adjustment, and it applied for week 2.",
      "The report card itself: what you see here is graded against the files as they were committed before each kickoff, not the working copy, and against FanDuel's closing line.",
    ],
    caveat: "Sixteen games and one week. The prop leans are 358 graded rows, which is enough to say \"coin flip\"; the game reads are not enough to say anything except that the market was better this week.",
    watch: [
      "How to read these: \"earned\" is a team's week-1 margin implied by its play-by-play efficiency (net EPA per play over a 60-play game); \"luck\" is the scoreboard minus that. A big positive luck number is a pretender until proven otherwise; a big negative one is a team that played better than its result.",
      "Contenders — earned more than the scoreboard said: Baltimore (won by 18, earned +34, and Indianapolis earned −34 — the Colts' loss was worse than it looked), Jacksonville (+31 earned; the Chargers' week-1 loss was also worse than −12), Kansas City (+30), San Francisco (+27), Arizona (+23 earned on a 12-point win). Our week-2 numbers already lean these ways; the market leans further on Baltimore, Kansas City and San Francisco.",
      "Pretenders — the scoreboard flattered them: Chicago (won by 22; earned +14, luck +8 with an even turnover count), Minnesota (won by 17 on a NEGATIVE offensive EPA; earned +9, luck +8), Pittsburgh (won by 7 with a −0.30 EPA offense and a return touchdown; earned +1), New England (lost by 3 but earned −10). Week 2 prices Chicago −5.5 over Minnesota — both sides of that game overperformed, so the number is built on two week-1 mirages.",
      "Unlucky, not bad: Green Bay (lost by 17, earned −9), Denver (lost by 21, earned −30 — genuinely bad), Carolina (lost by 22, earned −14). Carolina at Atlanta is the game where our model disagrees most with the market this week (we have Atlanta by 4.3, FanDuel has Carolina by 2.5): both teams earned negative week-1 numbers, and the market is buying Carolina's offense (+0.18 EPA/play) while we still hold last season's ratings.",
      "Great players who underperformed with their role intact — the buy-low list: Ja'Marr Chase (12 yards on 4 targets, 94% of snaps, 11.6 targets a game last year), George Pickens (28 on 6), CeeDee Lamb (44 on 8), Terry McLaurin (14 on 4), Drake London (29 on 4 at 98% of snaps), Rashee Rice (19 on 2), Tyler Warren (13 on 5). Snap share is the tell: the role is unchanged, the ball simply did not come. The projections now blend week 1 in at equal weight with last season, so each moves down a little and stays a starter's number — a low week-2 line on any of them is the market overreacting to one game.",
      "Overperformers to fade unless the usage is real: Kalif Raymond (84 yards on a 14.5 line; 9 targets against 2.0 a game last year), Kendrick Bourne (75 on 18.5), Mack Hollins (51 on 8.5), Demarcus Robinson (50 on 9.5). Where the targets ALSO jumped — Chris Olave (13), Matthew Golden (12), Jalen Coker (9 vs 3.9 last year), Dalton Kincaid — the number may be a role change rather than a fluke; one more week of targets says which.",
      "Voided, not lost: Sam Darnold (10% of snaps) and Kyler Murray (17%) left early and their props are voided on this card. Watch their availability, not their lines.",
    ],
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
      "The projections' role rule. A player's workload was the GREATER of his depth slot's typical volume and his own — a lift that could only push up, and did: +7.0 yards of bias across every priced row. Re-projecting both played weeks from only what was knowable before them, a symmetric blend (this season's games in full, last season's at a quarter weight, three games of role prior) cut the week-2 error from 22.6 to 21.2 yards and the bias from +7.0 to +2.8, while leaving the preseason board — where the depth chart is all there is — no worse. That rule is what projects week 3.",
      "Grading: this card grades what was committed before each kickoff against the last pregame FanDuel line captured for that game.",
    ],
    watch: [
      "Two weeks against the closing spread, cumulative. Playing better than their number: Mississippi State (+49 over UL Monroe, then won at Minnesota by 25 as a 1.5-point dog — +44 against the close in two weeks), North Texas (lost by 36 at Indiana, then beat UNLV by 38 as a 3.5-point dog), Georgia State (won at Kennesaw State by 14 as a 7.5-point dog), App State, Utah (beat Arkansas by 33 as a 12.5 favourite), Colorado State, Virginia (beat NC State by 26 as a 4-point favourite).",
      "Playing worse than their number: Oregon (beat Boise State by 7 as a 24.5 favourite, lost at Oklahoma State by 8 as a 23.5 favourite — −49 against the close), Rutgers (lost to UMass as a 29.5 favourite), Arkansas, Western Kentucky, Clemson (lost at LSU by 41 as a 10-point dog), Texas Tech (won at Oregon State by 11 as a 26.5 favourite), Washington (two wins by 14 and 2 as 24- and 27.5-point favourites).",
      "Our rating moves slowly and on purpose — a preseason number seeded on last season and SP+, with two games now blended in. That is right for a team like UMass or North Texas, where one result is mostly noise; it is slow for Oregon, where two straight non-covers by 17 and 31 points say the preseason rating was wrong. Read the card's week-3 number on Oregon, Washington and Texas Tech against the market's with that in mind: where the market has already moved and we have not, the market has seen two games we are still averaging away.",
      "Players: the week-2 rushing rows that ran highest against their lines were the depth-chart starters the old role rule lifted to a full workload; with the symmetric blend those project on what they have actually carried. The receivers the market priced short and the board projected high (proj > line on 75% of receiving rows) are still the category to read with the arrow, not the number.",
    ],
    caveat: "Eighty-six games is a real sample for the straight-up and spread records; the prop leans are one Saturday. 288 priced prop rows could not be graded — players who did not record a stat line, or names CFBD spells differently from the book — and they are excluded rather than counted as losses.",
  },
};

REPORT_NOTES["ncaaf-2026-1"] = {
  headline: "Opening week: 88 of 99 winners, 38-58-1 against the number — taking the points went 12-34.",
  learned: [
    "The rating ordered teams well (88-11 straight-up) and the market ordered margins better (13.6 points of error to our 14.1). Preseason ratings are last season plus a forward-looking seed; the market also had the transfer portal, the depth charts and the injury reports.",
    "Taking the points went 12-34. Our preseason numbers ran compressed against the market's big early-season spreads, so on most games we sat on the underdog's side of the number — and the favourites covered. The spread-aware anchor in the card already ramps toward the market past 18 points; this week said the ramp was still too gentle at the top.",
    "Props were graded on a board that, at the time, held 7 of 35 games: the paged read behind it stopped at 1,000 rows. The rows that were on it ran 3–4 yards high and the book's line beat our number by 5–6 yards in every yardage category.",
    "Anytime TD: we said 25.5%, the books' prices implied 34.3%, 26.2% scored. Our level was right; the books' ranking was better (Brier 0.182 to our 0.220).",
  ],
  changed: [
    "The truncated read, the name keys, the current-season logs, the team-name aliases and the second pass that dropped unprojectable players were all fixed the following week — see NCAAF Week 2.",
  ],
  caveat: "The projections graded here are what the board showed at each kickoff, on the coverage it had then. 102 of the 675 priced rows could not be graded — no stat line, or a spelling CFBD does not share.",
};

REPORT_NOTES["nfl-2026-2"] = {
  headline: "Even against the number — 8-8 against the close and 8-8 on totals, after a 4-12 opening week.",
  learned: [
    "Against the close 8-8 (laying 2-2, taking 6-6), straight-up 9-7. Margin error 12.6 to the market's 11.6, and the market was still better calibrated on the winner (Brier 0.233 to our 0.246). The gap narrowed from week 1 but it is the same gap.",
    "Our read correlated 0.30 with the actual margins against the market's 0.56. That is the honest measure of a week-2 rating: it points the right way more often than not, and the market points the right way more reliably.",
    "Totals were the week's real miss, in the other direction from week 1. The league scored 40.4 points a game; we averaged 46.0 and the market 45.2. Everyone was high, we were higher, and the board still went 8-8 because the over/under leans split.",
    "Player props were the strongest half yet. Leans 174-163 overall, with passing 25-15 and rushing 34-26. The projections came in slightly UNDER the results on every continuous market (bias -2.6 passing, -2.7 receiving, -0.2 receptions) after running over in week 1 — which is what an unbiased projection looks like when you only have two weeks of it.",
    "Anytime TD: we said 19.3%, the books' prices implied 20.8%, 15.5% scored. Both high, ours closer to the truth on level, the books fractionally better at ranking (Brier 0.1196 to our 0.1211).",
    "Eighteen rows voided — Saquon Barkley, David Njoku, Jaxson Dart, Travis Hunter and the others who left early or never dressed. Those are not losses and are not counted as any.",
  ],
  changed: [
    "Nothing in the game model. Two weeks is not a reason to move a parameter chosen on nine seasons, and the in-season blend already folded week 1 into every rating for this week.",
    "The totals model was tested and left alone — see the NCAAF week 3 card for the measurement; it is the same test for both sports.",
  ],
  watch: [
    "The week-1 pretenders were exposed on schedule. Chicago, who won by 22 in week 1 while earning +14, won 9-3 and beat Minnesota — who had won by 17 on a negative offensive EPA. Pittsburgh, +7 on a -0.30 EPA offense in week 1, lost 20-3 to New England. Neither team's week-1 scoreboard was worth what it looked like.",
    "The contenders held: Baltimore (earned +34 in week 1) won again; Kansas City and San Francisco both covered; Jacksonville lost outright at Denver, the one that did not follow through.",
    "Carolina at Atlanta was the model's biggest disagreement with the market (we had Atlanta by 4.3, FanDuel had Carolina by 2.5). Carolina won 34-3. That is a loss, and it is the honest kind: we were holding last season's ratings on an offense the market had already re-priced.",
    "For week 3, the same earned-vs-scoreboard read is on the board itself now — each game's Special Considerations block carries both teams' scored and allowed rates with their league rank, so the pretender check is one line under the number instead of a second page.",
  ],
  caveat: "Sixteen games. Two weeks of game reads is 32 games — enough to see a direction, not enough to conclude one. The prop leans are 337 graded rows.",
};

REPORT_NOTES["ncaaf-2026-3"] = {
  headline: "The projection fix landed: rushing bias +11.6 to -1.0, and our receiving number beat the book's for the first time.",
  learned: [
    "The role-volume change shipped after week 2 did exactly what the backtest said it would. Rushing projections had been running 11.6 yards ABOVE what players gained; this week they ran 1.0 below. Receiving went +5.2 to -4.8, receptions +0.4 to -0.1.",
    "On receiving yards our projection's error was 26.9 against the book's 27.1 — the first category, in either sport, where our number has been closer than the closing line. One week, 212 rows, and not a claim of edge; it is the first time the comparison has not gone the other way.",
    "Passing over-corrected: -8.6 yards of bias, having been +5.8 under the old rule. We tested a lighter role weight for quarterbacks specifically and it made passing WORSE in both played weeks, so the swing is week-to-week variance in how much college offenses threw, not a mis-set weight. Left alone and written down.",
    "Games: 66-9 straight-up, 33-42 against the close, margin error 10.6 to the market's 9.5. The rating orders teams well and does not beat the number — for the third week running, which is now a measurement rather than an impression.",
    "Totals went 40-35 with overs 24-16. Nothing to read at this sample.",
    "Anytime TD: we said 26.2%, the books implied 31.7%, 28.0% scored. Our level is a little low, the books' a little high (that is their vig), and the books still rank scorers better (Brier 0.182 to our 0.205).",
  ],
  changed: [
    "Nothing further this week — week 3 IS the read on the change made after week 2, and it confirmed it. Moving a parameter again on the strength of the week that validated it is how a model gets fitted to noise.",
    "The NFL totals model was tested for the same in-season treatment the projections got and did NOT earn it: blending this season's scoring into each team's tendency moved held-out error from 10.474 to 10.418 points across 816 games, non-monotonically, and made the first two weeks of a season worse. Negative result, no change. (analysis/totals_inseason.py)",
    "The NFL game model's in-season blend was re-measured by week band and gained a late-season taper: the prior-season weight holds at 5 through week 10 and drops to 2 from week 11, worth 0.07 points of margin error on held-out seasons. Weeks 1-10 are unchanged, so nothing published this season moves. (analysis/game_model_weeks.py)",
  ],
  watch: [
    "Oregon, the biggest two-week underperformer against the number (-49), was not on this week's priced board. Rutgers (-50) lost again. Mississippi State (+44 through two weeks) kept going.",
    "The receiving projections still sit above the line on 71% of rows while 57% went over. The bias is gone from the LEVEL; what remains is the mean-versus-median gap that the board's arrow already reads through each player's own exceedance rate rather than through the projection.",
    "Watch passing next week. A single week at -8.6 after a week at +5.8 is variance; two weeks in the same direction would be a level to fix.",
  ],
  caveat: "Seventy-five games and 639 graded prop rows. The three voided rows are players who did not take a snap.",
};

export const noteKey = (sport: string, season: number, week: number) => `${sport}-${season}-${week}`;
