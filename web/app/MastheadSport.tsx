// Sport marker for the inner-page masthead's open band. The football-glyph + sport-name
// placeholder was removed — a per-sport logo IMAGE will replace it once provided; until
// then this renders nothing (so the band is clear on every Model / Context / Value Finder
// page, NFL and NCAAF alike).
//
// To restore with the image: make this a client component ("use client" + usePathname),
// detect the sport ( "/ncaaf" or "/ncaaf/*" => ncaaf ; "/nfl" or the un-prefixed section
// routes /model|/context|/considerations|/tailgate|/lines|/props|/best|/preseason => nfl ;
// otherwise null ) and render <img> of that sport's logo inside <div className="msport">.
export default function MastheadSport() {
  return null;
}
