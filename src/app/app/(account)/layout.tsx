import type { ReactNode } from "react";
import { AccountShell, AccountSidebar } from "@/components/layout/account-shell";
import { AccountFooter } from "@/components/layout/account-footer";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/modules/auth/session";
import { getHeaderCreditBalance } from "@/modules/billing/overview";

/**
 * The account frame, shared by every page in this route group (CORE-6).
 *
 * ## What it loads, and why that list is one item long
 *
 * A layout runs on every route beneath it, so anything read here is paid for by
 * all of them. It reads the session — which `src/app/app/layout.tsx` has
 * already established, so this is a cookie read rather than a round trip — and
 * one account-scoped Credit balance.
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

  const creditBalance = await getHeaderCreditBalance(supabase, { userId: session.userId });

  return (
    <AccountShell
      sidebar={
        <AccountSidebar
          credits={creditBalance?.display ?? null}
          footer={<AccountFooter email={session.email} />}
        />
      }
    >
      {children}
    </AccountShell>
  );
}
