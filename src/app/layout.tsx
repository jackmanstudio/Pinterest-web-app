import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { AppShell } from "@/components/AppShell";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], preload: false, display: "optional" });

export const metadata: Metadata = {
  title: "Pinterest AI Studio",
  description: "Plan, draft and optimise Pinterest pins across Fashion and Macro workspaces.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-[#0b0912] text-zinc-900">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
