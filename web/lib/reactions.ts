// Client-safe shared constant: the fixed emoji palette for wall-post reactions.
// Kept in its own module (no server imports) so client components can import the value
// without pulling server-only data-access code into the browser bundle.
// Must stay in sync with the CHECK constraint in ingest/wall_social.sql.
export const REACTION_EMOJI = ["👍", "🔥", "💰", "😂", "😮", "💯"] as const;
