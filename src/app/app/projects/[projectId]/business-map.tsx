"use client";

import { useId } from "react";
import {
  HEALTH_LABELS,
  MATERIALITY_LABELS,
  lensesByRing,
  type BusinessMap as BusinessMapModel,
  type LensNode,
  type MapRing,
} from "@/modules/business-audit/map-view";
import type { BusinessLens } from "@/modules/business-audit/schema";

/**
 * The Business Map (AUDIT UI-1, direction 1b).
 *
 * ## The one idea
 *
 * Nine areas of a business as one connected system, and **distance from the
 * centre is when something matters** — not how bad it is. That separation is
 * the architecture CORE-2a.3.1 spent a sprint building, made visible: a weak
 * area sitting quietly in the outer ring is the picture of "real, and not your
 * problem this month".
 *
 * ## Why the geometry is not the interface
 *
 * A circle cannot be read by a screen reader, and stops being legible
 * somewhere around a phone. The desktop nodes are therefore real, labelled
 * buttons over an aria-hidden SVG; on a phone those same judgments become the
 * grouped list below. Geometry is never the only interface (§18, §52).
 *
 * That also solves mobile without a second component: below the breakpoint the
 * circle is simply not rendered, and the same list groups itself under Now,
 * Soon and Later (§17, §46, §64).
 *
 * ## Colour never carries meaning alone
 *
 * Mint means Vibe's attention, never "healthy" (§4, §7). Health is a word and
 * a bar; priority is a ring and a word. Neither is a hue on its own.
 */

const RING_LABELS: Record<MapRing, string> = {
  now: "Needs attention now",
  soon: "Soon",
  later: "Later",
};

/**
 * Outward, as a fraction of the map radius.
 *
 * Pushed out in UI-1.2 (§2), and the numbers are not taste.
 *
 * Nine lenses sit at fixed angles 40° apart, so two cards on one ring are
 * `2r·sin20°` apart along the chord — but they only overlap when they are close
 * on *both* axes, so the binding constraint is the pair whose separation splits
 * evenly between x and y. At the radii this shipped with, that pair's clearance
 * was negative and the Now ring overlapped itself on every audit.
 *
 * Which lenses land on which ring changes between audits, so these were chosen
 * to clear the worst arrangement the data can produce — all nine lenses on one
 * ring — rather than the arrangement in one fixture. That is also what the
 * browser test asserts, because none of this is visible to a unit test: the
 * view model was right the whole time and the geometry lives in CSS.
 */
const RING_RADIUS: Record<MapRing, number> = {
  now: 0.66,
  soon: 0.8,
  later: 0.98,
};

const VIEWBOX = 760;
const CENTRE = VIEWBOX / 2;
const RADIUS = VIEWBOX / 2 - 54;


/**
 * Where a ring's name can sit without a card on top of it.
 *
 * Two wrong answers preceded this one, and both are worth keeping. A fixed
 * bearing was clear for Soon and Later and buried Now, because Conversion
 * happens to be a Now lens sitting almost exactly there — and which lenses land
 * on which ring is the thing that changes between audits. Avoiding only the
 * nodes *on the same ring* then failed too: the rings are about 60px apart and
 * a lens card is wider than that, so a neighbouring ring's card reaches across.
 *
 * So every node counts, whatever its ring. The nine sit evenly, which leaves
 * midpoints 20° from their neighbours — ample clearance at these radii — and
 * the downward tie-break puts all three labels on one vertical, reading near to
 * far like an axis.
 */
function labelBearing(map: BusinessMapModel): number {
  const occupied = map.nodes.map((node) => node.angle);
  if (occupied.length === 0) return 180;

  let best = 180;
  let bestGap = -1;

  for (let bearing = 0; bearing < 360; bearing += 10) {
    const gap = Math.min(
      ...occupied.map((angle) => {
        const delta = Math.abs(((bearing - angle) % 360) + 360) % 360;
        return Math.min(delta, 360 - delta);
      }),
    );
    /*
     * Ties break to the left (§2). Nine evenly spaced nodes leave nine equal
     * gaps, so the tie-break is what actually chooses — and the left flank is
     * the far side from the priorities column, which keeps the axis away from
     * the densest reading on the panel.
     */
    if (gap > bestGap || (gap === bestGap && Math.abs(bearing - 180) < Math.abs(best - 180))) {
      bestGap = gap;
      best = bearing;
    }
  }

  return best;
}

