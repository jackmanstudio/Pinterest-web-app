import { WORKSPACE_KINDS } from "@/lib/types";

export function generateStaticParams() {
  return WORKSPACE_KINDS.map((kind) => ({ kind }));
}

export default function WorkspaceLayout({ children }: LayoutProps<"/w/[kind]">) {
  return children;
}
