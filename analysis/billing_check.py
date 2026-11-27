"""
Is billing actually wired up? Run this after configuring Stripe, before the first real dollar.

    python analysis/billing_check.py            # check whatever this environment is pointed at
    python analysis/billing_check.py --live     # also demand LIVE mode (refuse to pass on test keys)

Every line it prints is something that has to be true for a member to be able to subscribe, be
granted access, and cancel. It is written because each of those depends on a setting in a
different place -- the Stripe dashboard, Vercel's environment, Supabase, and the deployed site --
and a mistake in any one of them fails in a way that looks like a mistake in another. A member
who cannot cancel looks identical to a member who cannot subscribe: both are "the button does
nothing".

🚨 THE SECRET KEY IS NEVER PRINTED. It is read from the environment, used as a bearer, and
reported only as "test" or "live". If you are pasting output from this script to someone, that is
the property that makes it safe to do.

WHAT IT CANNOT TELL YOU: whether a real card is charged correctly. Put a test card through the
whole flow -- subscribe, see access open, cancel in the portal, see the row update -- because the
only end-to-end proof is an end-to-end run. This script checks the wiring, not the electricity.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import odds_client as oc   # noqa: E402

STRIPE = "https://api.stripe.com/v1"
NEEDED_EVENTS = {
    "checkout.session.completed",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
}

ok_n, fail_n, warn_n = 0, 0, 0


def ok(msg):
    global ok_n
    ok_n += 1
    print(f"  [ok]   {msg}")


def fail(msg, fix=""):
    global fail_n
    fail_n += 1
    print(f"  [FAIL] {msg}")
    if fix:
        print(f"         -> {fix}")


def warn(msg):
    global warn_n
    warn_n += 1
    print(f"  [warn] {msg}")


def env(name):
    """Environment first, then .env — the same resolution the scripts use."""
    v = os.environ.get(name)
    if v:
        return v
    try:
        return oc.load_env().get(name)
    except Exception:  # noqa: BLE001
        return None


def stripe_get(path, key, params=None):
    url = f"{STRIPE}/{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def check_env(args):
    print("\n## 1. Environment")
    key = env("STRIPE_SECRET_KEY")
    if not key:
        fail("STRIPE_SECRET_KEY is not set",
             "until this exists the paywall is OFF and nobody is gated — that is the safe state")
        return None
    mode = "live" if key.startswith("sk_live_") else "test" if key.startswith("sk_test_") else "unknown"
    if mode == "unknown":
        fail("STRIPE_SECRET_KEY does not look like a Stripe secret key")
        return None
    ok(f"STRIPE_SECRET_KEY present ({mode} mode)")
    if args.live and mode != "live":
        fail("--live was asked for but this is a TEST key",
             "test keys never charge anyone; point this at the production environment")

    for name, why in (("STRIPE_WEBHOOK_SECRET", "the webhook refuses every event without it"),
                      ("STRIPE_PRICE_MONTHLY", "there is nothing to sell"),
                      ("NEXT_PUBLIC_SITE_URL", "Stripe would send members back to the wrong host")):
        if env(name):
            ok(f"{name} present")
        else:
            fail(f"{name} is not set", why)
    if env("STRIPE_PRICE_ANNUAL"):
        ok("STRIPE_PRICE_ANNUAL present (annual plan will be offered)")
    else:
        warn("STRIPE_PRICE_ANNUAL not set — only the monthly plan will be offered (fine, if intended)")
    return key


def check_account(key):
    print("\n## 2. Stripe account")
    try:
        acct = stripe_get("account", key)
    except urllib.error.HTTPError as e:
        fail(f"could not read the Stripe account (HTTP {e.code})", "is the key correct and not revoked?")
        return
    ok(f"key works — account {acct.get('id')} ({acct.get('business_profile', {}).get('name') or 'no business name set'})")
    # charges_enabled is the one that decides whether a member can actually pay today.
    if acct.get("charges_enabled"):
        ok("charges enabled")
    else:
        fail("charges are NOT enabled on this account",
             "finish Stripe onboarding — business details, bank account, identity verification")
    if acct.get("payouts_enabled"):
        ok("payouts enabled")
    else:
        warn("payouts not enabled — you can take money but Stripe cannot pay it out yet")


def check_prices(key):
    print("\n## 3. Prices")
    for name, label in (("STRIPE_PRICE_MONTHLY", "monthly"), ("STRIPE_PRICE_ANNUAL", "annual")):
        pid = env(name)
        if not pid:
            continue
        try:
            p = stripe_get(f"prices/{urllib.parse.quote(pid)}", key)
        except urllib.error.HTTPError:
            fail(f"{label} price {pid} not found on this account",
                 "a price id from a DIFFERENT Stripe account (or the other mode) will do this")
            continue
        if not p.get("active"):
            fail(f"{label} price is archived", "pick an active price")
        rec = p.get("recurring")
        if not rec:
            fail(f"{label} price is one-off, not recurring",
                 "checkout runs in subscription mode and will reject it")
            continue
        amount = p.get("unit_amount")
        money = f"{(amount or 0) / 100:.2f} {str(p.get('currency', '')).upper()}"
        interval = f"{rec.get('interval_count', 1)} {rec.get('interval')}"
        ok(f"{label}: {money} every {interval}")
        # The commonest mix-up is pasting the same id into both variables.
        if name == "STRIPE_PRICE_ANNUAL" and rec.get("interval") != "year":
            fail("the ANNUAL price does not renew yearly", "check the two price ids are not swapped")
        if name == "STRIPE_PRICE_MONTHLY" and rec.get("interval") != "month":
            fail("the MONTHLY price does not renew monthly", "check the two price ids are not swapped")


def check_webhook(key):
    print("\n## 4. Webhook")
    site = (env("NEXT_PUBLIC_SITE_URL") or "").rstrip("/")
    want = f"{site}/api/billing/webhook" if site else None
    try:
        eps = stripe_get("webhook_endpoints", key, {"limit": 100}).get("data", [])
    except urllib.error.HTTPError as e:
        fail(f"could not list webhook endpoints (HTTP {e.code})")
        return
    if not eps:
        fail("no webhook endpoint is configured",
             f"add one for {want or '<site>/api/billing/webhook'} — without it NOTHING updates the "
             "subscriptions table, so a member pays and never gets access")
        return
    mine = [e for e in eps if e.get("url", "").rstrip("/") == (want or "").rstrip("/")] if want else []
    if not mine:
        fail(f"no endpoint points at {want}",
             "endpoints found: " + ", ".join(e.get("url", "?") for e in eps[:4]))
        return
    e = mine[0]
    if e.get("status") == "enabled":
        ok(f"endpoint {want} is enabled")
    else:
        fail(f"endpoint {want} is {e.get('status')}", "enable it")
    subscribed = set(e.get("enabled_events") or [])
    if "*" in subscribed:
        ok("subscribed to all events")
        return
    missing = NEEDED_EVENTS - subscribed
    if missing:
        fail("endpoint is missing required events: " + ", ".join(sorted(missing)),
             "a missing subscription.* event means cancellations never reach us")
    else:
        ok("subscribed to all four required events")


def check_portal(key):
    print("\n## 5. Billing portal (the cancellation promise)")
    try:
        cfgs = stripe_get("billing_portal/configurations", key, {"limit": 10}).get("data", [])
    except urllib.error.HTTPError as e:
        fail(f"could not read portal configurations (HTTP {e.code})")
        return
    active = [c for c in cfgs if c.get("active")] or cfgs
    if not active:
        fail("no billing portal configuration exists",
             "Settings -> Billing -> Customer portal. /terms promises self-serve cancellation and "
             "the Manage button will error without it")
        return
    c = active[0]
    feats = c.get("features", {})
    if (feats.get("subscription_cancel") or {}).get("enabled"):
        ok("portal allows members to CANCEL")
    else:
        fail("the portal does NOT allow cancellation",
             "turn on 'Cancel subscription' — Terms section 4 promises it, and several states "
             "require cancelling to be as easy as subscribing")
    if (feats.get("payment_method_update") or {}).get("enabled"):
        ok("portal allows updating the card")
    else:
        warn("portal does not allow updating the card — a failed payment becomes unfixable")
    if (feats.get("invoice_history") or {}).get("enabled"):
        ok("portal shows invoice history")
    else:
        warn("portal does not show invoice history")


def check_supabase():
    print("\n## 6. Supabase")
    try:
        e = oc.load_env()
        url, key = e["SUPABASE_URL"].rstrip("/"), e["SUPABASE_SERVICE_KEY"]
    except Exception:  # noqa: BLE001
        warn("no Supabase credentials in this environment — skipping")
        return
    h = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}

    def call(path, method="GET", body=None, extra=None):
        hh = dict(h)
        if extra:
            hh.update(extra)
        r = urllib.request.Request(f"{url}/rest/v1/{path}", method=method, headers=hh,
                                   data=json.dumps(body).encode() if body is not None else None)
        try:
            with urllib.request.urlopen(r, timeout=30) as resp:
                return resp.getcode(), resp.read().decode()
        except urllib.error.HTTPError as ex:
            return ex.code, ex.read().decode()

    code, _ = call("subscriptions?select=user_id&limit=1")
    if code == 200:
        ok("subscriptions table is readable")
    else:
        fail(f"subscriptions table not readable (HTTP {code})", "run ingest/subscriptions.sql")
        return
    # Empty payload exercises the INSERT permission without writing a row.
    code, body = call("subscriptions?on_conflict=user_id", "POST", [],
                      {"Prefer": "resolution=merge-duplicates,return=minimal"})
    if code in (200, 201, 204):
        ok("the webhook can write to subscriptions")
    else:
        fail(f"service role cannot INSERT into subscriptions (HTTP {code})",
             "grant select, insert, update on subscriptions to service_role")
    code, body = call("rpc/is_subscribed", "POST", {"uid": "00000000-0000-0000-0000-000000000000"})
    if code == 200 and body.strip() == "false":
        ok("is_subscribed() exists and denies an unknown user")
    elif code == 200:
        fail(f"is_subscribed() returned {body.strip()} for an unknown user — it should be false")
    else:
        fail(f"is_subscribed() missing (HTTP {code})", "run ingest/subscriptions.sql")


def check_site():
    print("\n## 7. The deployed site")
    site = (env("NEXT_PUBLIC_SITE_URL") or "https://statseeredge.com").rstrip("/")
    try:
        req = urllib.request.Request(f"{site}/api/billing/checkout", method="POST",
                                     data=b'{"plan":"monthly"}',
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as r:
            code = r.getcode()
    except urllib.error.HTTPError as e:
        code = e.code
    except Exception as ex:  # noqa: BLE001
        warn(f"could not reach {site} ({ex})")
        return
    # 503 = the DEPLOYED site has no Stripe key, whatever this laptop has. 401 = key present,
    # route reached, correctly refusing an anonymous caller. Those two tell you whether the
    # paywall is live in PRODUCTION, which is the only place it matters.
    if code == 503:
        warn("the deployed site reports 'billing not configured' — the paywall is OFF there. "
             "Set the env vars in Vercel and redeploy; nobody is gated until you do")
    elif code == 401:
        ok("the deployed site has billing configured (route refuses anonymous callers)")
    else:
        warn(f"/api/billing/checkout answered {code} — expected 401 (configured) or 503 (not)")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--live", action="store_true", help="require LIVE keys, not test")
    args = ap.parse_args(argv)

    print("Billing readiness check")
    key = check_env(args)
    if key:
        check_account(key)
        check_prices(key)
        check_webhook(key)
        check_portal(key)
    check_supabase()
    check_site()

    print(f"\n{ok_n} ok, {warn_n} warning(s), {fail_n} failure(s)")
    if fail_n:
        print("NOT READY — fix the failures above before taking a payment.")
        return 1
    print("Wiring looks right. Now run a TEST CARD through the whole flow: subscribe, confirm "
          "access opens, cancel in the portal, confirm the subscriptions row updates. This script "
          "checks the wiring, not the electricity.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
