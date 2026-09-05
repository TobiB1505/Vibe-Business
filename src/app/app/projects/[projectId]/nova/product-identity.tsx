import Link from "next/link";
import { ProductLogo } from "@/components/brand/product-logo";
import { VibeMark } from "@/components/brand/vibe-mark";
import { RatingChip } from "@/components/ui/status-pill";
import { MonoLabel } from "@/components/ui/typography";

/**
 * Whose product this is (UI Sourcing Spec C4).
 *
 * ## The name, and the bug it fixes
 *
 * `productDisplayName` — what Vibe read the product calling itself, falling
 * back to the label the founder typed at connection time. The audit found the
 * workspace rail naming the *project* while the dashboard named the *product*,
 * so the same thing had two names one click apart. Home takes the product's.
 *
 * ## Why it is a line and not a card
 *
 * Home has exactly one raised surface, and it is the Focus Card. Identity is
 * context for the thing that needs attention, not a second object competing
 * with it — so this is a quiet header line above the card, in the same role an
 * eyebrow plays above a heading.
 */
export function ProductIdentity({
  name,
  logoUrl,
  category,
  understood,
  productHref,
}: {
  name: string;
  logoUrl: string | null;
  /** What Vibe reads this product as. Absent until a profile exists. */
  category?: string | null;
  /**
   * Whether the founder has confirmed what Vibe understood.
   *
   * Three states, not two: confirmed, read-but-unconfirmed, and nothing read
   * yet. The third is not a failure — it is a project that has not been
   * scanned — so it says so plainly rather than sitting empty.
   */
  understood: "confirmed" | "unconfirmed" | "not_read";
  productHref: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className="flex min-w-0 items-center gap-3">
        {logoUrl ? (
          <ProductLogo
            src={logoUrl}
            alt=""
            size={28}
            className="h-7 max-w-[120px] object-contain"
          />
        ) : (
          <VibeMark size={28} />
        )}
        <span className="text-fg min-w-0 truncate text-title font-bold">{name}</span>
      </span>

      {category && <RatingChip>{category}</RatingChip>}

      {understood === "not_read" ? (
        <Link
          href={productHref}
          className="text-fg-muted hover:text-fg-body text-ui underline underline-offset-4 transition-interactive"
        >
          Vibe has not read this product yet
        </Link>
      ) : (
        <MonoLabel>
          {understood === "confirmed" ? "Confirmed by you" : "Not confirmed yet"}
        </MonoLabel>
      )}
    </div>
  );
}
