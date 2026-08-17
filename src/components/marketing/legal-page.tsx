import type { ReactNode } from "react";
import { MarketingShell } from "@/components/layout/marketing-shell";
import { Notice } from "@/components/ui/states";
import { MonoLabel } from "@/components/ui/typography";

/**
 * The shared frame for `/privacy` and `/terms` (UI-S1 §7, §27).
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
 */
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
  return (
    <MarketingShell>
      <article className="flex max-w-[46rem] flex-col gap-8 py-14 sm:py-20">
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

        <div className="flex flex-col gap-10">{children}</div>
      </article>
    </MarketingShell>
  );
}

/** One numbered section of a legal document. */
export function LegalSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-fg text-title font-semibold">{heading}</h2>
      <div className="text-fg-prose flex flex-col gap-3 text-sm leading-relaxed [&_a]:underline [&_a]:underline-offset-4 [&_li]:leading-relaxed [&_ul]:flex [&_ul]:list-disc [&_ul]:flex-col [&_ul]:gap-1.5 [&_ul]:pl-5">
        {children}
      </div>
    </section>
  );
}
