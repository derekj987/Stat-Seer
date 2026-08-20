// Honest placeholder for an NCAAF section whose live data isn't flowing yet. Says
// plainly what it will be, what it's waiting on, and where the live content is now —
// no fake numbers, matching the transparency of the /ncaaf Model page.
export function NcaafSoon({ title, blurb, waitingOn, links }: {
  title: string;
  blurb: string;
  waitingOn: string;
  links: { href: string; label: string }[];
}) {
  return (
    <div className="ncf-soon" role="note">
      <span className="ncf-soon__tag">Arriving with the season</span>
      <h2 className="ncf-soon__h">{title}</h2>
      <p className="ncf-soon__p">{blurb}</p>
      <p className="ncf-soon__wait"><b>Waiting on:</b> {waitingOn}</p>
      <div className="ncf-soon__links">
        {links.map((l) => (
          <a key={l.href} href={l.href} className="ncf-soon__link">{l.label} →</a>
        ))}
      </div>
    </div>
  );
}
