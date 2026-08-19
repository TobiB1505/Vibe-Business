import Link from "next/link";
import { MarketingShell } from "@/components/layout/marketing-shell";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";

/**
 * The public 404 (UI-4 §2).
 *
 * Signed-out ground, so it uses the marketing shell rather than the
 * application one — a stranger who mistyped a URL should not meet an
 * application header for a product they have not signed into.
 */
export default function NotFound() {
  return (
    <MarketingShell>
      <div className="flex min-h-[50vh] flex-col justify-center py-16">
        <EmptyState
          title="This page isn't here"
          description="The link may be out of date. Everything Vibe does starts from your projects."
          action={
            <Link href="/" className={buttonClasses()}>
              Back to the homepage
            </Link>
          }
        />
      </div>
    </MarketingShell>
  );
}
