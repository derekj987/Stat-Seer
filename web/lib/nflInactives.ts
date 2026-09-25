// Live NFL availability, read at REQUEST TIME.
//
// Why this exists: Derek, looking at the Week 1 board — "I believe Henderson or Stevenson is out
// tonight. Bettors rely on fresh data." He was right. TreVeyon Henderson was ruled OUT with an
// ankle at Wednesday's practice, and the board was still publishing a 37.5-yard rushing projection
// and a 48% career-over for him. Worse, we already HELD that fact: `ingest/injuries_nflverse.py`
// had written `game_status: OUT` into `practice_reports` hours earlier. It fed the game model's
// team adjustment and nothing else. Nobody had ever joined it to the player board.
//
// THREE sources, layered in this order, because they answer three different questions and each one
// is blind to something the next can see:
//
//   1. `practice_reports` (ours). Written by `ingest/injuries_nflverse.py` from the nflverse
//      release — the Wed/Thu/Fri PRACTICE REPORT and its Out / Doubtful / Questionable
//      designations. Already populated: it had Henderson OUT hours before Derek asked.
//   2. `sleeper_availability` (ours, written by `capture-sleeper.yml`). The official report above
//      carries no designation until Friday and drops anyone moved to IR entirely, because he is off
//      the active roster. Derek found both holes on one board — "I'm not seeing Jaxson Dart major
//      injury in the NYG game... Also the same for Caleb Williams for the Bears" — and both were
//      genuinely absent. Sleeper aggregates the beat reporting and moves on NEWS rather than on the
//      league's filing schedule: it had Dart "Out — Knee - MCL, Surgery" and Williams "Doubtful —
//      Hamstring" the previous evening, plus Jayden Daniels out.
//   3. ESPN's per-game injury block. This is the one that keeps moving on GAME DAY, which neither
//      of the above does: the INACTIVES list is official 90 minutes before kickoff and is published
//      on a different clock entirely. Measured against our own capture for Week 1 NE @ SEA, ESPN
//      also simply had MORE — Zach Charbonnet OUT (Seattle's starter, and the reason Jadarian Price
//      is playing) plus four Injured Reserve designations our feed never listed.
//
// The order is the point. A wire report fills the silence the official report leaves, and the
// official inactives then overrule the wire, because 90 minutes before kickoff the league's list is
// the truth and a beat reporter's is not.
//
// A GitHub Actions cron cannot serve (3): its finest useful cadence is ~5 minutes and scheduled
// runs routinely start 5-15 minutes late, so a T-90 sweep can land at T-70. It serves (2) well,
// where the news moves over days and the payload — every player in the league, 14.7MB parsed — is
// far too heavy to pull on a page render.
//
// No source can throw. Availability improves the board, so a failure must degrade to "no tags",
// never to a broken page; and (2) simply returns nothing until its table exists.

import { normName, playerSlot } from "@/lib/playerSlot";

/** ESPN's designation, normalised. Ordered by how much it should suppress. */
export type InjuryStatus = "OUT" | "IR" | "SUSPENDED" | "DOUBTFUL" | "QUESTIONABLE";

export interface InjuryNote {
  status: InjuryStatus;
  label: string;          // what the board prints: "Out", "Doubtful", "Questionable", "IR"
  detail: string | null;  // "Ankle", "Hamstring" — null when ESPN gives no cause
  // The name as the SOURCE spells it. The map is keyed on a normalised name, which is right for
  // looking a player up and useless for printing him, and the model board's Special
  // Considerations block lists the designated players by name.
  player: string;
}

/** A player with one of these is not going to produce, so his projection is withheld. */
export const SUPPRESSES = new Set<InjuryStatus>(["OUT", "IR", "SUSPENDED"]);

// ESPN abbreviates two clubs differently from nflverse, which is what our board uses.
// Everything else matches, verified against a live scoreboard for all 32.
const TEAM_ALIAS: Record<string, string> = { LAR: "LA", WSH: "WAS" };
const ourTeam = (espn: string) => TEAM_ALIAS[espn] ?? espn;

const STATUS_MAP: Record<string, { status: InjuryStatus; label: string }> = {
  INJURY_STATUS_OUT: { status: "OUT", label: "Out" },
  INJURY_STATUS_DOUBTFUL: { status: "DOUBTFUL", label: "Doubtful" },
  INJURY_STATUS_QUESTIONABLE: { status: "QUESTIONABLE", label: "Questionable" },
  INJURY_STATUS_IR: { status: "IR", label: "IR" },
  INJURY_STATUS_SUSPENSION: { status: "SUSPENDED", label: "Susp." },
  INJURY_STATUS_PUP: { status: "IR", label: "PUP" },
  INJURY_STATUS_NFI: { status: "IR", label: "NFI" },
};

