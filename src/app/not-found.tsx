import Link from "next/link";

export const metadata = { title: "Page not found · Pinterest AI Studio" };

export default function NotFound() {
  return (
    <div className="mx-auto mt-10 max-w-lg rounded-2xl bg-white/[0.06] p-6 text-white ring-1 ring-white/10">
      <p className="text-sm font-semibold text-[#ff9a7a]">404</p>
      <h1 className="mt-1 text-xl font-semibold">Page not found</h1>
      <p className="mt-2 text-sm text-white/70">This page doesn&apos;t exist. It may have moved, or the link has a typo.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href="/dashboard" className="rounded-xl bg-gradient-to-r from-[#e60023] to-[#ff7a45] px-4 py-2 text-sm font-bold text-white">Go to dashboard</Link>
        <Link href="/overview" className="rounded-xl px-4 py-2 text-sm text-white/80 ring-1 ring-white/20">All accounts</Link>
      </div>
    </div>
  );
}