function position(node: LensNode): { x: number; y: number } {
  const radians = (node.angle * Math.PI) / 180;
  const distance = RADIUS * RING_RADIUS[node.ring];
  return { x: CENTRE + Math.cos(radians) * distance, y: CENTRE + Math.sin(radians) * distance };
}

/**
 * Health as four filled segments.
 *
 * Deliberately the same device the audit report uses, and deliberately *not*
 * colour alone: the bar is readable in greyscale and the word sits beside it.
 */
function HealthBar({ health }: { health: LensNode["health"] }) {
  const filled = { strong: 4, adequate: 3, weak: 1, unclear: 0, blocked_by_missing_context: 0 }[
    health
  ];
  const tone =
    health === "strong"
      ? "bg-fg"
      : health === "adequate"
        ? "bg-amber"
        : health === "weak"
          ? "bg-coral"
          : "bg-fg-disabled";

  return (
    <span className="flex gap-[3px]" aria-hidden="true">
      {[0, 1, 2, 3].map((index) => (
        <span
          key={index}
          className={`h-1 w-3 rounded-full ${index < filled ? tone : "bg-line-3"} ${
            filled === 0 ? "opacity-40" : ""
          }`}
        />
      ))}
    </span>
  );
}

function MobileLensButton({
  node,
  selected,
  onSelect,
}: {
  node: LensNode;
  selected: boolean;
  onSelect: (lens: BusinessLens) => void;
}) {
  const isNow = node.ring === "now";

  return (
    <button
      type="button"
      onClick={() => onSelect(node.lens)}
      aria-pressed={selected}
      className={`rounded-panel flex w-full items-center gap-3 border px-4 py-3.5 text-left transition-interactive ${
        selected
          ? "border-mint/60 bg-mint/[0.06]"
          : isNow
            ? "border-mint/25 bg-surface-3 hover:border-mint/45"
            : "border-line-2 bg-surface-1 hover:border-line-4"
      }`}
    >
      {node.blockerRank !== null && (
        <span
          className={`flex size-5 shrink-0 items-center justify-center rounded-full font-mono text-[0.625rem] ${
            isNow ? "bg-mint text-mint-ink" : "bg-surface-4 text-fg-secondary"
          }`}
        >
          {node.blockerRank}
        </span>
      )}

      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className={`text-[0.9375rem] font-medium ${isNow ? "text-fg" : "text-fg-body"}`}>
          {node.label}
        </span>
        <span className="text-fg-meta flex flex-wrap items-center gap-2 font-mono text-[0.625rem] uppercase">
          <HealthBar health={node.health} />
          {HEALTH_LABELS[node.health]}
          <span aria-hidden="true">·</span>
          {MATERIALITY_LABELS[node.materiality]}
        </span>
      </span>
    </button>
  );
}

