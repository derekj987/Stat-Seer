import { redirect } from "next/navigation";

// The College Football homepage folded into the landing hub — /ncaaf now opens the
// landing with NCAAF selected. (Section pages /ncaaf/model, /ncaaf/context, … are unchanged.)
export default function NcaafHome() {
  redirect("/?sport=ncaaf");
}
