import { notFound } from "next/navigation";
import { Analytics } from "@/components/Analytics";
import { isWorkspaceKind } from "@/lib/types";

export default async function AnalyticsPage({ params }: PageProps<"/w/[kind]/analytics">) {
  const { kind } = await params;
  if (!isWorkspaceKind(kind)) notFound();
  return <Analytics key={kind} kind={kind} />;
}