// Fall back to the human string when ESPN adds a type we have not mapped, so a new designation
// degrades to "shown but not suppressing" rather than vanishing.
function classify(typeName: string, statusText: string): { status: InjuryStatus; label: string } | null {
  const mapped = STATUS_MAP[typeName];
  if (mapped) return mapped;
  const t = (statusText || "").trim().toLowerCase();
  if (t === "out") return { status: "OUT", label: "Out" };
  if (t === "doubtful") return { status: "DOUBTFUL", label: "Doubtful" };
  if (t === "questionable") return { status: "QUESTIONABLE", label: "Questionable" };
  if (t.includes("injured reserve")) return { status: "IR", label: "IR" };
  return null;
}

// Same call shape as `cfbScores.ts`, which has been serving live NCAAF scores in production for
// months — copy the working pattern rather than inventing one. (A local probe had ESPN 403 every
// request carrying ANY User-Agent and serve only header-less ones, which would have argued for
// sending none; that is this sandbox's egress being fingerprinted, not ESPN's policy, and Node
// cannot omit the header anyway. When a local probe contradicts code that demonstrably works in
// production, trust production.)
async function espn(url: string, revalidate: number): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      next: { revalidate },
    });
    if (!res.ok) {
      console.warn(`[nflInactives] ESPN ${res.status} for ${url}`);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.warn(`[nflInactives] ESPN fetch failed: ${String(e)}`);
    return null;
  }
}

/** The key the board looks a player up by: normalised name + our team abbreviation. */
export const injuryKey = (player: string, team: string) => `${normName(player)}|${team}`;

interface PracticeRow {
  scraped_name: string | null;
  team: string | null;
  game_status: string | null;
  injury_primary: string | null;
  report_date: string | null;
}

// Our own capture. NONE is the common value (a player on the report who carries no designation),
// and it must NOT become a tag — a "NONE" pill would say the opposite of what it means.
const PRACTICE_STATUS: Record<string, { status: InjuryStatus; label: string }> = {
  OUT: { status: "OUT", label: "Out" },
  DOUBTFUL: { status: "DOUBTFUL", label: "Doubtful" },
  QUESTIONABLE: { status: "QUESTIONABLE", label: "Questionable" },
  IR: { status: "IR", label: "IR" },
};

async function addPracticeReports(out: Map<string, InjuryNote>, season: number, week: number) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return;
  try {
    const q = `?select=scraped_name,team,game_status,injury_primary,report_date` +
      `&season=eq.${season}&week=eq.${week}&order=report_date.asc`;
    const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/practice_reports${q}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Range: "0-4999", "Range-Unit": "items" },
      next: { revalidate: 120 },
    });
    if (!res.ok && res.status !== 206) return;
    const rows = (await res.json()) as PracticeRow[];
    // Ascending by report_date, so a later report overwrites an earlier one for the same player —
    // Friday's designation is the one that counts, not Wednesday's.
    for (const r of rows) {
      if (!r.scraped_name || !r.team) continue;
      const c = PRACTICE_STATUS[(r.game_status || "").toUpperCase()];
      if (!c) continue;
      out.set(injuryKey(r.scraped_name, r.team), {
        status: c.status, label: c.label, detail: r.injury_primary ?? null, player: r.scraped_name,
      });
    }
  } catch {
    /* availability is an enhancement — a failed read must never break the board */
  }
}

