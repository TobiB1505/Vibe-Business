import { cookies } from "next/headers";
import { SettingsRail, type SettingsRailBack } from "@/components/layout/account-shell";
import { createClient } from "@/lib/supabase/server";
import { LAST_VISITED_COOKIE } from "@/modules/projects/last-visited";
import { isUuid } from "@/lib/validation/uuid";

/**
 * The account's navigation, for the `@rail` slot (UI-13).
 *
 * One component for `/app/settings` and everything under it, so moving between
 * General, Products, Repositories, Billing and Profile re-renders the rows
 * inside a rail that is already there.
 *
 * ## What it loads
 *
 * At most one project name — the product this returns to. The balance and the
 * identity below the navigation belong to the rail's foot, which is the same
 * object in both areas and is loaded once by the slot. The per-project billing
 * reads and `getBillingOverview` stay out of here: this renders on every
 * Settings page, and a frame is not a place to pay for a screen.
 */
export async function SettingsRailSlot() {
  return <SettingsRail back={await resolveBack()} />;
}

/**
 * Where "back" goes, by name.
 *
 * `/app` would also be correct and is what this used to be — but `/app` is a
 * redirect, and a redirect resolves a destination on the server before
 * anything can render, which a founder experiences as the whole page
 * reloading. That was the specific complaint. Reading the same cookie `/app`
 * would have read turns the way out into a direct link to a product, named.
 *
 * Ownership is not assumed from the cookie: the row is read under RLS, so a
 * cookie naming somebody else's project resolves to nothing and the generic
 * destination stands. That destination is `/app`, which is still correct — it
 * just costs the hop this is avoiding, and only in the case where there is
 * nothing better to point at.
 */
async function resolveBack(): Promise<SettingsRailBack> {
  const generic: SettingsRailBack = { href: "/app", label: "Back to your product" };

  const hint = (await cookies()).get(LAST_VISITED_COOKIE)?.value ?? null;
  if (!hint || !isUuid(hint)) return generic;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("projects")
      .select("id, name")
      .eq("id", hint)
      .maybeSingle();

    if (error || !data) return generic;
    return { href: `/app/projects/${data.id}`, label: `Back to ${data.name}` };
  } catch {
    // A rail that cannot name the product still has to offer the way out.
    return generic;
  }
}
