"use client";

// Global navigation bar — the single top menu across the whole app. Replaces the
// old AuthBar + the per-page section tabs. Circle logo (home), section links, a
// Community link, and a user menu (profile / settings / reports / log out). On
// mobile it collapses to a hamburger drawer that also lists the Value Finder
// subsections.
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import MottoBar from "./MottoBar";

type Me = { username: string; role: string; title: string | null } | null;

const LINKS = [
  { href: "/", label: "Home", on: (p: string) => p === "/" },
  { href: "/model", label: "The Model", on: (p: string) => p.startsWith("/model") },
  { href: "/context", label: "The Context", on: (p: string) => ["/context", "/tailgate", "/best"].some((x) => p.startsWith(x)) },
  { href: "/lines", label: "Shop Around", on: (p: string) => ["/lines", "/props", "/preseason"].some((x) => p.startsWith(x)) },
  { href: "/forum", label: "Community", on: (p: string) => p.startsWith("/forum") },
];
const MOD = ["founder", "admin"];

export default function SiteNav() {
  const pathname = usePathname() || "/";
  const [me, setMe] = useState<Me | undefined>(undefined);
  const [open, setOpen] = useState(false);       // mobile drawer
  const [userOpen, setUserOpen] = useState(false); // desktop user dropdown

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

  // Close menus whenever the route changes.
  useEffect(() => { setOpen(false); setUserOpen(false); }, [pathname]);

  async function logout() {
    await createClient().auth.signOut();
    location.href = "/";
  }

  return (
    <header className="snav">
      <div className="snav__bar">
        <a href="/" className="snav__home" aria-label="StatSeer home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark.png?v=3" alt="" className="snav__logo" width={34} height={34} />
        </a>

        {me === null && <a href="/signup" className="snav__signup">Create an Account</a>}

        <nav className="snav__links" aria-label="Primary">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className={l.on(pathname) ? "snav__link active" : "snav__link"}>{l.label}</a>
          ))}
        </nav>

        <MottoBar />

        <div className="snav__right">
          {me === undefined ? (
            <span className="snav__slot" />
          ) : me ? (
            <div className="snav__usr">
              <button className="snav__usrbtn" onClick={() => setUserOpen((v) => !v)} aria-expanded={userOpen}>
                <span className={me.role === "founder" ? "snav__name founder" : "snav__name"}>{me.username}</span>
                <span className="snav__caret" aria-hidden="true">▾</span>
              </button>
              {userOpen && (
                <div className="snav__menu">
                  <a href={`/u/${me.username}`} className="snav__mi">My profile</a>
                  <a href="/settings" className="snav__mi">Account settings</a>
                  {MOD.includes(me.role) && <a href="/forum/reports" className="snav__mi">Reports</a>}
                  <button type="button" className="snav__mi snav__mi--btn" onClick={logout}>Log out</button>
                </div>
              )}
            </div>
          ) : (
            <div className="snav__auth">
              <a href="/login" className="snav__cta">Log in</a>
            </div>
          )}

          <button className="snav__burger" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <span /><span /><span />
          </button>
        </div>
      </div>

      {open && (
        <>
        <div className="snav__scrim" onClick={() => setOpen(false)} aria-hidden="true" />
        <div className="snav__drawer" role="dialog" aria-label="Menu">
          <button className="snav__dclose" onClick={() => setOpen(false)} aria-label="Close menu">✕</button>
          <a href="/" className="snav__dtop">Home</a>
          <a href="/model" className="snav__dtop">The Model</a>

          <details className="snav__pgroup">
            <summary className="snav__dtop snav__psum">The Context</summary>
            <a href="/context" className="snav__dsub">Upset Watch</a>
            <a href="/tailgate" className="snav__dsub">Fan Analysis</a>
            <a href="/best" className="snav__dsub">Sweet Spots</a>
          </details>

          <details className="snav__pgroup">
            <summary className="snav__dtop snav__psum">Shop Around</summary>
            <a href="/lines" className="snav__dsub">Game Lines</a>
            <a href="/props" className="snav__dsub">Player Props</a>
            <a href="/preseason" className="snav__dsub">Preseason</a>
          </details>

          <a href="/forum" className="snav__dtop">Community</a>
          <a href="/how" className="snav__dtop">How it works</a>

          <div className="snav__ddiv" />
          <details className="snav__pgroup">
            <summary className="snav__dtop snav__psum">User Options</summary>
            {me === undefined ? null : me ? (
              <>
                <a href={`/u/${me.username}`} className="snav__dusr">My profile</a>
                <a href="/settings" className="snav__dusr">Account settings</a>
                {MOD.includes(me.role) && <a href="/forum/reports" className="snav__dusr">Reports</a>}
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
