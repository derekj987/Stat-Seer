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
  betparx: "betPARX",
  betus: "BetUS",
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
 *  The capture requests both US regions ("us,us2" since 2026-09-11; 6 credits a sweep instead of
 *  3, against a 5M-credit plan), which is where ESPN BET, Hard Rock, Bally Bet and betPARX come
 *  from. us2 also carries state feeds (hardrockbet_fl, hardrockbet_oh), sweepstakes books (fliff,
 *  rebet) and another offshore (betanysports): a state feed would count Hard Rock three times in
 *  a "×3 books" tie, and the others are not books a member shops, so none of them are listed. */
export const US_BOOKS = new Set([
  "draftkings", "fanduel", "betmgm", "williamhill_us", "fanatics", "betrivers",
  "espnbet", "hardrockbet", "ballybet", "betparx",
]);
export const isUsBook = (slug: string): boolean => US_BOOKS.has(slug);
/** Keep only rows from US-licensed books. Every reader calls this before anything else looks. */
export const usBooks = <T extends { book: string }>(rows: T[]): T[] => rows.filter((r) => isUsBook(r.book));

/** Short codes for dense grids (the MLB batter grid puts a book beside every price in six
 *  columns; "DraftKings" is 55px and the cell has 34). Full names stay on the tooltip and in a
 *  legend line above the grid. */
const BOOK_CODE: Record<string, string> = {
  draftkings: "DK", fanduel: "FD", betmgm: "MGM", williamhill_us: "CZR", fanatics: "FAN",
  betrivers: "BR", espnbet: "ESPN", hardrockbet: "HRK", ballybet: "BLY", betparx: "PARX",
};
export const bookCode = (slug: string): string => BOOK_CODE[slug] ?? bookLabel(slug).slice(0, 4);
/** One code, or a count for a tie ("×3"). */
export const booksCode = (books: string[]): string => (books.length > 1 ? `×${books.length}` : bookCode(books[0]));
/** "DK DraftKings · FD FanDuel · …" for the books present on a board. */
export const bookLegend = (slugs: string[]): string =>
  slugs.filter((s) => BOOK_CODE[s]).map((s) => `${BOOK_CODE[s]} ${bookLabel(s)}`).join(" · ");

/** A book's display name, falling back to the raw slug so a new book still renders. */
export const bookLabel = (slug: string): string => BOOK_LABEL[slug] ?? slug;

/** Name the books while they fit; count them once they do not. */
export const booksLabel = (books: string[], max = 2): string =>
  books.length > max ? `${books.length} books` : books.map(bookLabel).join(" / ");
