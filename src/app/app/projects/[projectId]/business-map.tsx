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

/** Outward, as a fraction of the map radius. NOW is intentionally substantial. */
const RING_RADIUS: Record<MapRing, number> = {
  now: 0.6,
  soon: 0.77,
  later: 0.96,
};

const VIEWBOX = 760;
const CENTRE = VIEWBOX / 2;
const RADIUS = VIEWBOX / 2 - 54;

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
      className={`rounded-panel flex w-full items-center gap-3 border px-4 py-3.5 text-left transition-colors ${
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
        dimmed ? "opacity-30" : "opacity-100"
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
            ? "w-[7.75rem] gap-2.5 rounded-[0.9rem] border border-mint/45 bg-app/95 px-3 py-3 shadow-[0_0_34px_-14px_rgb(0_229_160/0.65)] hover:-translate-y-0.5 hover:border-mint/70"
            : isSoon
              ? "border-line-strong bg-app/95 w-[8.25rem] gap-2 rounded-[0.8rem] border px-3 py-2.5 hover:border-white/20"
              : "border-line-2 bg-app/90 w-[7.75rem] gap-1.5 rounded-[0.7rem] border px-2.5 py-2 hover:border-line-strong"
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
                  ? "text-fg-body text-[0.8125rem]"
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
    <div className="min-w-0">
      {/*
        Lines and rings are decoration. Every node over them is a real button,
        while mobile swaps the whole geometry for the grouped list (§18).
      */}
      <div
        className="relative mx-auto hidden aspect-square w-full max-w-[43rem] md:block"
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

        <div className="pointer-events-none absolute top-1/2 left-1/2 z-10 flex size-24 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-1 rounded-full text-center">
          <span className="text-fg-secondary font-mono text-[0.5625rem] tracking-[0.14em] uppercase">
            closer
          </span>
          <span className="text-fg text-xs font-semibold">sooner</span>
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
        The interface. Grouped by when each area matters, which is the same
        information architecture the circle draws — and the only one that
        survives a phone or a screen reader.
      */}
      <div className="flex min-w-0 flex-col gap-6 md:hidden" data-testid="business-map-list">
        {groups.map((group) => (
          <section key={group.ring} className="flex flex-col gap-2">
            <h3
              id={`business-map-${glowId}-${group.ring}`}
              className={`font-mono text-[0.6875rem] tracking-[0.14em] uppercase ${
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