// ---------------------------------------------------------------- Sleeper (news-driven)
//
// Derek: "I'm not seeing Jaxson Dart major injury in the NYG game (he's out for the season)...
// Also the same for Caleb Williams for the Bears."
//
// He was right, and the reason is structural rather than a bug. The two sources above are both
// versions of the OFFICIAL game-status report, and that report has two blind spots:
//
//   - it carries no designation until Friday, so a Wednesday DNP reads as nothing. Dart was in our
//     week-3 data with practice_status "Did Not Participate In Practice" and report_status NULL;
//   - a player moved to injured reserve drops OFF the report entirely rather than being marked,
//     because he is off the active roster. Caleb Williams had zero rows.
//
// Measured against the live feed the same morning: nflverse had Dart as an undesignated DNP and
// nothing at all on Williams, while Sleeper had Dart "Out — Knee - MCL, Surgery" and Williams
// "Doubtful — Hamstring", both timestamped the previous evening. It also had Jayden Daniels out.
//
// Sleeper is a fantasy platform aggregating the same beat reporting the wires carry. It is free,
// needs no key, and is the only feed we found that moves on NEWS instead of on the league's filing
// schedule. It is layered BETWEEN our capture and ESPN deliberately: it fills the silence the
// official report leaves, and ESPN's game-day inactives still overrule it, because 90 minutes
// before kickoff the official list is the truth and a wire report is not.
//
// SKILL POSITIONS ONLY. Sleeper carries ~14 designated players per team across the whole roster,
// most of them long-term IR that changes nothing about this week; taking all of them would bury
// the Special Considerations block in names. Non-skill injuries keep coming from the two official
// sources, as today.
//
// Read from OUR table, not from Sleeper directly. The endpoint is every player in the league —
// 2.6MB gzipped, 14.7MB parsed — which is far too much to do on a page render, and Sleeper asks
// that it not be polled hard. `capture-sleeper.yml` writes changes every four hours into
// `sleeper_availability`; this reads ~450 small rows from the current-state view. The position and
// status filtering happens once, in ingest/sleeper_availability.py.
interface SleeperRow {
  player: string | null; team: string | null; pos: string | null;
  status: string | null; body_part: string | null;
}

/** A player who was out and is not any more. `missed` is distinct weeks he appeared on the report
 *  as Out/Doubtful/IR; 0 when the only evidence is a cleared news designation, which carries no
 *  week of its own (someone activated off IR, say). */
export interface ReturningNote { player: string; team: string; slot: string | null; missed: number }

// "NA" is deliberately absent: Sleeper uses it for "no current information", and healthy starters
// carry it. Mapping it to a tag would put a pill on players with nothing wrong.
const SLEEPER_STATUS: Record<string, { status: InjuryStatus; label: string }> = {
  OUT: { status: "OUT", label: "Out" },
  IR: { status: "IR", label: "IR" },
  PUP: { status: "IR", label: "PUP" },
  NFI: { status: "IR", label: "NFI" },
  DNR: { status: "IR", label: "DNR" },
  DOUBTFUL: { status: "DOUBTFUL", label: "Doubtful" },
  QUESTIONABLE: { status: "QUESTIONABLE", label: "Questionable" },
  SUS: { status: "SUSPENDED", label: "Susp." },
};

/** One row per player, newest first, from the DISTINCT ON view. Rows whose status is NULL are
 *  players who have been CLEARED; they are filtered out here and read by `weekReturning` below —
 *  stored rather than deleted so "he was out and now is not" stays answerable. */
