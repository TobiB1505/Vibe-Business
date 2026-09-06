import type { BusinessBrainView } from "@/modules/projects/business-brain-view";
import type { IntelligenceCrossCheck } from "@/modules/repository-intelligence/cross-check";
import { AuditIntelligence } from "./business-brain/audit-intelligence";

/** The signature Business Health surface, fed only by its dedicated view model. */
export function AuditOverview({
  view,
  movesHref,
  hasMoves,
  contradictions = [],
}: {
  view: BusinessBrainView;
  movesHref: string;
  hasMoves: boolean;
  /** Where code and live product disagree. Empty when nothing was compared. */
  contradictions?: IntelligenceCrossCheck[];
}) {
  return (
    <AuditIntelligence
      view={view}
      movesHref={movesHref}
      hasMoves={hasMoves}
      contradictions={contradictions}
    />
  );
}
