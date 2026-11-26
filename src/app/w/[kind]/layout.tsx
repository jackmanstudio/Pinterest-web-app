import { TodoBanner } from "@/components/TodoBanner";

/**
 * Cache Components needs one param to prerender the page shell. "account" is
 * only a placeholder for that shell, not a built-in account: every account's
 * data is loaded for the signed-in user in the browser, and other slugs render
 * on demand.
 */
export function generateStaticParams() {
  return [{ kind: "account" }];
}

export default function WorkspaceLayout({ children }: LayoutProps<"/w/[kind]">) {
  return (
    <>
      <TodoBanner />
      {children}
    </>
  );
}
