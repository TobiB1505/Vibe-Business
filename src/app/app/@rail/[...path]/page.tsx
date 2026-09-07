import { RailBrand, RailFooter } from "@/components/layout/app-frame";
import { createClient } from "@/lib/supabase/server";
import { buildAccountIdentity } from "@/modules/auth/identity-view";
import { requireSession } from "@/modules/auth/session";
import { getHeaderCreditBalance } from "@/modules/billing/overview";
import { getGithubIdentity } from "@/modules/github/identity";
import { ProjectRailSlot } from "../project-rail";
import { SettingsRailSlot } from "../settings-rail";

/**
 * The whole `/app` subtree's rail, resolved from the address (UI-13).
 *
 * ## Why one route and not one per area
 *
 * Because a route boundary is a remount boundary. A slot route per area —
 * `@rail/projects/[projectId]/…` beside `@rail/settings/…` — would rebuild the
 * navigation every time a founder moved between sections of their own product,
 * which is the thing this sprint exists to stop. One catch-all matches every
 * address under `/app`, so React keeps this component mounted for the life of
 * the session and only what it returns changes.
 *
 * A required catch-all rather than an optional one: `[[...path]]` has the same
 * specificity as `/app` itself and Next refuses the pair. `/app` needs no rail
 * anyway — it resolves a destination and redirects — so it takes
 * `default.tsx`.
 *
 * ## Why the lockup and the identity are here
 *
 * Because they are the parts that do not change, and rendering them here is
 * what makes that literally true rather than merely true of the pixels. They
 * sit at fixed positions in this component's output, so React keeps the same
 * DOM nodes across the fold and only the navigation between them is replaced.
 * Composed in each area instead, they would be two identical copies — and
 * "identical" is a property that stops holding the first time somebody edits
 * one of them.
 *
 * It is also one read each instead of two: the balance and the GitHub identity
 * are account-scoped and say the same thing in both areas.
 *
 * ## Why a switch and not a lookup
 *
 * There are two navigations, and the third answer is "none". Anything that is
 * not a product workspace or Settings — onboarding, the connect flow, the
 * internal console — renders nothing, and `AppFrame` hides an empty rail. Note
 * the order: nothing is read until an area has been established, so a founder
 * in the middle of onboarding pays for none of this. A registry would invite a
 * third area to be added here rather than deciding whether it should have a
 * rail at all.
 */
export default async function RailForPath({ params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;

  const area =
    path[0] === "projects" && typeof path[1] === "string"
      ? ({ kind: "project", projectId: path[1] } as const)
      : path[0] === "settings"
        ? ({ kind: "settings" } as const)
        : null;

  if (!area) return null;

  const session = await requireSession();
  const supabase = await createClient();

  const [github, balance] = await Promise.all([
    getGithubIdentity(supabase, session.userId),
    /*
     * A failure renders no balance chip rather than no rail. Every priced
     * control states its price; not being able to say what is left to spend
     * them from is worth less than the navigation.
     */
    getHeaderCreditBalance(supabase, { userId: session.userId }).catch(() => null),
  ]);

  return (
    <>
      <RailBrand />
      {area.kind === "project" ? (
        <ProjectRailSlot projectId={area.projectId} />
      ) : (
        <SettingsRailSlot />
      )}
      <RailFooter
        credits={balance?.availableCredits ?? null}
        identity={buildAccountIdentity({ email: session.email, github })}
        subtitle={area.kind === "project" ? "Founder" : undefined}
      />
    </>
  );
}
