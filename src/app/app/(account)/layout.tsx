import type { ReactNode } from "react";
import { AccountShell } from "@/components/layout/account-shell";

/**
 * The account content column, shared by every page in this route group.
 *
 * ## Why it reads nothing any more
 *
 * It used to load a Credit balance and a `github_connections` row, because it
 * rendered the rail. The rail moved into the `@rail` parallel route slot so
 * that one `<aside>` can stay mounted across the whole signed-in product
 * (`app-frame.tsx`), and those two reads went with it — the same two reads, in
 * the render that actually needs them.
 *
 * ## Ownership
 *
 * `src/app/app/layout.tsx` gates everything beneath it and every page
 * re-checks for itself, which is the rule here: an App Router layout does not
 * gate the routes under it, so nothing is allowed to rely on one that did.
 * There is nothing left in this file to protect.
 */
export default function AccountLayout({ children }: { children: ReactNode }) {
  return <AccountShell>{children}</AccountShell>;
}
