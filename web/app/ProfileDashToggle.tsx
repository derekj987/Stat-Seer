// Green segmented toggle to switch between a member's Profile and their Custom Dashboard —
// the same shape as the sport toggle. Plain links, so it works without client JS.
export default function ProfileDashToggle({ active, username }: {
  active: "profile" | "dashboard"; username: string;
}) {
  return (
    <div className="pdtoggle" role="tablist" aria-label="Profile or Dashboard">
      <a href={`/u/${username}`} className={`pdtoggle__t${active === "profile" ? " active" : ""}`}
        role="tab" aria-selected={active === "profile"}>Profile</a>
      <a href="/dashboard" className={`pdtoggle__t${active === "dashboard" ? " active" : ""}`}
        role="tab" aria-selected={active === "dashboard"}>My Dashboard</a>
    </div>
  );
}
