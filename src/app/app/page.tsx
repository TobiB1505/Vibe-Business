import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/modules/auth/session";
import { getDashboardOverview } from "@/modules/projects/dashboard";
import { getOnboardingRouting } from "@/modules/onboarding/store";
import { orderProjectsByAttention } from "@/modules/projects/attention";
import { LAST_VISITED_COOKIE, resolveLastVisited } from "@/modules/projects/last-visited";
/**
 * `/app` resolves to a product. It is not a screen.
 *
 * ## What was here
 *
 * An account dashboard: a ranked desk of every product and every waiting
 * decision. It was removed, and the reason is that it answered a question a
 * founder was not asking. Vibe works on *a product*. The account level had one
 * job — pick which — and a whole screen to do it in, which put a page between
 * a founder and the thing they came for on every single visit.
 *
 * So the picking happens here, in a redirect, and the product is the first
 * thing on screen. What was genuinely useful at the account level — the list
 * of products, the connected repositories, billing, the profile — is Settings
 * now, with its own rail.
 *
 * A failed GitHub connection no longer arrives here: the callback sends it to
 * Settings → Repositories, which is a page that can show it and offers the
 * control to try again.
 *
 * ## The three answers
 *
 * - **No products.** Onboarding, which is the only screen that can help.
 * - **Setup never finished, and never finished for anything.** Resume it.
 *   Once a founder has completed setup once, an unfinished second project is
 *   an offer rather than a destination — the workspace must not become
 *   unreachable for the person who least needs the flow.
 * - **Otherwise**, the product they were last in, falling back to the one
 *   attention ranks first. See `last-visited.ts` for why the hint is a cookie
 *   and why it is never trusted on its own.
 *
 * ## Cost
 *
 * Two constant-cost read models regardless of how many projects exist, both
 * of which this route already made. Nothing renders, so nothing else is
 * fetched: no shell, no credit balance, no per-project anything.
 */
export default async function AppEntryPage() {
  const session = await requireSession();

  const supabase = await createClient();
  const { projects } = await getDashboardOverview(supabase, session.userId);

  if (projects.length === 0) redirect("/app/onboarding");

  const routing = await getOnboardingRouting(
    supabase,
    projects.map((project) => project.id),
  );

  if (!routing.hasCompleted && routing.resumableProjectId) {
    redirect(`/app/onboarding/${routing.resumableProjectId}`);
  }

  const hint = (await cookies()).get(LAST_VISITED_COOKIE)?.value ?? null;
  const target = resolveLastVisited(orderProjectsByAttention(projects), hint);

  redirect(`/app/projects/${target}`);
}
