import type { Metadata, Viewport } from "next";
import { DM_Sans } from "next/font/google";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://sf-tech-week.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "SF Tech Week 2026 — Event Directory",
  description:
    "Every SF Tech Week event (Oct 5-11, 2026) with real filters, live Partiful guest counts, and a chatbot that tells you where to go.",
  openGraph: {
    title: "SF Tech Week 2026 — Event Directory",
    description:
      "1,600+ events. Real filters. Live guest counts. Find your SF Tech Week lineup in seconds.",
    type: "website",
    url: SITE_URL,
  },
  twitter: {
    card: "summary_large_image",
    title: "SF Tech Week 2026 — Event Directory",
    description: "1,600+ events. Real filters. Live guest counts.",
    creator: "@anamika__x",
  },
};

export const viewport: Viewport = {
  themeColor: "#E9E2D3",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${dmSans.variable} font-sans`}>
        <NuqsAdapter>{children}</NuqsAdapter>
      </body>
    </html>
  );
}
