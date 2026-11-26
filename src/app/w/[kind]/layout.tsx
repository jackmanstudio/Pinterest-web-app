import { DEFAULT_WORKSPACES } from "@/lib/types";
import { TodoBanner } from "@/components/TodoBanner";

export function generateStaticParams() {
  // The two starter accounts are prebuilt; any other account slug renders on demand.
  return DEFAULT_WORKSPACES.map(({ kind }) => ({ kind }));
}

export default function WorkspaceLayout({ children }: LayoutProps<"/w/[kind]">) {
  return (
    <>
      <TodoBanner />
      {children}
    </>
  );
}
