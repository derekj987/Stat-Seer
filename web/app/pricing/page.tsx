import { Brand } from "../Nav";
import { billingConfigured, PRICE_ANNUAL } from "@/lib/billing";
import PricingButtons from "./PricingButtons";

export const metadata = {
  title: "Subscribe — StatSeer",
  description: "What a StatSeer subscription includes, what it costs, and how to cancel.",
};

export const dynamic = "force-dynamic";

// The page the paid gate sends an unsubscribed member to.
//
// 🚨 THE RECURRING TERMS ARE ON THIS PAGE, NEXT TO THE BUTTON. /terms section 4 is the long form;
// automatic-renewal law wants the short form where the money is spent — that it renews, how often,
// at what price, charged to that card, until cancelled, and that cancelling is self-serve. The
// block below is that disclosure. Do not move it into a tooltip, an accordion or a link: "clearly
// and conspicuous" is the standard, and a scroll the reader has to open is neither.
//
// The PRICE ITSELF is not written here. It lives on the Stripe price object and is shown on the
// Stripe checkout page before payment, so there is exactly one copy of it and this page cannot
// drift into advertising a number that is no longer charged.
export default function Pricing() {
  const live = billingConfigured();

  return (
    <main className="wrap">
      <header className="masthead"><Brand sub={<><span className="brand__sport">Sub</span>scribe</>} /></header>

      <article className="pricing">
        <p className="pricing__lead">
          A StatSeer subscription opens the whole site: the line-blind model and its graded record,
          the Value Finder&rsquo;s line shopping and fair-price tools, the player boards, and the community.
        </p>

        {live ? (
          <>
            <PricingButtons annual={Boolean(PRICE_ANNUAL)} />

            <section className="pricing__terms" aria-label="Subscription terms">
              <h2>Before you subscribe</h2>
              <ul>
                <li>
                  Your subscription <b>renews automatically</b> at the end of each billing period and your
                  card is charged the then-current price, <b>until you cancel</b>. The price and the billing
                  period are shown on the payment page before you pay.
                </li>
                <li>
                  <b>You can cancel any time, yourself,</b> from your account settings — no email, no phone call.
                  Cancelling takes effect at the end of the period you have already paid for, and you keep
                  access until then.
                </li>
                <li>
                  Payments are generally <b>non-refundable</b>, including for a period you did not use.
                  A subscription buys access to analysis and tools, <b>not an outcome</b> — a losing wager is
                  not grounds for a refund.
                </li>
                <li>
                  Your card is handled by Stripe. <b>We never see or store your full card number.</b>
                </li>
              </ul>
              <p className="pricing__fine">
                Full detail in the <a href="/terms">Terms of Service</a> and{" "}
                <a href="/privacy">Privacy Policy</a>. StatSeer is analysis and information, not betting
                advice, and it is not a sportsbook — we never take or hold a wager.
              </p>
            </section>
          </>
        ) : (
          // Billing not switched on yet. Say that plainly rather than rendering a button that 503s:
          // a dead pay button is the worst possible state for this particular page.
          <section className="pricing__terms">
            <h2>Subscriptions aren&rsquo;t open yet</h2>
            <p>
              Paid plans are not live on this site yet, so there is nothing to buy today and your access is
              unchanged. This page is where subscribing will happen when they open.
            </p>
          </section>
        )}
      </article>
    </main>
  );
}
