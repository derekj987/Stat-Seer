import { NextResponse } from "next/server";
import webpush from "web-push";
import { createClient } from "@/lib/supabase/server";
import { VAPID_PUBLIC } from "@/lib/push";

// Deliver a Web Push to the OTHER members of a conversation when the sender posts a message,
// so notifications fire even when the app is fully closed. Triggered by the sender's client
// right after it inserts the message; the sender is authenticated via their session and must
// actually be a member of the conversation (verified server-side with the service key).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const SUBJECT = "mailto:derekj987@gmail.com";

type Sub = { id: string; endpoint: string; p256dh: string; auth: string };

async function pg(path: string, init?: RequestInit): Promise<Response> {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("supabase env");
  return fetch(`${url.replace(/\/$/, "")}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
}

export async function POST(request: Request) {
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!priv) return NextResponse.json({ ok: false, error: "push not configured" }, { status: 200 });

  // Authenticate the sender.
  let senderId: string | null = null;
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    senderId = data.user?.id ?? null;
  } catch { /* not configured */ }
  if (!senderId) return NextResponse.json({ ok: false }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const conversationId = String(body?.conversationId ?? "");
  const title = String(body?.title ?? "New message").slice(0, 80);
  const preview = String(body?.body ?? "").slice(0, 140);
  // Must be UUID-shaped: this path runs with the SERVICE KEY, so an unvalidated value could inject
  // extra PostgREST params and corrupt the membership check this route authorizes on.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(conversationId)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const cid = encodeURIComponent(conversationId), sid = encodeURIComponent(senderId);

  // The sender must be a member of the conversation.
  const meRes = await pg(`conversation_members?conversation_id=eq.${cid}&user_id=eq.${sid}&select=user_id`);
  if (!meRes.ok || !((await meRes.json()) as unknown[]).length) return NextResponse.json({ ok: false }, { status: 403 });

  // Everyone else in the conversation.
  const otherRes = await pg(`conversation_members?conversation_id=eq.${cid}&user_id=neq.${sid}&select=user_id`);
  const others = otherRes.ok ? ((await otherRes.json()) as { user_id: string }[]).map((r) => r.user_id) : [];
  if (!others.length) return NextResponse.json({ ok: true, sent: 0 });

  const list = others.map((id) => `"${id}"`).join(",");
  const subRes = await pg(`push_subscriptions?user_id=in.(${list})&select=id,endpoint,p256dh,auth`);
  const subs: Sub[] = subRes.ok ? await subRes.json() : [];
  if (!subs.length) return NextResponse.json({ ok: true, sent: 0 });

  webpush.setVapidDetails(SUBJECT, VAPID_PUBLIC, priv);
  const payload = JSON.stringify({ title, body: preview, tag: conversationId, url: "/" });

  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
      sent++;
    } catch (err) {
      // Prune dead subscriptions so we don't keep retrying them.
      const code = (err as { statusCode?: number })?.statusCode;
      if (code === 404 || code === 410) await pg(`push_subscriptions?id=eq.${s.id}`, { method: "DELETE" }).catch(() => {});
    }
  }));

  return NextResponse.json({ ok: true, sent });
}
