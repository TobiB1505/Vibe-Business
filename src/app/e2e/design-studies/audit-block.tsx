import { scoreDisplay } from "@/components/ui/score-display";
import type {
  BusinessBrainNode,
  BusinessBrainView,
} from "@/modules/projects/business-brain-view";

/**
 * The audit reading, as a render block's body.
 *
 * ## Why this is not the Business Brain page, shrunk
 *
 * That page is a 780×690 solar system with stars behind it, and it is right
 * there: a founder who has opened the map came to read the map. A block in a
 * thread is a different job — it is the smallest picture that says *this
 * happened and here is what it found*, with a control beside it to the real
 * thing. Shrinking the page would produce nine unreadable planets and a
 * scrollbar.
 *
 * ## The geometry is the domain's
 *
 * `BusinessBrainNode` carries `ring` and `angle`, computed in
 * `map-view.ts` — the same two values the full map lays out from. Inventing a
 * second arrangement here would mean a founder who looked at both saw two
 * different businesses.
 *
 * ## What it refuses to draw
 *
 * A `null` score is an em dash and never a zero, never an empty ring and never
 * a red one (rule 44). An audit that could not be scored has not scored badly,
 * and the block says the reason instead of colouring a non-answer.
 */

const RING_RADIUS: Record<BusinessBrainNode["ring"], number> = {
  now: 30,
  soon: 46,
  later: 60,
};

function dotFor(node: BusinessBrainNode): string {
  if (node.score === null) return "fill-fg-disabled";
  if (node.health === "strong") return "fill-mint";
  if (node.health === "adequate") return "fill-amber";
  return "fill-coral";
}

function position(node: BusinessBrainNode): { x: number; y: number } {
  const radians = (node.angle * Math.PI) / 180;
  const radius = RING_RADIUS[node.ring];
  return { x: 70 + radius * Math.cos(radians), y: 70 + radius * Math.sin(radians) };
}

export function AuditBlock({ view }: { view: BusinessBrainView }) {
  const score = scoreDisplay(view.overall.score, { unscoredText: "—" });
  const points = new Map(view.nodes.map((node) => [node.id, position(node)]));

  return (
    <div className="flex flex-wrap items-start gap-5">
      <svg
        viewBox="0 0 140 140"
        className="size-[140px] shrink-0"
        role="img"
        aria-label={`Nine business areas, ${view.overall.stateLabel}`}
      >
        {/* The three orbits, so the rings are legible as rings rather than as
            three arbitrary distances from the middle. */}
        {Object.values(RING_RADIUS).map((radius) => (
          <circle
            key={radius}
            cx="70"
            cy="70"
            r={radius}
            className="fill-none stroke-line-2"
            strokeWidth="1"
          />
        ))}

        {/* What the audit judged together. Its own relationships, not a mesh
            drawn between everything for the look of it. */}
        {view.relationships.map((relationship) => {
          const from = points.get(relationship.from);
          const to = points.get(relationship.to);
          if (!from || !to) return null;
          return (
            <line
              key={relationship.id}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              className="stroke-line-2"
              strokeWidth="1"
            />
          );
        })}

        {view.nodes.map((node) => {
          const point = points.get(node.id);
          if (!point) return null;
          return (
            <circle
              key={node.id}
              cx={point.x}
              cy={point.y}
              /* The blocker the audit ranked first is the only one drawn
                 larger. A size scale over nine dots would be a ranking this
                 block is not entitled to make. */
              r={node.blockerRank === 1 ? 5.5 : 4}
              className={dotFor(node)}
            />
          );
        })}
      </svg>

      <div className="flex min-w-[16rem] flex-1 flex-col gap-2.5">
        <div className="flex items-baseline gap-2">
          <span className="text-headline font-semibold tabular-nums text-fg">{score.text}</span>
          <span className="text-caption text-fg-meta">/ 100</span>
          <span className="ml-auto text-caption text-fg-prose">{view.overall.stateLabel}</span>
        </div>

        {/* The reason a score is absent, which the Brain used to render as an
            em dash with the explanation left unread. */}
        {view.overall.score === null && view.overall.insufficientCoverageReason && (
          <p className="text-caption text-fg-secondary">
            {view.overall.insufficientCoverageReason}
          </p>
        )}

        {view.primaryPriority && (
          <div className="flex flex-col gap-1 border-t border-line-1 pt-2.5">
            <p className="text-ui text-fg">{view.primaryPriority.headline}</p>
            {view.primaryPriority.whyItMatters && (
              <p className="text-caption text-fg-secondary">
                {view.primaryPriority.whyItMatters}
              </p>
            )}
          </div>
        )}

        {view.additionalPriorityCount > 0 && (
          <p className="text-caption text-fg-meta">
            and {view.additionalPriorityCount} more{" "}
            {view.additionalPriorityCount === 1 ? "blocker" : "blockers"}
          </p>
        )}

        {/*
          What the reading rests on. Counts the audit itself recorded — never a
          confidence percentage, which is the number this row would most like
          to invent.
        */}
        <p className="font-mono text-caption text-fg-meta">
          {view.signalCount} signals · {view.sourceCount}{" "}
          {view.sourceCount === 1 ? "source" : "sources"}
        </p>
      </div>
    </div>
  );
}
