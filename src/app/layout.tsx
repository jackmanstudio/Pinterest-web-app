import type { Metadata } from "next";
import { Suspense } from "react";
import { Geist } from "next/font/google";
import { AppHeader } from "@/components/AppHeader";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Pinterest AI Studio",
  description: "Plan, draft and optimise Pinterest pins across Fashion and Macro workspaces.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-zinc-50 text-zinc-900">
        <Suspense fallback={<div className="h-24 border-b border-zinc-200 bg-white" />}>
          <AppHeader />
        </Suspense>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
