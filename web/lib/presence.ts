// How fresh profiles.last_seen must be for a member to count as "online".
//
// Lives in its own module (like ./reactions) so CLIENT components can import it without pulling in
// lib/profile.ts, which is server-side and uses the service key.
//
// The heartbeat is app/Presence.tsx: while a signed-in member has a visible tab it stamps
// profiles.last_seen roughly once a minute. The window has to be comfortably longer than that
// interval or a member flickers offline between beats.
//
// One definition, because there were nearly two: the chat widget's friend bubbles hard-coded the
// green "online" ring on every friend, so it reported the entire roster as online at all times.
// Anything showing presence reads THIS constant against last_seen — never assumes.
export const ONLINE_MS = 3 * 60 * 1000;

/** Is this last_seen timestamp fresh enough to count as online? */
export function isOnline(lastSeen: string | null | undefined, now = Date.now()): boolean {
  if (!lastSeen) return false;
  const t = new Date(lastSeen).getTime();
  return Number.isFinite(t) && now - t < ONLINE_MS;
}
