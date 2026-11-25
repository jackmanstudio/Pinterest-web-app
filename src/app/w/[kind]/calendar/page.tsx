import { notFound } from "next/navigation";
import { Calendar } from "@/components/Calendar";
import { isWorkspaceKind } from "@/lib/types";

export default async function CalendarPage({ params }: PageProps<"/w/[kind]/calendar">) {
  const { kind } = await params;
  if (!isWorkspaceKind(kind)) notFound();
  return <Calendar key={kind} kind={kind} />;
}
