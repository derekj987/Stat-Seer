import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Brand } from "../Nav";
import ProfileDashToggle from "../ProfileDashToggle";
import DashboardView from "./DashboardView";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "StatSeer — My Dashboard",
  description: "Your Custom Dashboard — the charts and data you care about, pinned in one place.",
};

export default async function DashboardPage() {
  let username = "";
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { if (process.env.NEXT_PUBLIC_SUPABASE_URL) redirect("/login"); }
    else {
      const { data: prof } = await supabase.from("profiles").select("username").eq("id", user.id).single();
      username = (prof?.username as string) ?? "";
    }
  } catch { /* local dev without auth env */ }

  return (
    <main className="wrap">
      <header className="masthead">
        <Brand sub={<><span className="brand__sport">Your space</span> · Custom Dashboard</>} />
      </header>

      {username && <div className="pdtogglerow"><ProfileDashToggle active="dashboard" username={username} /></div>}

      <section className="dash">
        <div className="dash__lead">
          <h2 className="dash__h">Your data, your way.</h2>
          <p className="dash__p">
            This is <b>your space</b>. Anywhere you see a <span className="dash__pinex">📌 Pin</span> button across
            StatSeer, add that chart or data view here — so your favorites are one tap away, no hunting.
          </p>
        </div>
        <DashboardView />
      </section>
    </main>
  );
}
