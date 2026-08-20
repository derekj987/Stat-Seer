import { redirect } from "next/navigation";

// Value Finder split into Game Lines / Player Props / Sweet Spots (mirroring the NFL
// side). The old consolidated /ncaaf/value now lands on Game Lines.
export default function Page() {
  redirect("/ncaaf/lines");
}
