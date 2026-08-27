// Client-side Web Push: register the service worker, subscribe the device, and store the
// subscription in Supabase so the server can push to it. The VAPID PUBLIC key is not a
// secret (it's an application-server identity), so it's fine to ship in the client; only the
// matching private key stays server-side (VAPID_PRIVATE_KEY).
import { createClient } from "@/lib/supabase/client";

export const VAPID_PUBLIC = "BNNQhSM5sK5WSfH_IewCQKaNVruTxpa_yMTz56TMGEbNeLV-1NGrd0vmZvMUEqb0j7HEuMuj8LYs3hN1bx5w4-s";

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// Register the SW + subscribe this device to push, and persist the subscription. Returns
// true if the device is now subscribed. Safe to call repeatedly (upsert on endpoint).
export async function enablePush(userId: string): Promise<boolean> {
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || typeof Notification === "undefined") return false;
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return false;
    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
      });
    }
    const j = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    if (!j.endpoint || !j.keys?.p256dh || !j.keys?.auth) return false;
    await createClient().from("push_subscriptions").upsert(
      { user_id: userId, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth },
      { onConflict: "endpoint" }
    );
    return true;
  } catch {
    return false;
  }
}
