import type { Metadata } from "next";
import "./globals.css";
import AuthBar from "./AuthBar";

export const metadata: Metadata = {
  metadataBase: new URL("https://statseer.vercel.app"),
  title: "StatSeer — See the edge. Trust the data.",
  description: "NFL betting analysis you can actually check: line shopping, sweet spots, honest calibrated predictions, and game context — from live odds.",
  openGraph: {
    title: "StatSeer — See the edge. Trust the data.",
    description: "NFL betting analysis you can actually check — published probabilities, a public track record, and where the price is wrong.",
    siteName: "StatSeer",
    type: "website",
  },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        <AuthBar />
        {children}
        <footer className="sitefoot">
          <p>
            StatSeer is statistical analysis, <b>not betting or financial advice</b>. For adults of legal
            age only (21+). Please gamble responsibly — if it stops being fun, help is available:
            call <b>1-800-GAMBLER</b>.
          </p>
        </footer>
      </body>
    </html>
  );
}