async function sleeperRows(statusIsNull: boolean, since?: string): Promise<SleeperRow[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return [];
  const filter = (statusIsNull ? "status=is.null" : "status=not.is.null")
    + (since ? `&captured_at=gte.${since}` : "");
  try {
    const q = `?select=player,team,pos,status,body_part&${filter}&limit=2000`;
    const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/sleeper_availability_current${q}`, {
      headers: {
        apikey: key, Authorization: `Bearer ${key}`,
        Range: "0-1999", "Range-Unit": "items",
      },
      next: { revalidate: 300 },
    });
    if (!res.ok && res.status !== 206) {
      // 404 here means the table has not been created yet — run ingest/sleeper_availability.sql.
      console.warn(`[nflInactives] sleeper_availability_current ${res.status}`);
      return [];
    }
    return (await res.json()) as SleeperRow[];
  } catch (e) {
    /* availability is an enhancement — a failed read must never break the board */
    console.warn(`[nflInactives] sleeper_availability read failed: ${String(e)}`);
    return [];
  }
}

interface SleeperPlayer {
  full_name?: string; team?: string | null; position?: string | null;
  active?: boolean; injury_status?: string | null; injury_body_part?: string | null;
}

const SLEEPER_TEAM: Record<string, string> = { LAR: "LA", OAK: "LV" };
const SLEEPER_POS = new Set(["QB", "RB", "WR", "TE", "K", "FB"]);

/**
 * Straight from Sleeper, used ONLY when the table has nothing.
 *
 * The table is the intended path and this is the safety net: before `ingest/sleeper_availability.sql`
 * has been run, or if the capture cron stops, the board would otherwise silently lose every player
 * the official report cannot see — which is the exact failure this source was added to fix, so it
 * must not be the failure mode. It costs a 2.6MB fetch and a 14.7MB parse, hence the hour-long
 * revalidate and hence not doing it as a matter of course.
 */
async function sleeperDirect(): Promise<SleeperRow[]> {
  try {
    const res = await fetch("https://api.sleeper.app/v1/players/nfl", {
      headers: { "User-Agent": "statseer/1.0" },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return [];
    const all = (await res.json()) as Record<string, SleeperPlayer>;
    const rows: SleeperRow[] = [];
    for (const p of Object.values(all)) {
      if (!p?.active || !p.team || !p.full_name) continue;
      if (!SLEEPER_POS.has(String(p.position ?? ""))) continue;
      if (!p.injury_status) continue;
      rows.push({
        player: p.full_name, team: SLEEPER_TEAM[p.team] ?? p.team, pos: p.position ?? null,
        status: p.injury_status, body_part: p.injury_body_part ?? null,
      });
    }
    return rows;
  } catch {
    return [];
  }
}

async function addSleeper(out: Map<string, InjuryNote>) {
  let rows = await sleeperRows(false);
  if (!rows.length) rows = await sleeperDirect();
  for (const r of rows) {
    if (!r.player || !r.team || !r.status) continue;
    const c = SLEEPER_STATUS[r.status.toUpperCase()];
    if (!c) continue;
    out.set(injuryKey(r.player, r.team), {
      status: c.status, label: c.label, detail: r.body_part ?? null, player: r.player,
    });
  }
}

/**
 * Players who WERE out and are not any more — the "key players back" row.
 *
 * Derek: "I also want to setup a 'key players back' row in the Injuries sections. Like tonight,
 * ATL is getting their QB1 Michael Penix Jr back."
 *
 * Two sources, because they cover different absences:
 *
 *   - `practice_reports` for the preceding weeks. Penix carried game_status OUT for week 2 and
 *     nothing for week 3, which is the whole signal. This needs no new history and works today.
 *   - the cleared rows in `sleeper_availability`, which catch the returns the official report never
 *     recorded in the first place — anyone activated off IR, who was invisible to it going out and
 *     would be invisible coming back.
 *
 * Anyone carrying a CURRENT designation is excluded. A player who was out in week 2 and is doubtful
 * again is not back, he is still hurt, and listing him under "back" would be worse than not listing
 * him at all.
 */
export async function weekReturning(
  season: number, week: number, current: Map<string, InjuryNote>,
): Promise<Map<string, ReturningNote[]>> {
  const byTeam = new Map<string, ReturningNote[]>();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key || week < 2) return byTeam;

  const seen = new Set<string>();
  const add = (player: string, team: string, missed: number, slotOnly = false) => {
    const k = injuryKey(player, team);
    const now = current.get(k);
    // Still designated in any form -> not back.
    if (now) return;
    if (seen.has(k)) return;
    // The slot is a LABEL, not a gate. Requiring one silently restricted this row to skill
    // players: `depthChart.ts` is the OFFENSIVE chart (WR/RB/QB/FB/TE only), so every returning
    // lineman, linebacker and defensive back was dropped. Derek: "I'm not seeing players listed
    // as back in the injury sections for any other team except the falcons" — and he was right,
    // 35 of the 50 players who were designated last week and are clear now were being thrown away
    // for having no entry, leaving four names across two teams.
    //
    // The list directly above this one shows injuries at EVERY position, so the returns have to as
    // well or the two disagree on screen. What keeps it honest instead is the status gate in the
    // caller: he has to have been genuinely OUT, not merely doubtful.
    const slot = playerSlot(player, "nfl");
    seen.add(k);
    const list = byTeam.get(team) ?? [];
    list.push({ player, team, slot: slot ?? null, missed });
    byTeam.set(team, list);
  };

  // Look back three weeks to measure how long he was gone, but he only counts as BACK if he was
  // designated in the week immediately before this one. Derek's ask is about a player a team is
  // getting back NOW — "tonight, ATL is getting their QB1 Michael Penix Jr back" — and without
  // that condition the row goes stale: TreVeyon Henderson was out in week 1, back in week 2, and
  // would still have been announced as returning in week 3.
  const from = Math.max(1, week - 3);
  try {
    const q = `?select=scraped_name,team,game_status,week&season=eq.${season}` +
      `&week=gte.${from}&week=lt.${week}&game_status=in.(OUT,DOUBTFUL,IR)`;
    const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/practice_reports${q}`, {
      headers: {
        apikey: key, Authorization: `Bearer ${key}`,
        Range: "0-9999", "Range-Unit": "items",
      },
      next: { revalidate: 300 },
    });
    if (res.ok || res.status === 206) {
      const rows = (await res.json()) as
        { scraped_name: string | null; team: string | null; game_status: string | null; week: number }[];
      // Two different counts, because they mean different things. `missed` counts only OUT and IR:
      // Doubtful is a designation, not an outcome, and a player who was doubtful and played did not
      // miss that game — printing "missed 2 games" for him would be simply untrue. `lastWeek` is
      // the qualifier and accepts Doubtful, because being doubtful is still being hurt.
      // Both count DISTINCT WEEKS, never rows: the report is written several times a week, so a
      // row count would claim a player missed six games inside one week.
      const seenWk = new Map<string, {
        player: string; team: string; missed: Set<number>; lastWeek: boolean;
      }>();
      for (const r of rows) {
        if (!r.scraped_name || !r.team) continue;
        const k = injuryKey(r.scraped_name, r.team);
        const e = seenWk.get(k)
          ?? { player: r.scraped_name, team: r.team, missed: new Set<number>(), lastWeek: false };
        const st = (r.game_status || "").toUpperCase();
        if (st === "OUT" || st === "IR") e.missed.add(r.week);
        // Only a genuine absence counts as a return. Doubtful is a designation, not an outcome,
        // and "back" should mean he was actually missing.
        if (r.week === week - 1 && (st === "OUT" || st === "IR")) e.lastWeek = true;
        seenWk.set(k, e);
      }
      for (const e of seenWk.values()) {
        if (e.lastWeek) add(e.player, e.team, e.missed.size);
      }
    }
  } catch {
    /* enhancement only */
  }

  // Cleared news designations catch the returns the official report never recorded going out —
  // anyone activated off IR. Bounded to the last ten days for the same reason as `lastWeek` above:
  // a clearing from a month ago is not a player a team is getting back this week.
  const since = new Date(Date.now() - 10 * 864e5).toISOString();
  for (const r of await sleeperRows(true, since)) {
    if (r.player && r.team) add(r.player, r.team, 0);
  }
  return byTeam;
}

