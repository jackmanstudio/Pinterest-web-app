import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Frame } from "@/components/Frame";
import { ErrorReporter } from "@/components/ErrorReporter";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], preload: false, display: "optional" });

export const metadata: Metadata = {
  title: "Pin AI Studio",
  description: "Pin AI Studio is an independent tool for planning and drafting pins. Not affiliated with Pinterest.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-[#0b0912] text-zinc-900">
        <ErrorReporter />
        <Frame>{children}</Frame>
      </body>
    </html>
  );
}
