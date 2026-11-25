import { WORKSPACE_KINDS } from "@/lib/types";
import { TodoBanner } from "@/components/TodoBanner";

export function generateStaticParams() {
  return WORKSPACE_KINDS.map((kind) => ({ kind }));
}

export default function WorkspaceLayout({ children }: LayoutProps<"/w/[kind]">) {
  return (
    <>
      <TodoBanner />
      {children}
    </>
  );
}
