import { RailFooter } from "@/components/layout/app-frame";
import { createClient } from "@/lib/supabase/server";
import { buildAccountIdentity } from "@/modules/auth/identity-view";
import { requireSession } from "@/modules/auth/session";
import { getHeaderCreditBalance } from "@/modules/billing/overview";
import { getGithubIdentity } from "@/modules/github/identity";

/**
 * The foot of the rail, in one place for both areas (UI-14).
 *
 * The balance and the identity say the same thing in a product and in
 * Settings, and they are drawn by the same component — so this exists to make
 * sure they are also *read* the same way, once, rather than by two layouts
 * that will eventually disagree about which failure means what.
 *
 * Both reads are account-scoped and constant-cost: one wallet row with its
 * active lots, one `github_connections` row behind a unique key. A balance
 * that cannot be read renders no chip rather than no rail — every priced
 * control still states its price, and losing the running total is worth less
 * than losing the navigation.
 */
export async function RailAccountFooter() {
  const session = await requireSession();
  const supabase = await createClient();

  const [github, balance] = await Promise.all([
    getGithubIdentity(supabase, session.userId),
    getHeaderCreditBalance(supabase, { userId: session.userId }).catch(() => null),
  ]);

  return (
    <RailFooter
      credits={balance?.availableCredits ?? null}
      identity={buildAccountIdentity({ email: session.email, github })}
    />
  );
}
