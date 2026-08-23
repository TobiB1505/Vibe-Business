import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { SectionHeader } from "@/components/ui/typography";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/modules/auth/session";
import { orderProjectsByAttention } from "@/modules/projects/attention";
import { getDashboardOverview } from "@/modules/projects/dashboard";
import { ProductCard } from "../../product-card";

export const metadata = { title: "My Products" };

/**
 * Every product, as an index (CORE-6).
 *
 * ## How this differs from Home
 *
 * Home leads with one product and one move; this leads with nothing. It is the
 * list you come to when you know which product you want, so it has no hero, no
 * headline about attention and no editorial — a heading, the cards, and the
 * one action that adds another.
 *
 * The cards are the same component and the same ordering as Home's grid.
 * Sorting this page by name instead would mean two screens disagreeing about
 * which product matters, which is the disagreement `orderProjectsByAttention`
 * exists to prevent.
 *
 * ## Cost
 *
 * One constant-cost read model, whatever the account holds — and the same one
 * Home uses, so `dashboard-contract.test.ts` guards this page too. Adding a
 * per-product read here would be the N+1 that read model exists to avoid,
 * arriving through the one route nobody was watching.
 */
export default async function ProductsPage() {
  const session = await requireSession("/app/products");
  const supabase = await createClient();

  const { projects } = await getDashboardOverview(supabase, session.userId);

  return (
    <div className="flex flex-col gap-8">
      <SectionHeader
        level={1}
        title="My Products"
        description="Everything Vibe is watching, most urgent first."
        actions={
          <Link
            href="/app/connect/github"
            className={buttonClasses({ variant: "secondary", size: "sm" })}
          >
            Connect a product
          </Link>
        }
      />

      {projects.length === 0 ? (
        <EmptyState
          title="No products yet"
          description="Connect a repository you have already built. Vibe reads the product, scores the business around it, and shows you what to do next."
          action={
            <Link href="/app/connect/github" className={buttonClasses({ size: "sm" })}>
              Connect GitHub
            </Link>
          }
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {orderProjectsByAttention(projects).map((project) => (
            <li key={project.id}>
              <ProductCard project={project} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
