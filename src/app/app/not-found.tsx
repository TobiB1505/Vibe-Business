import Link from "next/link";
import { AccountShell } from "@/components/layout/account-shell";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";

/**
 * The 404 for everything under `/app` (UI-4 §2).
 *
 * ## Which case actually lands here
 *
 * A project that does not exist, and a project belonging to somebody else,
 * produce the same `notFound()` from `getProjectWorkspaceContext` — the same
 * answer deliberately, so a URL cannot be used to discover which project ids
 * exist. The workspace *layout* is what raises it, and a `notFound()` from a
 * layout bubbles past that segment, which is why this boundary lives here and
 * not beside the project routes.
 *
 * The copy therefore says nothing about ownership. "We couldn't find it" is
 * the whole truth available to the person reading it.
 */
export default function AppNotFound() {
  return (
    <AccountShell>
      <EmptyState
        title="This page isn't here"
        description="The link may be out of date, or the project may have been disconnected. Your other projects are unaffected."
        action={
          <Link href="/app" className={buttonClasses()}>
            Back to your projects
          </Link>
        }
      />
    </AccountShell>
  );
}
