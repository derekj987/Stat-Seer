import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Value Finder · StatSeer",
  description: "NFL line shopping, sweet spots, and a fair-price check — from live odds.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
