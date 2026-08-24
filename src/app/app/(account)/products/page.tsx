import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/modules/auth/session";
import { getProductsOverview } from "@/modules/projects/products-overview";
import { ProductsIndex } from "./products-index";

export const metadata = { title: "My Products" };

/**
 * The detailed product index.
 *
 * Home remains the editorial command center: one signal, one Move and compact
 * product cards. This route is the comparison surface. It can therefore spend
 * more vertical space on each product and load the Product Profile summary,
 * while still using a fixed number of account-wide reads rather than one read
 * per card.
 */
export default async function ProductsPage() {
  const session = await requireSession("/app/products");
  const supabase = await createClient();

  const { products } = await getProductsOverview(supabase, session.userId);

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

  return <ProductsIndex products={products} />;
}
