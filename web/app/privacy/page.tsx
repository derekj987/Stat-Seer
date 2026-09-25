import { Brand } from "../Nav";

export const metadata = {
  title: "Privacy Policy — StatSeer",
  description: "How StatSeer collects, uses, and protects your information.",
};

const UPDATED = "September 25, 2026";

export default function Privacy() {
  return (
    <main className="wrap">
      <header className="masthead"><Brand sub={<><span className="brand__sport">Privacy</span> Policy</>} /></header>

      <article className="legal">
        <p className="legal__meta">Last updated: {UPDATED}</p>

        <p className="legal__lead">
          This Privacy Policy explains what information StatSeer (&ldquo;we,&rdquo; &ldquo;us&rdquo;) collects, how we
          use it, and the choices you have. By using StatSeer you agree to this policy. It works alongside our{" "}
          <a href="/terms">Terms of Service</a>.
        </p>

        <section className="legal__sec">
          <h2>1. Information we collect</h2>
          <ul>
            <li><b>Account information</b> — the email address and username you provide when you sign up, and a securely hashed password (we never store your password in plain text).</li>
            <li><b>Content you create</b> — forum threads, replies, wall posts, profile details, and any feedback you send us.</li>
            <li><b>Technical &amp; usage data</b> — standard information your browser sends (such as IP address, device/browser type) and basic, aggregate usage data used to keep the site running and understand overall traffic. We use your IP address to rate-limit requests and to exclude our own visits from traffic counts.</li>
            <li><b>Questions you ask our assistant</b> — if you use the in-app assistant, the text you type is sent to our AI provider (Anthropic) to generate a reply. Do not put anything sensitive in it.</li>
            <li><b>Push notifications</b> — if you turn them on, your browser gives us a subscription token so we can send them. You can revoke it at any time in your browser or device settings.</li>
          </ul>
          <p>We do not knowingly collect payment-card details, government IDs, or other sensitive personal data.</p>
        </section>

        <section className="legal__sec">
          <h2>2. How we use it</h2>
          <ul>
            <li>To create and operate your account and the Service;</li>
            <li>To display your username and content in community areas;</li>
            <li>To respond to your feedback and support requests;</li>
            <li>To secure the Service, prevent abuse, and understand aggregate usage so we can improve; and</li>
            <li>To send account-related messages (such as email confirmation). We do not send marketing email without your consent.</li>
          </ul>
        </section>

        <section className="legal__sec">
          <h2>3. Cookies &amp; sessions</h2>
          <p>
            We use cookies and similar technology that are <b>strictly necessary</b> to keep you logged in and to keep
            the Service secure. We do not use third-party advertising or cross-site tracking cookies.
          </p>
        </section>

        <section className="legal__sec">
          <h2>4. How your information is shared</h2>
          <p>
            <b>We do not sell your personal information.</b> We share it only with the service providers that run the
            Service, and only so that it works:
          </p>
          <ul>
            <li><b>Vercel</b> — hosting. Receives the technical data your browser sends when you load a page.</li>
            <li><b>Supabase</b> — our database and sign-in system. Holds your account, profile and anything you post.</li>
            <li><b>Google</b> — only if you choose &ldquo;Sign in with Google&rdquo;, in which case Google handles that sign-in and tells us your email address.</li>
            <li><b>Resend</b> — email delivery. Receives your email address to send account and beta messages.</li>
            <li><b>Anthropic</b> — our AI provider, and only if you use the assistant. Receives the text of your question.</li>
          </ul>
          <p>
            We also share information when required by law or to protect our rights and users&rsquo; safety. Your public
            profile (username and anything you post publicly) is visible to others by design.
          </p>
        </section>

        <section className="legal__sec">
          <h2>5. Data retention &amp; deletion</h2>
          <p>
            We keep your information for as long as your account is active. You can <b>delete your account</b> at any
            time from your account settings; this removes your profile and cascades to your threads, replies, wall
            posts, and reports. Some records may persist briefly in backups or where retention is required by law.
          </p>
        </section>

        <section className="legal__sec">
          <h2>6. Security</h2>
          <p>
            We use industry-standard measures — encrypted connections, hashed passwords, and database access controls —
            to protect your information. No system is perfectly secure, but we work to keep your data safe and to limit
            what is exposed.
          </p>
        </section>

        <section className="legal__sec">
          <h2>7. Children</h2>
          <p>
            StatSeer is intended only for adults of legal age (21+). It is not directed to, and we do not knowingly
            collect information from, anyone under 18. If you believe a minor has provided us information, contact us and
            we will remove it.
          </p>
        </section>

        <section className="legal__sec">
          <h2>8. Your choices &amp; rights</h2>
          <p>
            You can review and update your profile, and delete your account, from your settings. Depending on where you
            live, you may have additional rights to access, correct, or delete your personal information — reach out and
            we will honor applicable requests.
          </p>
        </section>

        <section className="legal__sec">
          <h2>9. Changes &amp; contact</h2>
          <p>
            We may update this policy; material changes will be reflected by the &ldquo;last updated&rdquo; date above.
            Questions about your privacy? Reach us through the <b>&ldquo;Message Us&rdquo;</b> widget on the site.
          </p>
        </section>

        <p className="legal__foot">
          See also our <a href="/terms">Terms of Service</a>. StatSeer is for adults of legal age only (21+).
        </p>
      </article>
    </main>
  );
}
