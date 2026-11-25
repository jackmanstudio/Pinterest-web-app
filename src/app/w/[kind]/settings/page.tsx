import { notFound } from "next/navigation";
import { Settings } from "@/components/Settings";
import { isWorkspaceKind } from "@/lib/types";

export default async function SettingsPage({ params }: PageProps<"/w/[kind]/settings">) {
  const { kind } = await params;
  if (!isWorkspaceKind(kind)) notFound();
  return <Settings key={kind} kind={kind} />;
}
