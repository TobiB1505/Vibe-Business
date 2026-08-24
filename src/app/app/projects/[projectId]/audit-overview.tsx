import type { BusinessBrainView } from "@/modules/projects/business-brain-view";
import { AuditIntelligence } from "./business-brain/audit-intelligence";

/** The signature Business Health surface, fed only by its dedicated view model. */
export function AuditOverview({
  view,
  movesHref,
  hasMoves,
}: {
  view: BusinessBrainView;
  movesHref: string;
  hasMoves: boolean;
}) {
  return <AuditIntelligence view={view} movesHref={movesHref} hasMoves={hasMoves} />;
}
