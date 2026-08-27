import AssistantPanel from "../AssistantPanel";

export const metadata = { title: "StatSeer — Slip Assistant" };

export default function Assistant() {
  return (
    <main className="wrap asst">
      <h1 className="asst__h">Slip Assistant <span className="asst__beta">beta</span></h1>
      <p className="asst__sub">Short on time? Tell it what you want — or pick from the menu — and it assembles a slip from this week&apos;s real board. <b>Not betting advice</b>; you review and price everything in Value Finder.</p>
      <AssistantPanel />
    </main>
  );
}