function MapNode({
  node,
  selected,
  dimmed,
  onSelect,
}: {
  node: LensNode;
  selected: boolean;
  dimmed: boolean;
  onSelect: (lens: BusinessLens) => void;
}) {
  const { x, y } = position(node);
  const isNow = node.ring === "now";
  const isSoon = node.ring === "soon";

  return (
    <li
      className={`absolute z-10 -translate-x-1/2 -translate-y-1/2 transition-opacity duration-200 ${
        /*
           Softened from 30% once a lens opens by default.
           Selection is now the arrival state, so the map would otherwise
           always be seen with eight of nine areas faded — the emphasis has to
           come from the mint on the selected node and its connections, not
           from making everything else hard to read.
         */
        dimmed ? "opacity-65" : "opacity-100"
      }`}
      style={{ left: `${(x / VIEWBOX) * 100}%`, top: `${(y / VIEWBOX) * 100}%` }}
    >
      {isNow && (
        <span
          aria-hidden="true"
          className={`audit-map-node-halo pointer-events-none absolute top-1/2 left-1/2 size-32 -translate-x-1/2 -translate-y-1/2 rounded-full ${
            selected ? "opacity-100" : "opacity-60"
          }`}
        />
      )}
      <button
        type="button"
        onClick={() => onSelect(node.lens)}
        aria-pressed={selected}
        aria-label={`${node.label}. Health ${HEALTH_LABELS[node.health]}. Priority ${MATERIALITY_LABELS[node.materiality]}.`}
        className={`relative flex flex-col text-left transition-[color,background-color,border-color,box-shadow,transform] duration-200 ease-vibe ${
          isNow
            ? "w-[5.75rem] gap-2 rounded-[0.8rem] border border-mint/45 bg-app/95 px-2 py-2.5 shadow-[0_0_34px_-14px_rgb(0_229_160/0.65)] hover:-translate-y-0.5 hover:border-mint/70"
            : isSoon
              ? "border-line-strong bg-app/95 w-[5.75rem] gap-1.5 rounded-[0.7rem] border px-2 py-2 hover:border-white/20"
              : "border-line-2 bg-app/90 w-[5.5rem] gap-1.5 rounded-[0.65rem] border px-2 py-1.5 hover:border-line-strong"
        } ${selected ? "border-mint! bg-mint-tint-soft shadow-[0_0_42px_-12px_rgb(0_229_160/0.75)]" : ""}`}
      >
        <span className="flex w-full items-start gap-2">
          {node.blockerRank !== null && (
            <span
              className={`mt-px flex size-5 shrink-0 items-center justify-center rounded-sm font-mono text-[0.625rem] font-bold ${
                isNow ? "bg-mint text-mint-ink" : "bg-surface-4 text-fg-secondary"
              }`}
            >
              {node.blockerRank}
            </span>
          )}
          <span
            className={`min-w-0 leading-[1.2] font-semibold tracking-[-0.015em] ${
              isNow
                ? "text-fg text-[0.875rem]"
                : isSoon
                  ? "text-fg-body text-ui"
                  : "text-fg-secondary text-[0.75rem]"
            }`}
          >
            {node.label}
          </span>
        </span>

        <span className="flex w-full flex-col gap-1.5">
          <HealthBar health={node.health} />
          <span
            className={`flex items-center justify-between gap-2 font-mono text-[0.5625rem] tracking-[0.09em] uppercase ${
              isNow ? "text-fg-secondary" : "text-fg-meta"
            }`}
          >
            <span>{HEALTH_LABELS[node.health]}</span>
            <span className={isNow ? "text-mint" : undefined}>
              {MATERIALITY_LABELS[node.materiality]}
            </span>
          </span>
        </span>
      </button>
    </li>
  );
}

