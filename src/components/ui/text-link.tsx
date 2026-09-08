import Link from "next/link";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { ArrowRightIcon, ExternalLinkIcon } from "./icons.generated";
import { buttonClasses } from "./button";

/**
 * A link, in the two contexts a link actually occurs in (UI-29).
 *
 * ## What changed, and what the old argument said
 *
 * These were type: a bright word with a line under it in prose, a muted word
 * with an arrow standing on its own. The founder chose treatment B from
 * `study-cta` — **one vocabulary** — so both now wear the same resting
 * container every other control in the product wears, and `StandaloneLink` is
 * literally `buttonClasses({ variant: "ghost" })`.
 *
 * The argument that used to live here was about the underline: for a link
 * inside a sentence the line is the only signal besides colour, and WCAG 1.4.1
 * is explicit that colour alone may not carry that inside a block of text — so
 * removing it would be a defect, not a cleanup.
 *
 * **That argument is met, not overruled.** A container is not a colour. The
 * prose link is a tinted, rounded box with its own ground, which separates it
 * from the words either side at any zoom, in monochrome, and for a reader who
 * does not perceive the hue at all — every test the underline passed, and one
 * more, because the box has a shape.
 *
 * ## Why the prose link is `inline` and not `inline-flex`
 *
 * A box in a sentence has to break across lines. `inline-flex` cannot: a long
 * link at 390px would push the paragraph sideways instead of wrapping, which
 * is the one failure this whole treatment could plausibly introduce.
 * `box-decoration-clone` is what gives each fragment its own padding and its
 * own rounded ends rather than one box sliced in half.
 *
 * ## The mark is not decoration
 *
 * It says where the link goes, and "further into this product" and "away from
 * it" are different destinations. Internal links take the arrow that already
 * means forward everywhere else in the interface; external ones take the same
 * arrow turned, which is the convention for leaving. That distinction is the
 * only reason a mark is better here than nothing at all.
 */

/**
 * A link that continues a sentence.
 *
 * Classes rather than a component, because these sit inside `<p>` elements
 * beside text, sometimes as `next/link` and sometimes as a bare anchor, and a
 * wrapper would have to re-expose everything an anchor already does. The same
 * reason `buttonClasses` exists beside `Button`.
 *
 * Tighter than a `ghost` button — `px-1.5` and no minimum height — because
 * this one has to sit on a line of 14px prose without changing its leading.
 * The surface is the same one, at the same intensities.
 */
export function proseLinkClasses(className?: string): string {
  return cn(
    "rounded-full transition-interactive",
    // `inline` + `box-decoration-clone`: see the note above. An `inline-flex`
    // here does not wrap.
    "inline box-decoration-clone px-1.5 py-0.5",
    "bg-surface-3 bg-gradient-to-b from-sheen-soft to-transparent text-fg-body shadow-sheen",
    "hover:from-sheen-soft-strong hover:text-fg",
    className,
  );
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
 * six call sites that each remember to add an icon is thirty-six chances to
 * forget one.
 *
 * It wears `buttonClasses({ variant: "ghost" })` and nothing of its own. That
 * is the whole of treatment B: a link on its own line and a quiet button were
 * already the same object doing the same job in the same place, and the only
 * thing separating them was which file happened to draw it.
 */
export function StandaloneLink({
  href,
  children,
  external = false,
  className,
  ...props
}: StandaloneLinkProps) {
  const classes = cn(buttonClasses({ variant: "ghost" }), "w-fit", className);
  // 14px against a 13–14px label: a mark that matches its word's size reads as
  // a second letter rather than as a sign. The same figure `Button`'s `icon` uses.
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
