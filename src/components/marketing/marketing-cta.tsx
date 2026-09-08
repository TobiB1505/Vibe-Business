import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClasses } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

/**
 * The one control on the landing page that has to be pressed (UI-29).
 *
 * ## Why this is a component and not a size
 *
 * `size="marketing"` is a class list, and this is a structure: a mint halo
 * behind the button, and a second line of type inside it. Neither can come out
 * of `buttonClasses`, and a call site that assembles them by hand is the third
 * one assembling them slightly differently.
 *
 * The founder chose treatment D's landing button out of `study-cta`, on top of
 * treatment B everywhere else. The argument for the split is that this is the
 * only button in the product pressed by somebody who has not decided yet —
 * every other one is pressed by a customer who is already inside.
 *
 * ## The second line is not a slogan
 *
 * `assurance` takes the objection a visitor has *at the moment of pressing*,
 * and the hero already had one: "No credit card to start", sitting in a list
 * twenty pixels below the button. It is inside the button now and gone from
 * the list — moved, not added, because a promise printed twice reads as a
 * sales page rather than as a fact.
 *
 * Never put a claim here the product does not already make elsewhere. Every
 * line in this slot is a promise Vibe has to keep.
 *
 * ## The halo is `aria-hidden` and costs nothing
 *
 * A blurred div, no animation, no `backdrop-filter`. Under `prefers-reduced-
 * motion` there is nothing to reduce, because nothing moves — the light is
 * static, which is the version of "impressive" that survives an accessibility
 * setting and a screenshot alike.
 */
export function MarketingCta({
  href,
  children,
  assurance,
  className,
}: {
  href: string;
  /** The label and its mark. */
  children: ReactNode;
  /** One short line the product already promises. Omitted where none applies. */
  assurance?: string;
  className?: string;
}) {
  return (
    <Link href={href} className={cn("group relative inline-flex", className)}>
      <span
        aria-hidden="true"
        className={cn(
          "bg-mint/25 pointer-events-none absolute -inset-x-6 -inset-y-4 rounded-full blur-2xl",
          "transition-interactive group-hover:bg-mint/35",
        )}
      />
      <span
        className={cn(
          buttonClasses({ size: "marketing" }),
          "relative flex-col gap-1 rounded-card px-8 py-4 font-bold",
        )}
      >
        <span className="inline-flex items-center gap-2">{children}</span>
        {assurance && (
          <span className="text-mint-ink/70 text-meta font-semibold">{assurance}</span>
        )}
      </span>
    </Link>
  );
}
