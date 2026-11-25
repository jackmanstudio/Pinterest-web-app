import { notFound } from "next/navigation";
import { BoardAutomation } from "@/components/BoardAutomation";
import { isWorkspaceKind } from "@/lib/types";

export default async function BoardsPage({ params }: PageProps<"/w/[kind]/boards">) {
  const { kind } = await params;
  if (!isWorkspaceKind(kind)) notFound();
  return <BoardAutomation key={kind} kind={kind} />;
}
