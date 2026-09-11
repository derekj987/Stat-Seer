// Sportsbook slugs as the books spell themselves.
//
// The odds feed uses lowercase keys ("williamhill_us", "betonlineag") and those were rendered
// verbatim. Besides reading like database rows, they are LONGER than the real names — the book
// pill on /props clipped "fanduel / williamhill_us" at 140px, and "Caesars" is half the width of
// "williamhill_us". Naming a book properly is both the tidier and the narrower option.
//
// Hand-written and deliberately NOT in a generated file: it is a display detail, and anything
// added to a generated module is wiped by the job that regenerates it.
const BOOK_LABEL: Record<string, string> = {
  fanduel: "FanDuel",
  draftkings: "DraftKings",
  betmgm: "BetMGM",
  betrivers: "BetRivers",
  bovada: "Bovada",
  betonlineag: "BetOnline",
  fanatics: "Fanatics",
  williamhill_us: "Caesars",
  espnbet: "ESPN BET",
  hardrockbet: "Hard Rock",
  ballybet: "Bally Bet",
  fliff: "Fliff",
  novig: "Novig",
  prophetx: "ProphetX",
  lowvig: "LowVig",
  mybookieag: "MyBookie",
};

/** The sportsbooks the site compares: US-licensed books only.
 *
 *  The odds feed's "us" region also returns offshore books — bovada, betonlineag, lowvig,
 *  mybookieag, betus — and every board was quietly shopping across them, so "best price" was
 *  sometimes a book a US member cannot legally use. Derek: "let's only use the 10 US sportsbooks."
 *  Rows from any other book are dropped at the READ layer (`usBooks` below) on every sport, so the
 *  best price, the de-vigged fair number, the shopping edge and the slip all agree on the field.
 *
 *  Captured but never shown is the right split: the capture returns them at no extra credit cost
 *  and history is free; deciding what a member sees is a display policy, which lives here.
 *
 *  Currently captured from this list: DraftKings, FanDuel, BetMGM, Caesars, Fanatics, BetRivers.
 *  ESPN BET, Hard Rock, Bally Bet and betPARX are on the feed's "us2" region, which the capture
 *  does not request (it would double the credit cost of every sweep) — listed so they appear the
 *  day that changes, with no code change. */
export const US_BOOKS = new Set([
  "draftkings", "fanduel", "betmgm", "williamhill_us", "fanatics", "betrivers",
  "espnbet", "hardrockbet", "ballybet", "betparx",
]);
export const isUsBook = (slug: string): boolean => US_BOOKS.has(slug);
/** Keep only rows from US-licensed books. Every reader calls this before anything else looks. */
export const usBooks = <T extends { book: string }>(rows: T[]): T[] => rows.filter((r) => isUsBook(r.book));

/** A book's display name, falling back to the raw slug so a new book still renders. */
export const bookLabel = (slug: string): string => BOOK_LABEL[slug] ?? slug;

/** Name the books while they fit; count them once they do not. */
export const booksLabel = (books: string[], max = 2): string =>
  books.length > max ? `${books.length} books` : books.map(bookLabel).join(" / ");
