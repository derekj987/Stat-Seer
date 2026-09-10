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

/** A book's display name, falling back to the raw slug so a new book still renders. */
export const bookLabel = (slug: string): string => BOOK_LABEL[slug] ?? slug;

/** Name the books while they fit; count them once they do not. */
export const booksLabel = (books: string[], max = 2): string =>
  books.length > max ? `${books.length} books` : books.map(bookLabel).join(" / ");
