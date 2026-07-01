import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Hackathon Approval Agent",
  description: "Mobile-first Tinder-style approval queue for hackathons",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} grid-background antialiased`}
      >
        <header className="border-b border-border/60 bg-background/80 backdrop-blur-sm">
          <nav className="mx-auto flex max-w-lg items-center justify-between px-4 py-3">
            <Link href="/queue" className="text-sm font-semibold tracking-tight">
              Hackathon Radar
            </Link>
            <Link
              href="/settings"
              className="text-sm text-muted transition-colors hover:text-foreground"
            >
              Settings
            </Link>
          </nav>
        </header>
        <main className="mx-auto w-full max-w-lg px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
