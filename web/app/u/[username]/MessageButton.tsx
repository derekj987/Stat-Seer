"use client";

// Opens the chat with this member. Dispatches a global event the Dock (chat) listens for,
// so it opens the panel and jumps straight into the conversation.
export default function MessageButton({ userId, username }: { userId: string; username: string }) {
  return (
    <button
      className="phead2__msg"
      onClick={() => window.dispatchEvent(new CustomEvent("ss:open-chat", { detail: { userId, username } }))}
    >
      💬 Message
    </button>
  );
}
