import Link from "next/link";
import type { ReactNode } from "react";

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="mx-auto max-w-2xl py-6 text-[15px] leading-relaxed text-zinc-800 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_p]:mt-3 [&_ul]:mt-3">
      <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        Starter text written for this app. Have it reviewed (and add your business name and contact address) before you launch publicly.
      </p>
      <h1 className="mt-6 text-3xl" style={{ fontFamily: '"Playfair Display", Georgia, serif' }}>{title}</h1>
      {children}
      <p className="mt-10 text-sm"><Link href="/signup" className="underline">Back to sign up</Link></p>
    </article>
  );
}
