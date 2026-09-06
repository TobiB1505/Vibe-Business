import Link from "next/link";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { ArrowRightIcon, ExternalLinkIcon } from "./icons.generated";

/**
 * A link, in the two contexts a link actually occurs in.
 *
 * ## Why this is not one treatment
 *
 * Forty-nine elements wrote a bare `underline` by hand. Counted by element,
 * they are navigation and not actions — thirty-eight `Link`, ten `a`, one
 * `button` — so the by-role split that replaced `TextAction`'s underline never
 * reached them. Counted by *context*, which is what decides this, they are two
 * groups and not one:
 *
 *   38  standalone   a card header, a row, a notice's next step
 *   11  in prose     "By creating an account you agree to the terms"
 *
 * For the eleven, the line is the only signal besides colour that these words
 * behave differently from the words around them, and WCAG 1.4.1 is explicit
 * that colour alone may not carry that inside a block of text. Removing it
 * there is not a cleanup, it is a defect.
 *
 * For the thirty-eight, the link is already its own object in its own
 * position. Nothing has to separate it from a sentence, because there is no
 * sentence — so the line is doing the least possible work, loudly, which is
 * the same finding that moved the actions off it.
 *
 * So: a mark for the ones that stand alone, the line for the ones that do not.
 *
 * ## The mark is not decoration
 *
 * It says where the link goes, and "further into this product" and "away from
 * it" are different destinations. Internal links take the arrow that already
 * means forward everywhere else in the interface; external ones take the same
 * arrow turned, which is the convention for leaving. That distinction is the
 * only reason a mark is better here than nothing at all.
 */

const SHARED = "rounded-sm transition-interactive";

/**
 * A link that continues a sentence.
 *
 * Classes rather than a component, because these sit inside `<p>` elements
 * beside text, sometimes as `next/link` and sometimes as a bare anchor, and a
 * wrapper would have to re-expose everything an anchor already does. The same
 * reason `inlineActionClasses` exists beside `InlineAction`.
 *
 * Brighter than the prose around it *and* underlined — the colour is not doing
 * the work alone, it is making the link comfortable to find once you know it
 * is there.
 */
export function proseLinkClasses(className?: string): string {
  return cn(SHARED, "text-fg-body underline underline-offset-4 hover:text-fg", className);
}

export type StandaloneLinkProps = {
  href: string;
  children: ReactNode;
  /**
   * Leaves the product. Renders a plain anchor with the turned arrow, and
   * carries `rel="noreferrer"` so the destination learns nothing about where
   * its visitor came from.
   */
  external?: boolean;
  className?: string;
} & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "className" | "children">;

/**
 * A link that stands on its own.
 *
 * A component rather than classes, because the mark has to be there. Thirty-
 * eight call sites that each remember to add an icon is thirty-eight chances
 * to forget one, and a link with no line and no mark is a link with nothing.
 */
export function StandaloneLink({
  href,
  children,
  external = false,
  className,
  ...props
}: StandaloneLinkProps) {
  const classes = cn(
    SHARED,
    "inline-flex w-fit items-center gap-1.5 text-fg-muted hover:text-fg-body",
    className,
  );
  // 14px against a 13–14px label: a mark that matches its word's size reads as
  // a second letter rather than as a sign. The same figure `InlineAction` uses.
  const mark = external ? <ExternalLinkIcon size={14} /> : <ArrowRightIcon size={14} />;

  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={classes} {...props}>
        {children}
        {mark}
      </a>
    );
  }

  return (
    <Link href={href} className={classes} {...props}>
      {children}
      {mark}
    </Link>
  );
}
