import type { ReactNode } from "react";
import { AccountShell, AccountSidebar } from "@/components/layout/account-shell";
import { AccountMenu } from "@/components/layout/account-menu";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/modules/auth/session";
import { buildAccountIdentity } from "@/modules/auth/identity-view";
import { getHeaderCreditBalance } from "@/modules/billing/overview";
import { getGithubIdentity } from "@/modules/github/identity";

/**
 * The account frame, shared by every page in this route group (CORE-6).
 *
 * ## What it loads, and why that list is two rows long
 *
 * A layout runs on every route beneath it, so anything read here is paid for by
 * all of them. It reads the session — which `src/app/app/layout.tsx` has
 * already established, so this is a cookie read rather than a round trip — and
 * one account-scoped Credit balance.
 *
 * It also reads one `github_connections` row for the account menu — the only
 * identity this product has, since nothing here stores a name.
 *
 * `getHeaderCreditBalance` is the only billing read allowed on this surface:
 * one wallet row plus that wallet's active lots, whether the user has one
 * project or sixty. `getBillingOverview` and every per-project billing read are
 * forbidden here by `dashboard-contract.test.ts`, which guards this file for
 * exactly that reason — the balance moved out of `page.tsx` into this layout,
 * and the contract moved with it rather than going quiet.
 *
 * Nothing about a *project* is read here. The dashboard's own reads stay in
 * `page.tsx`, where the one screen that renders them pays for them.
 *
 * ## Ownership
 *
 * `requireSession` again rather than trusting the parent layout: an App Router
 * layout does not gate what renders beneath it, and each page re-checks too.
 */
export default async function AccountLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();
  const supabase = await createClient();

  /*
   * Two account-scoped rows, in parallel. Neither scales with anything: one
   * wallet with its active lots, and one `github_connections` row behind a
   * unique key on the user.
   */
  const [creditBalance, github] = await Promise.all([
    getHeaderCreditBalance(supabase, { userId: session.userId }),
    getGithubIdentity(supabase, session.userId),
  ]);

  const identity = buildAccountIdentity({ email: session.email, github });

  return (
    <AccountShell
      sidebar={
        <AccountSidebar
          credits={creditBalance?.display ?? null}
          footer={<AccountMenu identity={identity} />}
        />
      }
    >
      {children}
    </AccountShell>
  );
}
