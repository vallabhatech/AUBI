import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: {
    default: "AUBI Mission Control",
    template: "%s · AUBI",
  },
  description:
    "Autonomous Understanding & Behaviour Inference — context-aware AI coworkers for software engineering.",
  applicationName: "AUBI",
  keywords: ["AUBI", "AI coworkers", "software engineering", "GitHub", "LangGraph"],
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  themeColor: "#080808",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:border focus:border-[#39ff14] focus:bg-[#080808] focus:px-3 focus:py-2 focus:font-mono focus:text-[11px] focus:text-[#39ff14]"
        >
          Skip to main content
        </a>
        <Nav />
        <main id="main-content" className="min-h-[calc(100vh-64px)]">
          {children}
        </main>
      </body>
    </html>
  );
}
