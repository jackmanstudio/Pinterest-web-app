import { notFound } from "next/navigation";
import { Usage } from "@/components/Usage";
import { isWorkspaceKind } from "@/lib/types";

export default async function UsagePage({ params }: PageProps<"/w/[kind]/usage">) {
  const { kind } = await params;
  if (!isWorkspaceKind(kind)) notFound();
  return <Usage key={kind} kind={kind} />;
}
