import { redirect } from "next/navigation";

// The "Local Intelligence" (Fan Stock) page moved to a URL that matches its label.
// Keep the old /ncaaf/tailgate address working for any existing links.
export default function Page() {
  redirect("/ncaaf/local-intelligence");
}
