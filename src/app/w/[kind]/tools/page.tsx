import { notFound } from "next/navigation";
import { Tools } from "@/components/Tools";
import { isWorkspaceKind } from "@/lib/types";

export default async function ToolsPage({ params }: PageProps<"/w/[kind]/tools">) {
  const { kind } = await params;
  if (!isWorkspaceKind(kind)) notFound();
  return <Tools key={kind} kind={kind} />;
}
