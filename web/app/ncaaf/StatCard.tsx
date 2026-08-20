// Shared stat card for the NCAAF section (Model / Context / Value Finder).
export function StatCard({ label, value, sub, tone }: {
  label: string; value: string; sub: string; tone?: "good" | "flat";
}) {
  return (
    <div className={`ncf-card${tone ? ` ncf-card--${tone}` : ""}`}>
      <span className="ncf-card__l">{label}</span>
      <span className="ncf-card__v">{value}</span>
      <span className="ncf-card__s">{sub}</span>
    </div>
  );
}
