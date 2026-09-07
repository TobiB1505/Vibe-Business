import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/modules/auth/session";
import { Notice } from "@/components/ui/states";
import { getOnboardingRouting } from "@/modules/onboarding/store";
import { getProductsOverview } from "@/modules/projects/products-overview";
import { ProductsIndex } from "./products-index";

export const metadata = { title: "My Products" };

/**
 * Every product, in one list.
 *
 * ## Why this is the comparison surface
 *
 * It can spend vertical space on each product and load the Product Profile
 * summary, while still making a fixed number of account-wide reads rather than
 * one per row.
 *
 * ## Why the unfinished-setup offer lives here now
 *
 * It was on the account dashboard, which is gone. A founder who finished setup
 * once and then started a second product still has that second one waiting,
 * and `/app` deliberately stops taking them there — the takeover ends the
 * moment anything is finished, or the workspace becomes unreachable for the
 * person who least needs the flow.
 *
 * So the offer had to land somewhere it could be *seen* rather than routed to,
 * and this is the list of every product a founder has. One extra read, for a
 * set of ids rather than one query per product.
 */
export default async function ProductsPage() {
  const session = await requireSession("/app/settings/products");
  const supabase = await createClient();

  const { products } = await getProductsOverview(supabase, session.userId);

  const routing =
    products.length === 0
      ? { resumableProjectId: null, hasCompleted: false }
      : await getOnboardingRouting(
          supabase,
          products.map((product) => product.id),
        );
  const unfinishedSetupProjectId = routing.hasCompleted ? routing.resumableProjectId : null;
  const unfinishedName = products.find((product) => product.id === unfinishedSetupProjectId)?.name;

  if (products.length === 0) {
    return (
      <EmptyState
        title="No products yet"
        description="Connect a repository you have already built. Vibe reads the product, scores the business around it, and shows you what to do next."
        action={
          <Link href="/app/connect/github" className={buttonClasses({ size: "sm" })}>
            Connect GitHub
          </Link>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {unfinishedSetupProjectId && (
        <Notice
          label="Setup not finished"
          action={
            <Link
              href={`/app/onboarding/${unfinishedSetupProjectId}`}
              className={buttonClasses({ variant: "secondary", size: "sm" })}
            >
              Continue setup
            </Link>
          }
        >
          {unfinishedName ?? "One of your products"} hasn&rsquo;t finished setup. You can pick it up
          whenever you want — nothing is lost in the meantime.
        </Notice>
      )}
      <ProductsIndex products={products} />
    </div>
  );
}
