import type { ElementType, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Typographic primitives (UI-0).
 *
 * The split is the whole point: Space Grotesk for what a person wrote,
 * JetBrains Mono for what a machine produced — commit SHAs, branch names,
 * timestamps, scores, counts, credits, state names. `MonoValue` exists so that
 * decision is made by picking a component rather than by remembering to add
 * `font-mono`.
 */

/** The small caps rule above a block. Mono, wide tracking, bottom of the ramp. */
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
      className={cn(
        "text-fg-meta font-mono text-[0.65625rem] tracking-[0.16em] uppercase",
        className,
      )}
    >
      {children}
    </Component>
  );
}

/**
 * Anything the system produced rather than a person: identifiers, SHAs,
 * branches, timestamps, counts, credits.
 */
export function MonoValue({
  children,
  className,
  title,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span title={title} className={cn("text-fg-body font-mono text-[0.8125rem]", className)}>
      {children}
    </span>
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
        {description && <p className="text-fg-muted max-w-[70ch] text-sm">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div>}
    </div>
  );
}
