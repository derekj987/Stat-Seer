"use client";

// Top-of-home sign-up promo. Client-side so it only shows to logged-OUT visitors
// (members shouldn't be told to "create an account"). Hidden while auth is still
// resolving to avoid flashing it to signed-in users.
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function AccountPromo() {
  const [loggedIn, setLoggedIn] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      setLoggedIn(false);
      return;
    }
    createClient().auth.getUser().then(({ data }) => setLoggedIn(!!data.user));
  }, []);

  if (loggedIn === undefined || loggedIn) return null;

  return (
    <section className="acctpromo">
      <div className="acctpromo__text">
        <b className="acctpromo__h">Create a free account</b>
        <span className="acctpromo__sub">
          Save your slips, post in the community, and get your own member profile.
        </span>
      </div>
      <div className="acctpromo__cta">
        <a href="/signup" className="btn btn--primary">Sign up free →</a>
        <a href="/login" className="acctpromo__login">Log in</a>
      </div>
    </section>
  );
}
