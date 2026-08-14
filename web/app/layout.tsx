import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "StatSeer — See the edge.",
  description: "NFL betting analysis: line shopping, sweet spots, honest predictions, and game context — from live odds.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
