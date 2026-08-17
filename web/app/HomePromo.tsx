"use client";

// Bottom-of-home membership dropdown, styled like a tavern invitation. Collapsed
// by default; the beer-pitcher toggle opens it to reveal the over-the-shoulder
// seer, the "there's more inside" pitch, and an auth-aware CTA (members aren't
// told to sign up — they get "explore the board").
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function HomePromo() {
  const [loggedIn, setLoggedIn] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      setLoggedIn(false);
      return;
    }
    createClient().auth.getUser().then(({ data }) => setLoggedIn(!!data.user));
  }, []);

  const member = loggedIn === true; // default (undefined) → show the sign-up CTA

  return (
    <details className="hb-tav">
      <summary className="hb-tav__bar">
        <span className="hb-tav__title">Let&apos;s talk numbers — join our community!</span>
        <span className="hb-tav__hint">pull up a stool — see what members get</span>
        <span className="hb-tav__right">
          <a href="/signup" className="hb-tav__join" onClick={(e) => e.stopPropagation()}>Become a member →</a>
          <span className="hb-tav__ic hb-tav__ic--shut" aria-hidden="true">🍺</span>
          <span className="hb-tav__ic hb-tav__ic--open" aria-hidden="true">🍻</span>
          <span className="hb-tav__chev" aria-hidden="true">▾</span>
        </span>
      </summary>
      <div className="hb-tav__body">
        <h2 className="hb-promo__h">There&apos;s a lot more where this came from.</h2>
        <p className="hb-promo__p">
          Line shopping across every book, player props, key-number sweet spots, the full model with
          its public track record, and a community of sharp members — it&apos;s all a free account away.
        </p>
        <div className="hb-promo__cta">
          {member ? (
            <>
              <a href="/lines" className="btn btn--primary">Explore the full board →</a>
              <a href="/forum" className="btn">Visit the Forums →</a>
            </>
          ) : (
            <>
              <a href="/signup" className="btn btn--primary">Become a member →</a>
              <a href="/forum" className="btn">Visit the Forums →</a>
            </>
          )}
        </div>
      </div>
    </details>
  );
}
