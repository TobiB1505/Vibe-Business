import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClasses } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

/**
 * The one control on the landing page that has to be pressed (UI-29, UI-34).
 *
 * ## Why this is a component and not a size
 *
 * `size="marketing"` is a class list, and this is a structure: a mint halo
 * behind the button, and the assurance attached to it. Neither can come out of
 * `buttonClasses`, and a call site that assembles them by hand is the third one
 * assembling them slightly differently.
 *
 * The founder chose treatment D's landing button out of `study-cta`, on top of
 * treatment B everywhere else. The argument for the split is that this is the
 * only button in the product pressed by somebody who has not decided yet —
 * every other one is pressed by a customer who is already inside.
 *
 * ## The assurance sits under the button, not inside it
 *
 * UI-29 put it on a second line **inside** the control, which made the button
 * a two-line block roughly 76px tall with a wide halo around it — and inside
 * the hero card of UI-34 that block was the loudest object on a screen whose
 * subject is the sentence above it. The founder's word was *riesig*.
 *
 * What UI-29 was protecting is unchanged and is still here: the assurance
 * answers the objection a visitor has **at the moment of pressing**, so it
 * stays attached to the control rather than migrating into a list of features
 * somewhere below it. It is one line under the button now instead of one line
 * within it. The button is a single row of type at its natural height.
 *
 * Never put a claim here the product does not already make elsewhere. Every
 * line in this slot is a promise Vibe has to keep.
 *
 * ## Why the label may not wrap
 *
 * A call to action that breaks across two lines stops looking like one thing to
 * press. `whitespace-nowrap` states it, which means the label is a length
 * constraint rather than free copy: it has to fit the narrowest container this
 * component is used in, at 390px, and the hero card's padding makes that about
 * 300px. "Start with your GitHub repo" did not fit and wrapped; "Start with
 * GitHub" does.
 *
 * ## Why no padding or radius is appended here
 *
 * `cn` is a filtered join rather than `tailwind-merge`, so an appended `px-8`
 * beside the size's `px-6` ships **both** and the generated stylesheet decides
 * which wins. This component used to do exactly that with `px-8`, `rounded-card`
 * and `font-bold` — the same defect `SIZE_CLASSES` records for `text-base`
 * against `text-body`, where the padding grew and the type did not for the
 * whole life of the landing page. The geometry comes from the size, once.
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
  /** The label and its mark. One line — see above. */
  children: ReactNode;
  /** One short line the product already promises. Omitted where none applies. */
  assurance?: string;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex flex-col items-center gap-2.5", className)}>
      <Link href={href} className="group relative inline-flex">
        <span
          aria-hidden="true"
          className={cn(
            "bg-mint/20 pointer-events-none absolute -inset-x-4 -inset-y-2.5 rounded-full blur-xl",
            "transition-interactive group-hover:bg-mint/30",
          )}
        />
        <span className={cn(buttonClasses({ size: "marketing" }), "relative whitespace-nowrap")}>
          {children}
        </span>
      </Link>
      {assurance && <span className="text-fg-muted text-caption">{assurance}</span>}
    </span>
  );
}
