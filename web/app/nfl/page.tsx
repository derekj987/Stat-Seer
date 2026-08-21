import { redirect } from "next/navigation";

// The NFL homepage folded into the landing hub — /nfl now opens the landing with NFL
// selected. (Section pages /model, /context, /lines are unchanged.)
export default function NflHome() {
  redirect("/?sport=nfl");
}
