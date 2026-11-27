import { notFound } from "next/navigation";
import { StartPage } from "@/components/StartPage";
import { START_PAGES } from "@/lib/startPages";

export function generateStaticParams() {
  return Object.keys(START_PAGES).map((section) => ({ section }));
}

export default async function StartSectionPage({ params }: PageProps<"/start/[section]">) {
  const { section } = await params;
  if (!START_PAGES[section]) notFound();
  return <StartPage section={section} />;
}
