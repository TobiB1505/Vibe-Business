import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { MarketingShell } from "@/components/layout/marketing-shell";
import { ChevronRightIcon } from "@/components/ui/dashboard-icons";
import { Notice } from "@/components/ui/states";
import { MonoLabel } from "@/components/ui/typography";
import { cn } from "@/lib/utils/cn";

/**
 * The shared frame for `/privacy` and `/terms` (UI-S1 §7, §27; UI-17).
 *
 * ## Why these pages exist at all
 *
 * Because Vibe asks a stranger to connect a repository, and until this sprint
 * there was nowhere on the site that said what happens to it. That is not a
 * legal-completeness problem so much as a trust one: the request came before
 * the explanation.
 *
 * ## Why they are honest about being incomplete
 *
 * This sprint is not a legal-architecture sprint, and several things a finished
 * notice needs — who the operating entity is, where it is, which law governs a
 * dispute — are simply not facts that exist anywhere in this repository.
 * Inventing them would be worse than omitting them, so `pending` names each
 * one on the page rather than leaving a reader to assume it was decided.
 *
 * Everything that *is* stated describes behaviour the implementation actually
 * has, and is traceable to it. Nothing here claims a certification, an audit,
 * a retention period or a security guarantee that no code enforces.
 *
 * ## What was wrong with the frame (UI-17)
 *
 * The article was `max-w-[46rem]` with no `mx-auto`, inside a container that
 * runs to 96rem. At 1440 that is a column pinned to the left edge with about
 * 700px of nothing beside it — measured, not estimated. And a nine-section
 * legal document had no way to reach section seven except scrolling past six.
 *
 * Both are the same defect: the page never decided what to do with the space
 * it has. It has a contents list now, and the list is what fills it.
 *
 * ## Why the contents list reads the sections rather than being given them
 *
 * A list of headings passed in beside the sections is a second copy of the
 * document's structure, and the two drift the first time somebody adds a
 * section and forgets the list — silently, because a missing entry breaks
 * nothing. So the list is derived from the children, and `sectionId` computes
 * the anchor for both the list and the section it points at. A link that goes
 * nowhere is not a thing that can be written here.
 */

/** The anchor for a section, from its heading. One function, two callers. */
function sectionId(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

type LegalSectionProps = { heading: string; children: ReactNode };

export function LegalPage({
  title,
  updated,
  summary,
  pending,
  children,
}: {
  title: string;
  /** The date this text last changed. Written, not generated, so it is honest. */
  updated: string;
  /** One paragraph a person can read instead of the whole page. */
  summary: ReactNode;
  /** Owner-specific facts that do not exist yet and must before public launch. */
  pending: string[];
  children: ReactNode;
}) {
  const sections = Children.toArray(children)
    .filter((child): child is ReactElement<LegalSectionProps> => {
      return isValidElement(child) && child.type === LegalSection;
    })
    .map((child) => child.props.heading);

  const contents = (
    <ol className="flex flex-col gap-0.5">
      {sections.map((heading, index) => (
        <li key={heading}>
          <a
            href={`#${sectionId(heading)}`}
            className={cn(
              "text-fg-secondary hover:bg-surface-2 hover:text-fg-body rounded-nav",
              "flex items-baseline gap-2.5 px-3 py-2 text-body transition-interactive",
              "focus-visible:ring-mint focus-visible:ring-2 focus-visible:outline-none",
            )}
          >
            <span aria-hidden className="text-fg-meta shrink-0 font-mono text-label">
              {String(index + 1).padStart(2, "0")}
            </span>
            {heading}
          </a>
        </li>
      ))}
    </ol>
  );

  return (
    <MarketingShell>
      {/*
        Centred while it is alone, and a two-column document once there is room
        for one. The article keeps the left margin the header's own lockup
        sits on, so nothing a reader has already found moves; the contents take
        the space that was empty.
      */}
      <div className="py-14 sm:py-20 xl:grid xl:grid-cols-[minmax(0,39rem)_1fr] xl:gap-x-20">
        <article className="mx-auto flex w-full max-w-[39rem] flex-col gap-8 xl:mx-0">
          <header className="flex flex-col gap-4">
            <MonoLabel>Last updated {updated}</MonoLabel>
            <h1 className="text-fg text-display sm:text-hero font-bold text-balance">{title}</h1>
            <p className="text-fg-prose text-lead">{summary}</p>
          </header>

          <Notice tone="info" label="Not yet complete">
            <p>
              Vibe Business is in early development and this document is a working draft, not
              finished legal advice. The following still needs to be filled in before public launch:
            </p>
            <ul className="mt-3 flex list-disc flex-col gap-1 pl-5">
              {pending.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </Notice>

          {/*
            The same list, as a disclosure, on every width the sticky column
            does not exist at. Closed by default: a reader who came to read the
            document should not have to scroll past its table of contents to
            begin, and a reader who came to find one clause needs one tap.
          */}
          <details className="border-line-2 rounded-panel group border xl:hidden">
            <summary
              className={cn(
                "text-fg-body flex cursor-pointer list-none items-center gap-2.5 px-4 py-3",
                "text-body font-semibold [&::-webkit-details-marker]:hidden",
              )}
            >
              <ChevronRightIcon
                size={15}
                aria-hidden
                className="text-fg-meta shrink-0 transition-transform group-open:rotate-90"
              />
              On this page
            </summary>
            <div className="border-line-1 border-t p-2">{contents}</div>
          </details>

          <div className="flex flex-col gap-10">{children}</div>
        </article>

        {/*
          Sticky, so a clause found on page four can be left for a clause on
          page one without scrolling back. `aria-label` rather than a visible
          heading: the label is the one below it, and two would be one too
          many for a list of eight links.
        */}
        <nav aria-label="On this page" className="hidden xl:block">
          <div className="sticky top-24 flex max-w-[18rem] flex-col gap-3">
            <MonoLabel>On this page</MonoLabel>
            {contents}
          </div>
        </nav>
      </div>
    </MarketingShell>
  );
}

/** One section of a legal document, and the anchor the contents list points at. */
export function LegalSection({ heading, children }: LegalSectionProps) {
  return (
    <section
      id={sectionId(heading)}
      /*
        Cleared of the marketing header, which is `sticky top-0`. Without this
        every link in the contents list lands with its own heading underneath
        the bar the reader just clicked through.
      */
      className="flex scroll-mt-28 flex-col gap-3"
    >
      <h2 className="text-fg text-title font-semibold">{heading}</h2>
      <div className="text-fg-prose flex flex-col gap-3 text-body leading-relaxed [&_a]:underline [&_a]:underline-offset-4 [&_li]:leading-relaxed [&_ul]:flex [&_ul]:list-disc [&_ul]:flex-col [&_ul]:gap-1.5 [&_ul]:pl-5">
        {children}
      </div>
    </section>
  );
}
