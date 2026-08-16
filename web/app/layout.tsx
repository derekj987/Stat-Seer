import type { Metadata, Viewport } from "next";
import { MedievalSharp } from "next/font/google";
import "./globals.css";
import SiteNav from "./SiteNav";
import SlipBar from "./SlipBar";

// Medieval display face for the STATSEER wordmark, exposed as a CSS var so any
// masthead can use it (matches the tavern / seer tone).
const medieval = MedievalSharp({ subsets: ["latin"], weight: "400", display: "swap", variable: "--font-medieval" });

export const metadata: Metadata = {
  metadataBase: new URL("https://statseer.vercel.app"),
  title: "StatSeer — See the edge. Trust the data.",
  description: "NFL betting analysis you can actually check: line shopping, sweet spots, honest calibrated predictions, and game context — from live odds.",
  applicationName: "StatSeer",
  appleWebApp: { capable: true, title: "StatSeer", statusBarStyle: "default" },
  openGraph: {
    title: "StatSeer — See the edge. Trust the data.",
    description: "NFL betting analysis you can actually check — published probabilities, a public track record, and where the price is wrong.",
    siteName: "StatSeer",
    type: "website",
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: "#0c2b1c",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={medieval.variable}>
      <body>
        <SiteNav />
        {children}
        <SlipBar />
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
