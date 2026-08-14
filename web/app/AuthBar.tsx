"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Me = { username: string } | null;

export default function AuthBar() {
  const [me, setMe] = useState<Me | undefined>(undefined); // undefined = still loading

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      setMe(null); return; // auth not configured yet
    }
    const supabase = createClient();
    let active = true;
    const load = async () => {
      const { data } = await supabase.auth.getUser();
      if (!active) return;
      const u = data.user;
      setMe(u ? { username: (u.user_metadata?.username as string) ?? u.email ?? "member" } : null);
    };
    load();
    const { data: sub } = supabase.auth.onAuthStateChange(() => load());
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, []);

  async function logout() {
    await createClient().auth.signOut();
    location.href = "/";
  }

  return (
    <div className="authbar">
      <div className="authbar__inner">
        <a href="/forum" className="authbar__forum">🗣 Forum</a>
        {me === undefined ? (
          <span className="authbar__me" />
        ) : me ? (
          <span className="authbar__me">
            <a href="/forum" className="authbar__user">{me.username}</a>
            <button onClick={logout} className="authbar__btn">Log out</button>
          </span>
        ) : (
          <span className="authbar__me">
            <a href="/login" className="authbar__link">Log in</a>
            <a href="/signup" className="authbar__btn authbar__btn--primary">Sign up</a>
          </span>
        )}
      </div>
    </div>
  );
}
