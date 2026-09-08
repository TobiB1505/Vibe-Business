"use client";

import { useState } from "react";
import { BusinessMap } from "@/app/app/projects/[projectId]/business-brain/business-map";
import { FindingCard } from "@/components/system/finding-card";
import type { BusinessLens } from "@/modules/business-audit/schema";
import type { BusinessBrainView } from "@/modules/projects/business-brain-view";

/**
 * The audit reading, as a render block's body.
 *
 * ## What this used to be, and why that was wrong
 *
 * A hand-drawn SVG: nine dots on three rings, laid out from the domain's own
 * `ring` and `angle`. It looked defensible and it was the exact failure the
 * render block exists to prevent — a second UI for the same fact. It had
 * already drifted, too, and in the way that is hardest to notice: the shipped
 * map does **not** use `ring` and `angle`. It places the nine areas from a
 * table of its own. So two maps of one business put the areas in two different
 * places, and nothing would have caught it.
 *
 * ## What it is now
 *
 * Two shipped components and no geometry.
 *
 * `BusinessMap` with `variant="block"`, which renders the compact layout the
 * file already had for a phone — the score, the coverage line, and the nine
 * areas as the same planets the radial map draws. Change the map and this
 * changes; there is nothing here to keep in step.
 *
 * `FindingCard` for the leading blocker, which is a Vibe semantic component
 * and never replaced by a generic equivalent. It already knows that a priority
 * leads with what it costs rather than with what it is, which is a decision
 * this file would otherwise have had to make again and would have got wrong.
 *
 * ## The one thing the block still decides
 *
 * How much of the stack to show: the first blocker, and a count of the rest.
 * The audit page reads the whole ranked stack because a founder opened it to
 * read it. A thread block is a glance, and the count is what sends them.
 */
export function AuditBlock({ view }: { view: BusinessBrainView }) {
  /*
    Selection is local and goes nowhere. The map is interactive by nature and
    the block has no detail column to put a selected area into — so a press
    highlights and nothing else. A block that swallowed a click silently would
    be worse; a block that opened a panel would be the audit page, badly.
  */
  const [selected, setSelected] = useState<BusinessLens | null>(null);
  const priority = view.primaryPriority;

  return (
    <div className="flex flex-col gap-5">
      <BusinessMap
        view={view}
        variant="block"
        selected={selected}
        onSelect={(lens) => setSelected((current) => (current === lens ? null : lens))}
      />

      {priority && (
        <FindingCard
          variant="priority"
          rank={priority.rank}
          title={priority.headline}
          whyItMatters={priority.whyItMatters}
          /* A priority is read for consequence; the diagnosis is the follow-up.
             The component owns that ordering, and passing it here would be
             restating a decision it already made. */
          lead="why"
        />
      )}

      {view.additionalPriorityCount > 0 && (
        <p className="text-caption text-fg-meta">
          and {view.additionalPriorityCount} more{" "}
          {view.additionalPriorityCount === 1 ? "blocker" : "blockers"}
        </p>
      )}
    </div>
  );
}
