import { notFound } from "next/navigation";
import { PublishBoard } from "@/components/PublishBoard";
import { isWorkspaceKind } from "@/lib/types";

export default async function PublishPage({ params }: PageProps<"/w/[kind]/publish">) {
  const { kind } = await params;
  if (!isWorkspaceKind(kind)) notFound();
  return <PublishBoard key={kind} kind={kind} />;
}