export function BusinessMap({
  map,
  score,
  selected,
  onSelect,
}: {
  map: BusinessMapModel;
  score: number | null;
  selected: BusinessLens | null;
  onSelect: (lens: BusinessLens) => void;
}) {
  const glowId = useId();
  const groups = lensesByRing(map);

  const highlighted = selected
    ? new Set(
        map.connections
          .filter((edge) => edge.from === selected || edge.to === selected)
          .flatMap((edge) => [edge.from, edge.to]),
      )
    : null;

  return (
    <div className="min-w-0">
      {/*
        Lines and rings are decoration. Every node over them is a real button,
        while mobile swaps the whole geometry for the grouped list (§18).
      */}
      <div
        className="relative mx-auto hidden aspect-square w-full max-w-[39rem] md:block"
        data-testid="business-map-radial"
      >
        <svg
          viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
          className="pointer-events-none absolute inset-0 h-full w-full"
          aria-hidden="true"
        >
          <defs>
            <radialGradient id={glowId}>
              <stop offset="0%" stopColor="var(--color-mint)" stopOpacity="0.16" />
              <stop offset="62%" stopColor="var(--color-mint)" stopOpacity="0" />
            </radialGradient>
          </defs>

          <circle cx={CENTRE} cy={CENTRE} r={RADIUS} fill={`url(#${glowId})`} />

          {(["later", "soon", "now"] as const).map((ring) => (
            <circle
              key={ring}
              cx={CENTRE}
              cy={CENTRE}
              r={RADIUS * RING_RADIUS[ring]}
              fill="none"
              stroke={ring === "now" ? "var(--color-mint)" : "var(--color-line-strong)"}
              strokeOpacity={ring === "now" ? 0.24 : ring === "soon" ? 0.62 : 0.45}
              strokeDasharray={ring === "later" ? "4 7" : undefined}
            />
          ))}

          {/*
            The rings, named on the map itself.
            Three unlabelled circles are a claim the reader has to reverse-
            engineer. Placed straight down from the centre, which is the one
            bearing with no lens on it: the nine sit every 40° from twelve
            o'clock, so 190° very nearly *is* Business Readiness — the first
            attempt put "NOW" underneath that card. Downward also reads in the
            right order, near to far.
          */}
          {(["now", "soon", "later"] as const).map((ring) => {
            const at = labelBearing(map);
            /*
             * Halfway between this ring and the next one inward.
             *
             * Cards are centred *on* a ring, so the ring line is the one radius
             * guaranteed to be occupied — a label drawn there disappears under
             * whichever card is nearest, which is what kept happening to NOW.
             * The gap between two rings is the only band no card can sit in.
             */
            const inner = ring === "now" ? 0 : ring === "soon" ? RING_RADIUS.now : RING_RADIUS.soon;
            const r = (RADIUS * (RING_RADIUS[ring] + inner)) / 2;
            const radians = (at * Math.PI) / 180;
            return (
              <text
                key={`label-${ring}`}
                x={CENTRE + Math.cos(radians) * r}
                y={CENTRE + Math.sin(radians) * r + 4}
                textAnchor="middle"
                className={`font-mono text-[11px] tracking-[0.14em] ${
                  ring === "now" ? "fill-mint" : "fill-fg-meta"
                }`}
              >
                {ring.toUpperCase()}
              </text>
            );
          })}

          {map.nodes.map((node) => {
            const point = position(node);
            return (
              <line
                key={`spoke-${node.lens}`}
                x1={CENTRE}
                y1={CENTRE}
                x2={point.x}
                y2={point.y}
                stroke={node.ring === "now" ? "var(--color-mint)" : "var(--color-line-3)"}
                strokeOpacity={node.ring === "now" ? 0.22 : 0.34}
              />
            );
          })}

          {map.connections.map((edge) => {
            const from = map.nodes.find((node) => node.lens === edge.from);
            const to = map.nodes.find((node) => node.lens === edge.to);
            if (!from || !to) return null;
            const a = position(from);
            const b = position(to);
            const active = edge.from === selected || edge.to === selected;

            return (
              <line
                key={`${edge.from}-${edge.to}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                /*
                 * Visual QA finding: at `--color-line-4` (0.11 white) times a
                 * 0.52 stroke opacity, a resting connection resolves to about
                 * 5.7% white on a near-black ground — below what anyone
                 * notices. The rings survive that alpha because they are long
                 * smooth circles; these are short chords ending under opaque
                 * node cards, and they disappeared entirely in the 1440px
                 * capture.
                 *
                 * They carry direction 1b's central claim — that this is one
                 * connected system rather than nine cards — so they are now the
                 * strongest marks on the canvas rather than the faintest, at
                 * roughly double the rings' weight and still well short of the
                 * mint an active edge gets.
                 */
                stroke={active ? "var(--color-mint)" : "var(--color-line-strong)"}
                strokeOpacity={active ? 0.78 : 1}
                strokeWidth={active ? 1.8 : 1.2}
                strokeDasharray={active ? "6 8" : "3 6"}
                className={active ? "audit-map-connection-active" : undefined}
              />
            );
          })}

          <circle cx={CENTRE} cy={CENTRE} r="49" fill="var(--color-app)" fillOpacity="0.88" />
          <circle
            cx={CENTRE}
            cy={CENTRE}
            r="49"
            fill="none"
            stroke="var(--color-mint)"
            strokeOpacity="0.28"
            strokeWidth="2"
          />
        </svg>

        {/*
          The score belongs here rather than in a headline (§9). In the middle
          of the map it reads as one reading among nine areas — which is what it
          is — instead of answering a question the founder did not ask. The
          panel's own "closer to centre = sooner" caption carries the geometry,
          so the centre does not have to restate it.
        */}
        <div className="pointer-events-none absolute top-1/2 left-1/2 z-10 flex size-24 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full text-center">
          {score !== null ? (
            <>
              <span className="text-fg text-[1.75rem] leading-none font-semibold tracking-[-0.03em]">
                {score}
              </span>
              <span className="text-fg-meta mt-1 font-mono text-[0.5625rem] tracking-[0.14em] uppercase">
                readiness
              </span>
            </>
          ) : (
            // Not scored is not a score of zero (CLAUDE.md rule 44).
            <span className="text-fg-meta font-mono text-[0.5625rem] tracking-[0.14em] uppercase">
              not scored
            </span>
          )}
        </div>

        <ul className="contents" aria-label="Business lenses">
          {map.nodes.map((node) => {
            const dimmed =
              highlighted !== null && !highlighted.has(node.lens) && node.lens !== selected;
            return (
              <MapNode
                key={node.lens}
                node={node}
                selected={node.lens === selected}
                dimmed={dimmed}
                onSelect={onSelect}
              />
            );
          })}
        </ul>
      </div>

      {/*
        The legend, and it is not decoration.
        The map encodes two independent things at once — a bar for health, a
        distance for priority — and without a key the reader has to infer that
        from nine samples. Naming the health scale is also what keeps colour
        from carrying meaning alone (§4, §18, §52).

        The connection entry says "judged together", not the mockup's "holds
        up": the audit records which lenses share a root problem, never which
        one blocks which, and a directional word here would be the frontend
        inventing causality.
      */}
      <ul
        aria-hidden="true"
        className="text-fg-meta mx-auto mt-2 hidden max-w-[39rem] flex-wrap items-center justify-center gap-x-5 gap-y-2 font-mono text-[0.625rem] tracking-[0.1em] uppercase md:flex"
      >
        {(
          [
            ["strong", "bg-fg", 4],
            ["adequate", "bg-amber", 3],
            ["weak", "bg-coral", 1],
            ["unknown", "bg-fg-disabled", 0],
          ] as const
        ).map(([label, tone, filled]) => (
          <li key={label} className="flex items-center gap-1.5">
            <span className="flex gap-[2px]">
              {[0, 1, 2, 3].map((index) => (
                <span
                  key={index}
                  className={`h-2 w-[3px] rounded-[1px] ${
                    index < filled ? tone : "bg-line-3"
                  } ${filled === 0 ? "opacity-40" : ""}`}
                />
              ))}
            </span>
            {label}
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span className="border-line-strong w-4 border-t border-dashed" />
          judged together
        </li>
      </ul>

      {/*
        The interface. Grouped by when each area matters, which is the same
        information architecture the circle draws — and the only one that
        survives a phone or a screen reader.
      */}
      <div className="flex min-w-0 flex-col gap-6 md:hidden" data-testid="business-map-list">
        {groups.map((group) => (
          <section key={group.ring} className="flex flex-col gap-2">
            <h3
              id={`business-map-${glowId}-${group.ring}`}
              className={`font-mono text-meta tracking-[0.14em] uppercase ${
                group.ring === "now" ? "text-mint" : "text-fg-meta"
              }`}
            >
              {RING_LABELS[group.ring]}
            </h3>
            <ul
              className="flex flex-col gap-1.5"
              aria-labelledby={`business-map-${glowId}-${group.ring}`}
            >
              {group.nodes.map((node) => (
                <li key={node.lens}>
                  <MobileLensButton
                    node={node}
                    selected={node.lens === selected}
                    onSelect={onSelect}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

/** Exported for the detail panel, which shows the same bar beside the word. */
export { HealthBar };