interface EspnCompetitor { team?: { abbreviation?: string } }
interface EspnEvent { id?: string; competitions?: { competitors?: EspnCompetitor[] }[] }
interface EspnInjury {
  status?: string;
  type?: { name?: string };
  details?: { type?: string };
  athlete?: { displayName?: string };
}
interface EspnInjuryGroup { team?: { abbreviation?: string }; injuries?: EspnInjury[] }

/**
 * Designations for every game in one NFL week, keyed by `injuryKey(player, team)`.
 *
 * Cached for 120s, the same window the prop lines already use, so availability and the book line
 * on a row are never more than two minutes apart from each other.
 */
export async function weekInjuries(season: number, week: number): Promise<Map<string, InjuryNote>> {
  const out = new Map<string, InjuryNote>();

  // ---- 1. Our own capture. Keyed on normalised name + team because `practice_reports.gsis_id`
  // is NULL on every row: the `players` table is not seeded yet, so the ingest deliberately stores
  // gsis as null and keeps the scraped name (it is backfillable, the daily status is not). Name
  // keys are the weaker join and this file should say so rather than pretend otherwise — the team
  // is carried alongside precisely to make a collision need TWO coincidences.
  await addPracticeReports(out, season, week);

  // ---- 2. Sleeper, which moves on news rather than on the league's filing schedule, so it fills
  // the gap before Friday's designation and the gap left by anyone moved to IR. Run BEFORE the
  // early return below: if ESPN's scoreboard is unavailable, we still want these.
  await addSleeper(out);

  // ---- 3. ESPN, layered on top, so a game-day change wins over everything above it.
  const board = (await espn(
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard` +
    `?year=${season}&seasontype=2&week=${week}`, 600)) as { events?: EspnEvent[] } | null;
  const ids = (board?.events ?? []).map((e) => e.id).filter((x): x is string => !!x);
  if (!ids.length) return out;

  // One request per game, in parallel, each cached independently. 16 games, and only the first
  // render in a 120s window pays for them.
  const summaries = await Promise.all(ids.map((id) => espn(
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${id}`, 120)));

  for (const s of summaries) {
    const groups = (s as { injuries?: EspnInjuryGroup[] } | null)?.injuries ?? [];
    for (const g of groups) {
      const team = ourTeam(g.team?.abbreviation ?? "");
      if (!team) continue;
      for (const inj of g.injuries ?? []) {
        const name = inj.athlete?.displayName;
        if (!name) continue;
        const c = classify(inj.type?.name ?? "", inj.status ?? "");
        if (!c) continue;
        out.set(injuryKey(name, team), {
          status: c.status,
          label: c.label,
          detail: inj.details?.type ?? null,
          player: name,
        });
      }
    }
  }
  return out;
}
