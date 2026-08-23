import { Brand } from "../Nav";

export const metadata = {
  title: "Terms of Service — StatSeer",
  description: "The terms that govern your use of StatSeer.",
};

const UPDATED = "August 23, 2026";

export default function Terms() {
  return (
    <main className="wrap">
      <header className="masthead"><Brand sub={<><span className="brand__sport">Terms</span> of Service</>} /></header>

      <article className="legal">
        <p className="legal__meta">Last updated: {UPDATED}</p>

        <p className="legal__lead">
          Welcome to StatSeer. These Terms of Service (&ldquo;Terms&rdquo;) are a legal agreement between you and
          StatSeer (&ldquo;StatSeer,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;) governing your access to and use of our
          website and services (the &ldquo;Service&rdquo;). By creating an account or using the Service, you agree to
          these Terms and to our <a href="/privacy">Privacy Policy</a>. If you do not agree, do not use the Service.
        </p>

        <section className="legal__sec">
          <h2>1. Eligibility &amp; age</h2>
          <p>
            You must be at least <b>18 years old</b> (or the minimum age required for online gambling activity in your
            jurisdiction, whichever is higher) to use the Service. By using StatSeer you represent that you meet this
            requirement and that your use is legal where you live. Sports-betting laws vary by state and country and are
            your responsibility to know and follow.
          </p>
        </section>

        <section className="legal__sec">
          <h2>2. What StatSeer is — and is not</h2>
          <p>
            StatSeer provides <b>statistical analysis and informational content</b> about sporting events, betting
            markets, and prices. It is offered for <b>informational and entertainment purposes only</b>.
          </p>
          <ul>
            <li><b>Not betting or financial advice.</b> Nothing on StatSeer is a recommendation, solicitation, or advice to place any wager or make any financial decision. Our analysis is not a prediction of any outcome.</li>
            <li><b>No guaranteed outcomes.</b> Sports are uncertain. Past performance and published probabilities do not guarantee future results. You can lose money betting.</li>
            <li><b>Not a sportsbook.</b> StatSeer does not accept, place, facilitate, or process any bets, wagers, or payments to or from any gambling operator. We do not hold funds.</li>
          </ul>
          <p>
            Any decision you make — including any wager — is <b>solely your own</b>, made at your own risk. We are not
            responsible for your betting activity or its results.
          </p>
        </section>

        <section className="legal__sec">
          <h2>3. Your account</h2>
          <p>
            You are responsible for the accuracy of the information you provide, for keeping your password secure, and
            for all activity under your account. Notify us promptly of any unauthorized use. You may delete your account
            at any time from your account settings, which removes your profile and associated content.
          </p>
        </section>

        <section className="legal__sec">
          <h2>4. Acceptable use</h2>
          <p>You agree not to:</p>
          <ul>
            <li>Use the Service for any unlawful purpose or in violation of any applicable gambling, advertising, or other law;</li>
            <li>Scrape, harvest, resell, or systematically extract our data, analysis, or content;</li>
            <li>Attempt to gain unauthorized access to the Service, other accounts, or our systems;</li>
            <li>Post content that is unlawful, harassing, hateful, defamatory, infringing, or spam; or</li>
            <li>Interfere with or disrupt the Service or misrepresent your identity.</li>
          </ul>
          <p>We may suspend or terminate accounts that violate these Terms, at our discretion.</p>
        </section>

        <section className="legal__sec">
          <h2>5. Community content</h2>
          <p>
            You retain ownership of what you post in our community areas, but you grant StatSeer a non-exclusive,
            worldwide, royalty-free license to host, display, and distribute that content in connection with operating
            the Service. You are responsible for what you post, and you represent that you have the right to post it. We
            may remove content or moderate the community at our discretion.
          </p>
        </section>

        <section className="legal__sec">
          <h2>6. Intellectual property</h2>
          <p>
            The StatSeer name, logo, models, analysis, code, design, and content are owned by StatSeer and protected by
            intellectual-property laws. We grant you a limited, personal, non-transferable license to use the Service for
            your own non-commercial use. You may not copy, modify, or create derivative works from our content except as
            expressly permitted.
          </p>
        </section>

        <section className="legal__sec">
          <h2>7. Responsible gambling</h2>
          <p>
            If you choose to gamble, do so responsibly and only with money you can afford to lose. Gambling can be
            addictive. If it stops being fun, or you feel you may have a problem, help is available 24/7 — call or text
            <b> 1-800-GAMBLER</b>, or visit <b>ncpgambling.org</b>. You are responsible for setting your own limits.
          </p>
        </section>

        <section className="legal__sec">
          <h2>8. Disclaimers</h2>
          <p>
            The Service is provided <b>&ldquo;as is&rdquo; and &ldquo;as available,&rdquo;</b> without warranties of any
            kind, express or implied, including accuracy, reliability, fitness for a particular purpose, or
            non-infringement. We do not warrant that the analysis, odds, or data are accurate, complete, current, or
            error-free, or that the Service will be uninterrupted.
          </p>
        </section>

        <section className="legal__sec">
          <h2>9. Limitation of liability</h2>
          <p>
            To the fullest extent permitted by law, StatSeer and its owners will not be liable for any indirect,
            incidental, special, consequential, or punitive damages, or for any <b>gambling losses</b> or lost profits,
            arising out of or related to your use of the Service — even if advised of the possibility. Our total
            liability for any claim relating to the Service will not exceed the greater of the amount you paid us in the
            twelve months before the claim, or US $100.
          </p>
        </section>

        <section className="legal__sec">
          <h2>10. Indemnification</h2>
          <p>
            You agree to indemnify and hold StatSeer harmless from any claims, losses, or expenses (including reasonable
            legal fees) arising from your use of the Service, your content, or your violation of these Terms or any law.
          </p>
        </section>

        <section className="legal__sec">
          <h2>11. Changes</h2>
          <p>
            We may update these Terms from time to time. Material changes will be reflected by the &ldquo;last
            updated&rdquo; date above; continued use after changes means you accept them.
          </p>
        </section>

        <section className="legal__sec">
          <h2>12. Governing law &amp; contact</h2>
          <p>
            These Terms are governed by the laws of the State of Indiana, without regard to conflict-of-laws rules.
            Questions? Reach us through the <b>&ldquo;Message Us&rdquo;</b> widget on the site.
          </p>
        </section>

        <p className="legal__foot">
          StatSeer is statistical analysis, <b>not betting or financial advice</b>. For adults of legal age only (18+).
          Please gamble responsibly. See our <a href="/privacy">Privacy Policy</a>.
        </p>
      </article>
    </main>
  );
}
