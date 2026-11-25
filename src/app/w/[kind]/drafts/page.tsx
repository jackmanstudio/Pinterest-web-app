import { notFound } from "next/navigation";
import { SavedDrafts } from "@/components/SavedDrafts";
import { isWorkspaceKind } from "@/lib/types";

export default async function DraftsPage({ params }: PageProps<"/w/[kind]/drafts">) {
  const { kind } = await params;
  if (!isWorkspaceKind(kind)) notFound();
  return <SavedDrafts key={kind} kind={kind} />;
}
