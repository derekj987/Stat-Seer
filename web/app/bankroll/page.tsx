import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Brand } from "../Nav";
import BankrollView from "./BankrollView";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "StatSeer — Bankroll & CLV Tracker",
  description: "Track your bets, bankroll, ROI, and closing-line value — check your own edge, not just your record.",
};

export default async function BankrollPage() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user && process.env.NEXT_PUBLIC_SUPABASE_URL) redirect("/login");
  } catch { /* local dev without auth env */ }

  return (
    <main className="wrap">
      <header className="masthead">
        <Brand sub={<><span className="brand__sport">Your space</span> · Bankroll &amp; CLV</>} art={{ src: "/bag.png?v=1", alt: "Bankroll" }} />
      </header>

      <section className="explainer">
        <p>
          <b>Track your own edge.</b> Log every bet, settle it, and watch your bankroll, ROI, and — the metric that
          actually matters — <b>closing-line value</b>. It&apos;s private to you and lives on this device.
        </p>
      </section>

      <BankrollView />
    </main>
  );
}
