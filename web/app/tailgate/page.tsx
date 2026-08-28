import { redirect } from "next/navigation";

// The "Local Intelligence" (Fan Stock) page moved to a URL that matches its label.
// Keep the old /tailgate address working for any existing links.
export default function Page() {
  redirect("/local-intelligence");
}
