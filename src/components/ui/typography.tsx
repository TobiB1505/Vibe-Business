import type { ElementType, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Typographic primitives (UI-0).
 *
 * The split is the whole point: the interface family for what a person wrote,
 * mono for what a machine produced. `MonoValue` exists so that decision is
 * made by picking a component rather than by remembering to add `font-mono`.
 *
 * ## Two things this docblock used to say, corrected
 *
 * It named **Space Grotesk** as the interface face. UI-6 removed it, and
 * `design-tokens.test.ts` now asserts `var(--font-space-grotesk)` never comes
 * back. The interface family is whatever `--font-sans` resolves to in the
 * palette in force.
 *
 * It also assigned **"scores, counts, credits"** to mono. `DESIGN.md` places
 * them in the interface family and reserves mono for repository names,
 * branches and SHAs — "technical identifiers use the mono family sparingly".
 * That is the rule; a score is a number a person reads, not a machine
 * identifier they have to match character by character.
 */

/**
 * The small caps rule above a block.
 *
 * Set by the `eyebrow` utility rather than by literals, so a palette answers
 * what it is made of. v1 keeps the mono it shipped with; v2 sets it in the
 * interface family at 0.10em, which is what `DESIGN.md` asked for all along
 * and what 289 uses across 51 files were quietly contradicting — none of which
 * had to be edited to change it.
 *
 * The name stays `MonoLabel`. Renaming a component used in 51 files to record
 * that it is no longer always mono would be a large diff carrying no
 * behaviour, and every call site would still mean the same thing.
 */
export function MonoLabel({
  children,
  className,
  as: Component = "span",
  id,
}: {
  children: ReactNode;
  className?: string;
  /**
   * Render as a real heading where the label *is* the section's heading.
   * Visual weight and document structure are separate decisions: a section rule
   * can look like a caption and still need to appear in the outline.
   */
  as?: ElementType;
  /** For `aria-labelledby` when this labels its surrounding section. */
  id?: string;
}) {
  return (
    <Component
      id={id}
      /*
       * A stable hook for the account dashboard's density budget. Counting
       * these is how "at most one labelled metadata pair per card" becomes an
       * assertion instead of an intention — matching on the class list would
       * break the moment the ramp moves.
       */
      data-mono-label=""
      className={cn("text-fg-meta eyebrow", className)}
    >
      {children}
    </Component>
  );
}

/**
 * A section heading with its optional supporting line and trailing controls.
 *
 * `level` sets the real heading element so the document outline is correct;
 * the visual size is independent of it, because a page's second-most important
 * thing is not always an `<h2>`-sized thing.
 */
export function SectionHeader({
  label,
  title,
  description,
  actions,
  level = 2,
  className,
}: {
  /** Mono eyebrow above the title. */
  label?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  level?: 1 | 2 | 3;
  className?: string;
}) {
  const Heading = `h${level}` as ElementType;

  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="flex min-w-0 flex-col gap-2">
        {label && <MonoLabel>{label}</MonoLabel>}
        <Heading
          className={cn(
            "text-fg font-bold",
            level === 1 ? "text-headline sm:text-display" : "text-title",
          )}
        >
          {title}
        </Heading>
        {description && <p className="text-fg-muted max-w-[70ch] text-body">{description}</p>}
      </div>
      {actions && (
        <div className="flex min-w-0 w-full flex-wrap items-center gap-3 sm:w-auto sm:shrink-0">
          {actions}
        </div>
      )}
    </div>
  );
}
