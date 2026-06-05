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
  // Next.js App Router auto-detects favicon.ico, icon.png, apple-icon.png
  // from src/app — these only need to be declared explicitly so the
  // legacy PNG sizes + the webmanifest get linked too.
  icons: {
    icon: [
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  },
  manifest: "/site.webmanifest",
};

/**
 * Inline theme bootstrap — runs before paint so the chosen theme
 * is applied to <html> with no flash of the wrong one.
 * Honours localStorage first, then prefers-color-scheme.
 */
const themeBoot = `
(function(){
  try {
    var stored = localStorage.getItem('x402pulse:theme');
    var prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    var useLight = stored === 'light' || (!stored && prefersLight);
    if (useLight) document.documentElement.classList.add('light');
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
      </head>
      <body className="min-h-screen bg-bg text-white antialiased">{children}</body>
    </html>
  );
}
