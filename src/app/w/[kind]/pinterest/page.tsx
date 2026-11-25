import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PinterestPanel } from "@/components/PinterestPanel";
import { isWorkspaceKind } from "@/lib/types";

export default async function PinterestPage({ params }: PageProps<"/w/[kind]/pinterest">) {
  const { kind } = await params;
  if (!isWorkspaceKind(kind)) notFound();
  return (
    <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
      <PinterestPanel key={kind} kind={kind} />
    </Suspense>
  );
}
