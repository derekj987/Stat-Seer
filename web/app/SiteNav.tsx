"use client";

// Global navigation bar — the single top menu across the whole app. Replaces the
// old AuthBar + the per-page section tabs. Circle logo (home), section links, a
// Community link, and a user menu (profile / settings / reports / log out). On
// mobile it collapses to a hamburger drawer that also lists the Value Finder
// subsections.
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { SPORTS } from "./Nav";

type Me = { username: string; role: string; title: string | null } | null;

const LINKS = [
  { href: "/", label: "Home", on: (p: string) => p === "/" },
  { href: "/model", label: "The Model", on: (p: string) => p.startsWith("/model") },
  { href: "/considerations", label: "Context", on: (p: string) => ["/context", "/considerations", "/tailgate"].some((x) => p.startsWith(x)) },
  { href: "/lines", label: "Value Finder", on: (p: string) => ["/lines", "/props", "/preseason", "/best"].some((x) => p.startsWith(x)) },
  { href: "/forum", label: "Community", on: (p: string) => p.startsWith("/forum") },
];
const MOD = ["founder", "admin"];

export default function SiteNav() {
  const pathname = usePathname() || "/";
  const [me, setMe] = useState<Me | undefined>(undefined);
  const [open, setOpen] = useState(false);       // mobile drawer
  const [solid, setSolid] = useState(false);       // homepage: opaque once scrolled past the hero

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      setMe(null);
      return;
    }
    const supabase = createClient();
    let active = true;
    const load = async () => {
      const { data } = await supabase.auth.getUser();
      if (!active) return;
      const u = data.user;
      if (!u) { setMe(null); return; }
      const { data: profile } = await supabase
        .from("profiles").select("username,role,title").eq("id", u.id).single();
      if (!active) return;
      setMe({
        username: profile?.username ?? (u.user_metadata?.username as string) ?? u.email ?? "member",
        role: profile?.role ?? "member",
        title: profile?.title ?? null,
      });
    };
    load();
    const { data: sub } = supabase.auth.onAuthStateChange(() => load());
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, []);

  // Close the drawer whenever the route changes.
  useEffect(() => { setOpen(false); }, [pathname]);

  // Homepage only: the bar floats transparent over the hero, then turns solid once the
  // hero has scrolled up past it. Other pages keep their normal solid bar (solid stays false).
  useEffect(() => {
    if (pathname !== "/") { setSolid(false); return; }
    const onScroll = () => {
      const hero = document.querySelector<HTMLElement>(".lp-hero__banner");
      const threshold = hero ? hero.getBoundingClientRect().height - 48 : 120;
      setSolid(window.scrollY > Math.max(40, threshold));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [pathname]);

  async function logout() {
    await createClient().auth.signOut();
    location.href = "/";
  }

  return (
    <header className={solid ? "snav snav--solid" : "snav"}>
      <div className="snav__bar">
        <a href="/" className="snav__home" aria-label="StatSeer home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark.png?v=5" alt="" className="snav__logo" width={34} height={34} />
        </a>

        <button className="snav__burger" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <span /><span /><span />
        </button>

        {/* Main StatSeer wordmark + tagline — the brand block in the top bar, right of
            the hamburger (moved up from the homepage masthead). Wordmark and tagline are
            a lockup: inline on desktop, stacked (tagline beneath) on phones so the tagline
            still shows next to StatSeer. The crest lives over in snav__right, just left of
            the Create-an-Account button. */}
        <span className="snav__brandlock">
          <a href="/" className="snav__brand">StatSeer</a>
          <span className="snav__tagline">Arm yourself with data-driven decisions.</span>
        </span>

        <nav className="snav__links" aria-label="Primary">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className={l.on(pathname) ? "snav__link active" : "snav__link"}>{l.label}</a>
          ))}
        </nav>

        <div className="snav__right">
          <span className="snav__crest" role="img" aria-label="StatSeer crest" />
          {/* Forums button (green, always visible) sits between the crest and the signup CTA. */}
          <a href="/forum" className="snav__forums">Join our community</a>
          {/* Signed OUT → Create-an-Account CTA. Signed IN → "Logged in as X" + a direct
              "View my profile" button (logout/settings live in the hamburger drawer). */}
          {me === undefined ? (
            <span className="snav__slot" />
          ) : me ? (
            <>
              <span className="snav__loggedin">
                <span className="snav__lilabel">Logged in as</span>{" "}
                <a href={`/u/${me.username}`} className={me.role === "founder" ? "snav__loggedname founder" : "snav__loggedname"}>{me.username}</a>
              </span>
              <a href={`/u/${me.username}`} className="snav__profilebtn">View my profile</a>
            </>
          ) : (
            <a href="/signup" className="snav__signup">
              <span className="snav__signup__full">Create an Account / Login</span>
              <span className="snav__signup__short">Sign in</span>
            </a>
          )}
        </div>
      </div>

      {open && (
        <>
        <div className="snav__scrim" onClick={() => setOpen(false)} aria-hidden="true" />
        <div className="snav__drawer" role="dialog" aria-label="Menu">
          <button className="snav__dclose" onClick={() => setOpen(false)} aria-label="Close menu">✕</button>
          <a href="/" className="snav__dtop snav__dhome">Home
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/crest.png?v=4" alt="" className="snav__dcrest" width={22} height={22} />
          </a>

          <details className="snav__pgroup" open>
            <summary className="snav__dtop snav__psum">Popular</summary>

            {/* NFL is live — its own dropdown, holding The Model / Context / Value
                Finder. The "NFL" text stays a clickable link to its home; the chevron
                (or the rest of the row) toggles the group open. Collapsed by default now
                that several sports share the list. Template for every future sport. */}
            <details className="snav__pgroup snav__sportgroup">
              <summary className="snav__sportsum">
                <a href="/model" className="snav__sportname" onClick={(e) => e.stopPropagation()}>NFL</a>
                <span className="snav__sportchev" aria-hidden="true">▾</span>
              </summary>
              <div className="snav__sportkids">
                <a href="/model" className="snav__dfeat">The Model</a>

                <details className="snav__pgroup snav__pgroup--feat">
                  <summary className="snav__dfeat snav__psum">Context</summary>
                  <a href="/considerations" className="snav__dsub">Special Considerations</a>
                  <a href="/context" className="snav__dsub">Upset Watch</a>
                  <a href="/tailgate" className="snav__dsub">Local Intelligence</a>
                </details>

                <details className="snav__pgroup snav__pgroup--feat">
                  <summary className="snav__dfeat snav__psum">Value Finder</summary>
                  <a href="/lines" className="snav__dsub">Game Lines</a>
                  <a href="/props" className="snav__dsub">Player Props</a>
                  <a href="/best" className="snav__dsub">Sweet Spots</a>
                </details>
              </div>
            </details>

            {/* NCAAF — live, same template as NFL: Model + Context/Value Finder as
                nested dropdowns holding their subpages. Some subpages are live now
                (Special Considerations, Sweet Spots, Game Lines) and the rest arrive
                with the season's odds/props/fan data. */}
            <details className="snav__pgroup snav__sportgroup">
              <summary className="snav__sportsum">
                <a href="/ncaaf/model" className="snav__sportname" onClick={(e) => e.stopPropagation()}>NCAAF</a>
                <span className="snav__sportchev" aria-hidden="true">▾</span>
              </summary>
              <div className="snav__sportkids">
                <a href="/ncaaf/model" className="snav__dfeat">The Model</a>

                <details className="snav__pgroup snav__pgroup--feat">
                  <summary className="snav__dfeat snav__psum">Context</summary>
                  <a href="/ncaaf/considerations" className="snav__dsub">Special Considerations</a>
                  <a href="/ncaaf/context" className="snav__dsub">Upset Watch</a>
                  <a href="/ncaaf/tailgate" className="snav__dsub">Local Intelligence</a>
                </details>

                <details className="snav__pgroup snav__pgroup--feat">
                  <summary className="snav__dfeat snav__psum">Value Finder</summary>
                  <a href="/ncaaf/lines" className="snav__dsub">Game Lines</a>
                  <a href="/ncaaf/props" className="snav__dsub">Player Props</a>
                  <a href="/ncaaf/best" className="snav__dsub">Sweet Spots</a>
                </details>
              </div>
            </details>

            {SPORTS.filter((s) => !s.live).map((s) => (
              <span key={s.key} className="snav__dsport snav__dsport--soon">{s.label}<em>Soon</em></span>
            ))}
          </details>

          <div className="snav__ddiv" />
          <a href="/forum" className="snav__dtop">Community</a>
          <a href="/how" className="snav__dtop">How our Model works</a>

          <div className="snav__ddiv" />
          <details className="snav__pgroup">
            <summary className="snav__dtop snav__psum">User Options</summary>
            {me === undefined ? null : me ? (
              <>
                {me.role === "founder" && <a href="/creator" className="snav__dusr snav__mi--founder">★ Creator dashboard</a>}
                <a href={`/u/${me.username}`} className="snav__dusr">My profile</a>
                <a href="/settings" className="snav__dusr">Account settings</a>
                {MOD.includes(me.role) && <a href="/forum/reports" className="snav__dusr">Reports</a>}
                {MOD.includes(me.role) && <a href="/feedback" className="snav__dusr">Feedback inbox</a>}
                <button type="button" className="snav__dusr" onClick={logout}>Log out</button>
              </>
            ) : (
              <>
                <a href="/login" className="snav__dusr">Log in</a>
                <a href="/signup" className="snav__dusr">Sign up</a>
              </>
            )}
          </details>
        </div>
        </>
      )}
    </header>
  );
}
