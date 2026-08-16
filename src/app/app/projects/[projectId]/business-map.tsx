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
 * A circle cannot be read by a screen reader, cannot be tabbed through, and
 * stops being legible somewhere around a phone. So the map is drawn as an
 * `aria-hidden` decoration over a real list: the list is the interface, the
 * circle is a way of seeing it (§18, §52). Everything the map communicates —
 * area, health, priority, what it connects to — is a button with text in it.
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

/** Outward, as a fraction of the map radius. */
const RING_RADIUS: Record<MapRing, number> = {
  now: 0.34,
  soon: 0.63,
  later: 0.9,
};

const VIEWBOX = 620;
const CENTRE = VIEWBOX / 2;
const RADIUS = VIEWBOX / 2 - 46;

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
    <span className="flex gap-[2px]" aria-hidden="true">
      {[0, 1, 2, 3].map((index) => (
        <span
          key={index}
          className={`h-2.5 w-[3px] rounded-[1px] ${index < filled ? tone : "bg-line-3"} ${
            filled === 0 ? "opacity-40" : ""
          }`}
        />
      ))}
    </span>
  );
}

function LensButton({
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
      className={`rounded-panel flex w-full items-center gap-3 border px-3 py-2.5 text-left transition-colors ${
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

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={`truncate text-sm ${isNow ? "text-fg" : "text-fg-body"}`}>
          {node.label}
        </span>
        <span className="text-fg-meta flex items-center gap-1.5 font-mono text-[0.625rem]">
          <HealthBar health={node.health} />
          {HEALTH_LABELS[node.health]}
          <span aria-hidden="true">·</span>
          {MATERIALITY_LABELS[node.materiality]}
        </span>
      </span>
    </button>
  );
}

export function BusinessMap({
  map,
  selected,
  onSelect,
}: {
  map: BusinessMapModel;
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
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
      {/*
        Decoration over the list below, never the only representation. Hidden
        from assistive technology on purpose: everything it draws is a real
        button a few lines down (§18).
      */}
      <div
        aria-hidden="true"
        className="relative mx-auto hidden w-full max-w-[34rem] shrink-0 lg:block"
      >
        <svg viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`} className="h-auto w-full">
          <defs>
            <radialGradient id={glowId}>
              <stop offset="0%" stopColor="var(--color-mint)" stopOpacity="0.1" />
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
              stroke="var(--color-line-2)"
              strokeDasharray={ring === "now" ? undefined : "3 6"}
            />
          ))}

          {map.connections.map((edge) => {
            const from = map.nodes.find((node) => node.lens === edge.from);
            const to = map.nodes.find((node) => node.lens === edge.to);
            if (!from || !to) return null;
            const a = position(from);
            const b = position(to);
            const active = highlighted?.has(edge.from) && highlighted.has(edge.to);

            return (
              <line
                key={`${edge.from}-${edge.to}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={active ? "var(--color-mint)" : "var(--color-line-4)"}
                strokeOpacity={active ? 0.5 : 0.35}
              />
            );
          })}

          {map.nodes.map((node) => {
            const { x, y } = position(node);
            const isNow = node.ring === "now";
            const dimmed = highlighted !== null && !highlighted.has(node.lens) && node.lens !== selected;

            return (
              <g key={node.lens} opacity={dimmed ? 0.35 : 1}>
                {isNow && (
                  <circle cx={x} cy={y} r={22} fill="var(--color-mint)" fillOpacity={0.08} />
                )}
                <circle
                  cx={x}
                  cy={y}
                  r={node.lens === selected ? 9 : 6}
                  fill={isNow ? "var(--color-mint)" : "var(--color-fg-disabled)"}
                />
                <text
                  x={x}
                  y={y + 26}
                  textAnchor="middle"
                  className="fill-fg-secondary font-mono text-[13px]"
                >
                  {node.label}
                </text>
              </g>
            );
          })}

          <text
            x={CENTRE}
            y={CENTRE - 4}
            textAnchor="middle"
            className="fill-fg-meta font-mono text-[11px] tracking-[0.18em]"
          >
            CLOSER TO CENTRE
          </text>
          <text
            x={CENTRE}
            y={CENTRE + 14}
            textAnchor="middle"
            className="fill-fg-meta font-mono text-[11px] tracking-[0.18em]"
          >
            = SOONER
          </text>
        </svg>
      </div>

      {/*
        The interface. Grouped by when each area matters, which is the same
        information architecture the circle draws — and the only one that
        survives a phone or a screen reader.
      */}
      <div className="flex min-w-0 flex-1 flex-col gap-5">
        {groups.map((group) => (
          <section key={group.ring} className="flex flex-col gap-2">
            <h3
              className={`font-mono text-[0.6875rem] tracking-[0.14em] uppercase ${
                group.ring === "now" ? "text-mint" : "text-fg-meta"
              }`}
            >
              {RING_LABELS[group.ring]}
            </h3>
            <ul className="flex flex-col gap-1.5">
              {group.nodes.map((node) => (
                <li key={node.lens}>
                  <LensButton
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
