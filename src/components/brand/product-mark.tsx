import { ProductLogo } from "./product-logo";
import { initialsFrom } from "@/modules/auth/initials";
import { cn } from "@/lib/utils/cn";

/**
 * A customer's product, as one small square.
 *
 * ## Why the logo sits inside a tile rather than replacing it
 *
 * So the row keeps its height whether or not an image loads. A logo that is
 * the whole mark changes a row's geometry the moment a request fails, which is
 * an entrance nobody asked for on a list somebody is already reading.
 *
 * ## Why the fallback is initials and not Vibe's own mark
 *
 * `ProductLogo` defaults to the Vibe mark, and on a list of the *customer's*
 * products that would read as a claim about whose product a row is. The
 * initials are neutral and are what the account avatar already does.
 *
 * Extracted from the old product card, which was the only place this existed —
 * and then the desk needed it at two more sizes.
 */

const SIZES = {
  sm: { box: "size-8", image: "size-5", text: "text-caption" },
  md: { box: "size-11", image: "size-7", text: "text-body" },
} as const;

export function ProductMark({
  logoUrl,
  name,
  size = "md",
  className,
}: {
  logoUrl: string | null;
  /** The product's display name — the initials come from it. */
  name: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const { box, image, text } = SIZES[size];
  const initials = initialsFrom(name);

  return (
    <span
      aria-hidden
      className={cn(
        "bg-mint-tint text-mint border-mint-line flex shrink-0 items-center justify-center",
        "rounded-nav border font-bold tracking-[-0.02em]",
        box,
        text,
        className,
      )}
    >
      {logoUrl ? (
        <ProductLogo
          src={logoUrl}
          alt=""
          className={cn(image, "object-contain")}
          fallback={initials}
        />
      ) : (
        initials
      )}
    </span>
  );
}
