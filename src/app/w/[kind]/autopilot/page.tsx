import { notFound } from "next/navigation";
import { Autopilot } from "@/components/Autopilot";
import { isWorkspaceKind } from "@/lib/types";

export default async function AutopilotPage({ params }: PageProps<"/w/[kind]/autopilot">) {
  const { kind } = await params;
  if (!isWorkspaceKind(kind)) notFound();
  return <Autopilot key={kind} kind={kind} />;
}
