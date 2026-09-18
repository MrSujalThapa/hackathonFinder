import type { Metadata } from "next";
import { MockModeBanner } from "@/components/shell/MockModeBanner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hackathon Radar",
  description: "Editorial operations workspace for hackathon review",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="hf-sheet-grid antialiased">
        <MockModeBanner />
        {children}
      </body>
    </html>
  );
}
