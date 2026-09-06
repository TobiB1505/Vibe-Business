import Link from "next/link";

import { projectSectionHref, type WorkspaceSectionId } from "@/components/layout/project-shell";
import { formatDate } from "@/lib/utils/format-datetime";
import type { ActionProvenance } from "@/modules/provenance/actions";
import type { ProvenanceRemedy } from "@/modules/provenance/chain";
import {
  FREE_REMEDIES,
  PROVENANCE_LINK_LABELS,
  PROVENANCE_REASONS,
  PROVENANCE_REMEDY_LABELS,
} from "@/modules/provenance/view";

/**
 * What a paid action will be built on, before a founder buys it.
 *
 * ## Why this is not a badge
 *
 * The obvious build is a green tick over "everything is current", and it is the
 * wrong shape. On 2026-09-02 the analyzer version said v3 while the detector
 * behind it had been corrected, so a tick comparing v3 to v3 would have shown
 * green over exactly the evidence that was wrong — and the founder would have
 * had no way to see through it. A date and a version string are checkable; a
 * tick is a claim.
 *
 * So this draws the chain: each thing the action reads, when Vibe produced it,
 * and which reader produced it. The version strings are deliberately literal
 * rather than translated into "up to date" — they are the fact, and the whole
 * point is that the customer can see it rather than being told about it.
 *
 * ## One remedy, at the top of the chain
 *
 * Only `firstGap` offers an action, because everything below a broken link is
 * derived from it: replacing the third while the first is wrong buys a fresh
 * document built on the same mistake. A row of four buttons would invite
 * exactly that.
 */
const REMEDY_SECTION: Record<ProvenanceRemedy, WorkspaceSectionId> = {
  product_scan: "my-product",
  business_audit: "business-audit",
  opportunity_generation: "action-plan",
};

function LinkRow({ link }: { link: ActionProvenance["links"][number] }) {
  const produced = formatDate(link.producedAt);

  return (
    <li
      className="border-line-2 border-t py-2 first:border-t-0 first:pt-0"
      data-provenance-link={link.kind}
      data-provenance-state={link.state}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="text-fg-prose text-sm">{PROVENANCE_LINK_LABELS[link.kind]}</span>
        <span className="text-fg-meta text-xs tabular-nums">{produced ?? "—"}</span>
      </div>

      {/*
        The provenance itself, and only where a version is what decides
        currency. A derived document has an input identity rather than a
        version string, and inventing one for it would be the badge again.
      */}
      {link.producedBy !== null && (
        <p className="text-fg-meta mt-0.5 font-mono text-[0.65rem] break-all">
          {link.producedBy}
          {link.state !== "current" && link.runningNow !== null && (
            <>
              {" → "}
              {link.runningNow}
            </>
          )}
        </p>
      )}

      {link.reason !== null && (
        <p className="text-fg-muted mt-1 text-xs leading-relaxed">
          {PROVENANCE_REASONS[link.reason]}
        </p>
      )}
    </li>
  );
}

export function ProvenancePanel({
  provenance,
  projectId,
}: {
  provenance: ActionProvenance;
  projectId: string;
}) {
  if (provenance.links.length === 0) return null;

  const remedy = provenance.firstGap?.remedy ?? null;

  return (
    <section
      className="border-line-2 rounded-md border px-3 py-2"
      data-testid="provenance-panel"
      data-provenance-current={provenance.firstGap === null}
    >
      <h3 className="text-fg-meta text-[0.65rem] tracking-[0.12em] uppercase">
        What this will be built on
      </h3>

      <ul className="mt-2">
        {provenance.links.map((link) => (
          <LinkRow key={link.kind} link={link} />
        ))}
      </ul>

      {remedy !== null && (
        <div className="border-line-2 mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-2">
          <Link
            href={projectSectionHref(projectId, REMEDY_SECTION[remedy])}
            className="text-fg-prose hover:text-fg text-sm underline underline-offset-2"
            data-testid="provenance-remedy"
          >
            {PROVENANCE_REMEDY_LABELS[remedy]}
          </Link>
          {FREE_REMEDIES.includes(remedy) && (
            <span className="text-fg-meta text-[0.65rem] tracking-[0.12em] uppercase">Free</span>
          )}
        </div>
      )}
    </section>
  );
}
