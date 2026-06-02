import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "x402pulse — The pulse of the agent economy",
  description:
    "Real-time analytics for x402 agent payments on Base. Track volume, agents, sellers, and live transfers.",
  metadataBase: new URL("https://x402pulse.app"),
  openGraph: {
    title: "x402pulse",
    description: "The pulse of the agent economy.",
    url: "https://x402pulse.app",
    siteName: "x402pulse",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "x402pulse",
    description: "Real-time x402 analytics on Base.",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-screen bg-bg text-white antialiased">{children}</body>
    </html>
  );
}
