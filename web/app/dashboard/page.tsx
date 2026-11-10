import { redirect } from "next/navigation";

// The Custom Dashboard is retired. RETIRED BY REDIRECT, NOT BY DELETION — members pinned boards
// to it and the rails, the landing hub and the profile toggle all linked here, so a hard 404
// would break saved links and bookmarks that are out in the world. Same call the project made
// when /considerations and /context were retired onto their model boards.
//
// Pins lived in localStorage, never in the database, so nothing needs migrating and nothing is
// lost server-side; a member's old pins simply stop being read.
export default function Page() {
  redirect("/");
}
