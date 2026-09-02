import type { NextConfig } from "next";

// Security headers (OWASP ASVS V14). Applied to every route.
//
// NOTE ON FRAMING: the member dashboard embeds StatSeer's own pages in iframes
// (DashboardView.tsx -> `${href}?embed=1`), so framing must be SAMEORIGIN / 'self' —
// DENY / frame-ancestors 'none' would break the live-embed feature.
//
// NOTE ON CSP: shipped as Report-Only first. Next.js injects inline hydration scripts and the app has
// its own inline script in layout.tsx, so an enforcing script-src would break the site until those are
// nonce'd. Report-Only never blocks — it only logs violations to the browser console, so we can see
// what a real policy would break before switching the header name to Content-Security-Policy.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",           // TODO: replace 'unsafe-inline' with per-request nonces
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",           // Supabase storage, Tenor gifs, team logos
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "frame-src 'self'",
  "frame-ancestors 'self'",                      // self-embedding dashboard — see note above
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Content-Security-Policy-Report-Only", value: csp },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,   // stop advertising X-Powered-By: Next.js
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
