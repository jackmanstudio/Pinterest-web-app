import { notFound } from "next/navigation";
import { Studio } from "@/components/Studio";
import { isWorkspaceKind } from "@/lib/types";

export default async function StudioPage({ params }: PageProps<"/w/[kind]">) {
  const { kind } = await params;
  if (!isWorkspaceKind(kind)) notFound();
  return <Studio key={kind} kind={kind} />;
}
