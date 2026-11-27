import Link from "next/link";

/** Shown when an account page can't load: a friendly "not found" for a wrong or deleted account, otherwise the error. */
export function WorkspaceError({ error }: { error: string }) {
  const missing = /unknown workspace|workspace not found|not found/i.test(error);
  return (
    <div role="alert" className="mx-auto mt-6 max-w-lg rounded-2xl bg-white/[0.06] p-6 text-white ring-1 ring-white/10">
      <h1 className="text-lg font-semibold">{missing ? "Account not found" : "This account couldn't load"}</h1>
      <p className="mt-2 text-sm text-white/70">
        {missing
          ? "This link points to an account that doesn't exist or was deleted. Pick one of your accounts instead."
          : `Something went wrong: ${error}. Try again; if it keeps happening, check Account → Error log.`}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href="/overview" className="rounded-xl bg-gradient-to-r from-[#e60023] to-[#ff7a45] px-4 py-2 text-sm font-bold text-white">All accounts</Link>
        {!missing && <a href="" className="rounded-xl px-4 py-2 text-sm text-white/80 ring-1 ring-white/20">Reload</a>}
      </div>
    </div>
  );
}
