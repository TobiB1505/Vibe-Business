"use client";

import { useEffect, useId, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { BusinessLens } from "@/modules/business-audit/schema";
import { cn } from "@/lib/utils/cn";
import type {
  BusinessBrainNode,
  BusinessBrainView,
} from "@/modules/projects/business-brain-view";

const VIEWBOX = { width: 780, height: 690 };
const CORE = { x: 390, y: 350 };

const NODE_POSITIONS: Record<BusinessLens, { x: number; y: number }> = {
  offer: { x: 390, y: 82 },
  audience: { x: 565, y: 145 },
  acquisition: { x: 662, y: 270 },
  conversion: { x: 660, y: 424 },
  revenue_economics: { x: 548, y: 555 },
  business_readiness: { x: 370, y: 596 },
  retention: { x: 190, y: 548 },
  measurement: { x: 112, y: 397 },
  scalability: { x: 162, y: 212 },
};

const NODE_GLYPHS: Record<BusinessLens, string> = {
  offer: "◇",
  audience: "◎",
  acquisition: "↗",
  conversion: "▽",
  revenue_economics: "$",
  business_readiness: "⬡",
  retention: "↻",
  measurement: "⌁",
  scalability: "□",
};

function relationPath(from: BusinessLens, to: BusinessLens): string {
  const a = NODE_POSITIONS[from];
  const b = NODE_POSITIONS[to];
  const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const control = {
    x: midpoint.x + (CORE.x - midpoint.x) * 0.32,
    y: midpoint.y + (CORE.y - midpoint.y) * 0.32,
  };
  return `M ${a.x} ${a.y} Q ${control.x} ${control.y} ${b.x} ${b.y}`;
}

function corePath(node: BusinessBrainNode): string {
  const at = NODE_POSITIONS[node.id];
  const bendX = CORE.x + (at.x - CORE.x) * 0.45;
  const bendY = CORE.y + (at.y - CORE.y) * 0.45;
  const perpendicular = node.id.length % 2 === 0 ? 18 : -18;
  return `M ${CORE.x} ${CORE.y} Q ${bendX + perpendicular} ${bendY - perpendicular} ${at.x} ${at.y}`;
}

function useDocumentVisible(): boolean {
  // False on the server keeps reduced-motion and signal markup hydration-safe.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  return visible;
}

function toneClasses(node: BusinessBrainNode, selected: boolean) {
  if (selected) {
    return "border-mint/85 bg-[#0b1715] shadow-[0_0_42px_-12px_rgb(0_229_160/0.8)]";
  }
  if (node.health === "weak") {
    return "border-coral/45 bg-[#171110] shadow-[0_0_34px_-18px_rgb(255_122_92/0.65)]";
  }
  if (node.health === "strong") {
    return "border-mint/45 bg-[#0a1513] shadow-[0_0_34px_-18px_rgb(0_229_160/0.55)]";
  }
  if (node.health === "adequate") return "border-amber/35 bg-[#15140e]";
  return "border-line-strong bg-[#0d1111]";
}

function statusTone(node: BusinessBrainNode): string {
  if (node.health === "strong") return "text-mint";
  if (node.health === "adequate") return "text-amber";
  if (node.health === "weak") return "text-coral";
  return "text-fg-muted";
}

function NodeButton({
  node,
  index,
  selected,
  related,
  dimmed,
  reducedMotion,
  onSelect,
  onHover,
}: {
  node: BusinessBrainNode;
  index: number;
  selected: boolean;
  related: boolean;
  dimmed: boolean;
  reducedMotion: boolean;
  onSelect: (id: BusinessLens) => void;
  onHover: (id: BusinessLens | null) => void;
}) {
  const at = NODE_POSITIONS[node.id];

  return (
    <motion.li
      className="business-brain-node absolute z-20"
      style={{
        left: `${(at.x / VIEWBOX.width) * 100}%`,
        top: `${(at.y / VIEWBOX.height) * 100}%`,
      }}
      initial={
        reducedMotion
          ? { opacity: 0, x: "-50%", y: "-50%" }
          : { opacity: 0, scale: 0.78, x: "-50%", y: "calc(-50% + 10px)" }
      }
      animate={{ opacity: dimmed ? 0.34 : 1, scale: 1, x: "-50%", y: "-50%" }}
      transition={{
        opacity: { duration: reducedMotion ? 0.08 : 0.24 },
        scale: {
          type: "spring",
          stiffness: 230,
          damping: 24,
          delay: reducedMotion ? 0 : 0.45 + index * 0.065,
        },
        y: {
          type: "spring",
          stiffness: 230,
          damping: 24,
          delay: reducedMotion ? 0 : 0.45 + index * 0.065,
        },
      }}
    >
      <motion.button
        type="button"
        layout
        aria-pressed={selected}
        aria-label={`${node.label}, not individually scored, ${node.healthLabel}, priority ${node.priorityLabel}`}
        onClick={() => onSelect(node.id)}
        onHoverStart={() => onHover(node.id)}
        onHoverEnd={() => onHover(null)}
        onFocus={() => onHover(node.id)}
        onBlur={() => onHover(null)}
        whileHover={reducedMotion ? undefined : { scale: 1.06, y: -3 }}
        whileFocus={reducedMotion ? undefined : { scale: 1.035 }}
        whileTap={reducedMotion ? undefined : { scale: 0.985 }}
        transition={{ type: "spring", stiffness: 360, damping: 24 }}
        className={cn(
          "group relative flex w-[7.35rem] cursor-pointer flex-col items-center rounded-[1.05rem] border px-3 py-3 text-center outline-none",
          "focus-visible:ring-mint focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-app",
          toneClasses(node, selected),
          related && !selected &&
            "border-mint/55 shadow-[0_0_30px_-16px_rgb(0_229_160/0.62)]",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "mb-1.5 flex size-6 items-center justify-center text-lg leading-none",
            selected || related ? "text-mint" : statusTone(node),
          )}
        >
          {NODE_GLYPHS[node.id]}
        </span>
        <span className="text-fg text-[0.79rem] leading-[1.15] font-semibold tracking-[-0.015em]">
          {node.label}
        </span>
        <span className={cn("mt-1.5 text-[0.72rem] font-medium", statusTone(node))}>
          {node.healthLabel}
        </span>
        <span className="text-fg-meta mt-0.5 text-[0.63rem]">{node.priorityLabel}</span>
        {node.blockerRank !== null && (
          <span className="bg-coral text-app absolute -top-2 -right-2 flex size-5 items-center justify-center rounded-full text-[0.62rem] font-bold shadow-lg">
            {node.blockerRank}
          </span>
        )}
      </motion.button>
    </motion.li>
  );
}

function MobileBrain({
  view,
  selected,
  onSelect,
}: {
  view: BusinessBrainView;
  selected: BusinessLens | null;
  onSelect: (id: BusinessLens) => void;
}) {
  return (
    <div className="flex flex-col gap-6 md:hidden" data-testid="business-map-list">
      <div className="business-brain-mobile-core mx-auto flex size-44 flex-col items-center justify-center rounded-full text-center">
        <span className="text-fg text-5xl leading-none font-semibold tracking-[-0.05em]">
          {view.overall.score ?? "—"}
        </span>
        <span className="text-fg mt-2 text-sm font-semibold">Business Health</span>
        <span className="text-amber mt-2 text-xs">{view.overall.stateLabel}</span>
      </div>

      <div className="-mx-4 overflow-x-auto px-4 pb-2 [scrollbar-width:none]">
        <ul className="flex w-max snap-x gap-2.5" aria-label="Business dimensions">
          {view.nodes.map((node) => (
            <li key={node.id} className="w-40 snap-center">
              <button
                type="button"
                aria-pressed={selected === node.id}
                aria-label={`${node.label}, not individually scored, ${node.healthLabel}, priority ${node.priorityLabel}`}
                onClick={() => onSelect(node.id)}
                className={cn(
                  "border-line-2 bg-surface-2 flex min-h-32 w-full flex-col rounded-xl border p-4 text-left",
                  "focus-visible:ring-mint focus-visible:ring-2",
                  selected === node.id && "border-mint/60 bg-mint/[0.06]",
                )}
              >
                <span aria-hidden className="text-mint text-xl">
                  {NODE_GLYPHS[node.id]}
                </span>
                <span className="text-fg mt-3 text-sm font-semibold">{node.label}</span>
                <span className={cn("mt-auto pt-2 text-xs", statusTone(node))}>
                  {node.healthLabel}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-fg-muted text-center text-xs">
        Swipe through the nine business areas.
      </p>
    </div>
  );
}

export function BusinessMap({
  view,
  selected,
  hovered,
  onSelect,
  onHover,
}: {
  view: BusinessBrainView;
  selected: BusinessLens | null;
  hovered: BusinessLens | null;
  onSelect: (id: BusinessLens) => void;
  onHover: (id: BusinessLens | null) => void;
}) {
  const reducedMotion = Boolean(useReducedMotion());
  const visible = useDocumentVisible();
  const gradientId = useId().replace(/:/g, "");
  const active = hovered ?? selected;
  const related = new Set<BusinessLens>();
  if (active) {
    related.add(active);
    for (const relationship of view.relationships) {
      if (relationship.from === active || relationship.to === active) {
        related.add(relationship.from);
        related.add(relationship.to);
      }
    }
  }
  const selectedAt = selected ? NODE_POSITIONS[selected] : null;
  const focusOffset = selectedAt
    ? { x: (CORE.x - selectedAt.x) * 0.055, y: (CORE.y - selectedAt.y) * 0.045 }
    : { x: 0, y: 0 };

  return (
    <div className="min-w-0">
      <motion.div
        className="business-brain-canvas relative mx-auto hidden aspect-[780/690] w-full max-w-[57rem] md:block"
        data-testid="business-map-radial"
        animate={
          reducedMotion
            ? { opacity: 1 }
            : { x: focusOffset.x, y: focusOffset.y, scale: selected ? 1.012 : 1 }
        }
        transition={{ type: "spring", stiffness: 150, damping: 24 }}
      >
        <svg
          viewBox={`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`}
          className="pointer-events-none absolute inset-0 size-full overflow-visible"
          aria-hidden="true"
        >
          <defs>
            <radialGradient id={gradientId}>
              <stop offset="0" stopColor="var(--color-mint)" stopOpacity="0.18" />
              <stop offset="0.48" stopColor="var(--color-mint)" stopOpacity="0.045" />
              <stop offset="1" stopColor="var(--color-mint)" stopOpacity="0" />
            </radialGradient>
            <filter id={`${gradientId}-glow`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <motion.ellipse
            cx={CORE.x}
            cy={CORE.y}
            rx="330"
            ry="278"
            fill={`url(#${gradientId})`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: reducedMotion ? 0.08 : 0.35, delay: reducedMotion ? 0 : 0.15 }}
          />

          {[0, 1, 2].map((ring) => (
            <motion.ellipse
              key={ring}
              cx={CORE.x}
              cy={CORE.y}
              rx={190 + ring * 66}
              ry={150 + ring * 56}
              fill="none"
              stroke="var(--color-mint)"
              strokeOpacity={0.12 - ring * 0.025}
              strokeWidth="1"
              strokeDasharray={ring === 2 ? "3 8" : "2 12"}
              initial={reducedMotion ? { opacity: 0 } : { opacity: 0, pathLength: 0 }}
              animate={{ opacity: 1, pathLength: 1 }}
              transition={{
                duration: reducedMotion ? 0.08 : 0.75,
                delay: reducedMotion ? 0 : 0.15 + ring * 0.08,
              }}
            />
          ))}

          {view.nodes.map((node, index) => {
            const isActive = active === node.id || related.has(node.id);
            return (
              <motion.path
                key={`core-${node.id}`}
                d={corePath(node)}
                fill="none"
                stroke={isActive ? "var(--color-mint)" : "var(--color-line-strong)"}
                strokeOpacity={active ? (isActive ? 0.56 : 0.07) : 0.22}
                strokeWidth={isActive ? 1.7 : 1}
                strokeDasharray={isActive ? "5 8" : "2 9"}
                initial={reducedMotion ? { opacity: 0 } : { opacity: 0, pathLength: 0 }}
                animate={{ opacity: 1, pathLength: 1 }}
                transition={{
                  duration: reducedMotion ? 0.08 : 0.62,
                  delay: reducedMotion ? 0 : 0.7 + index * 0.035,
                }}
              />
            );
          })}

          {view.relationships.map((relationship, index) => {
            const isActive = active === relationship.from || active === relationship.to;
            const dimmed = active !== null && !isActive;
            const d = relationPath(relationship.from, relationship.to);
            return (
              <g key={relationship.id}>
                <motion.path
                  d={d}
                  fill="none"
                  stroke={isActive ? "var(--color-mint)" : "var(--color-line-strong)"}
                  strokeOpacity={dimmed ? 0.06 : isActive ? 0.88 : 0.34}
                  strokeWidth={isActive ? 2.2 : 1.25}
                  initial={reducedMotion ? { opacity: 0 } : { opacity: 0, pathLength: 0 }}
                  animate={{ opacity: 1, pathLength: 1 }}
                  transition={{
                    duration: reducedMotion ? 0.08 : 0.7,
                    delay: reducedMotion ? 0 : 0.72 + index * 0.07,
                  }}
                />
                {!reducedMotion && visible && (isActive || (!active && index === 0)) && (
                  <motion.path
                    d={d}
                    fill="none"
                    stroke="var(--color-mint)"
                    strokeWidth={isActive ? 3 : 2}
                    strokeLinecap="round"
                    strokeDasharray="1 30"
                    filter={`url(#${gradientId}-glow)`}
                    initial={{ strokeDashoffset: 0, opacity: 0 }}
                    animate={{ strokeDashoffset: -180, opacity: isActive ? 0.9 : 0.42 }}
                    transition={{
                      strokeDashoffset: {
                        duration: isActive ? 1.8 : 7.5,
                        repeat: Infinity,
                        ease: "linear",
                      },
                      opacity: { duration: 0.2 },
                    }}
                  />
                )}
              </g>
            );
          })}
        </svg>

        <motion.div
          className="business-brain-core pointer-events-none absolute top-1/2 left-1/2 z-10 flex size-44 flex-col items-center justify-center rounded-full text-center"
          initial={
            reducedMotion
              ? { opacity: 0, x: "-50%", y: "-50%" }
              : { opacity: 0, scale: 0.72, x: "-50%", y: "-50%" }
          }
          animate={
            reducedMotion || !visible
              ? { opacity: 1, scale: 1, x: "-50%", y: "-50%" }
              : { opacity: 1, scale: [1, 1.018, 1], x: "-50%", y: "-50%" }
          }
          transition={
            reducedMotion
              ? { duration: 0.08 }
              : {
                  opacity: { duration: 0.45, delay: 0.3 },
                  scale: { duration: 6.8, delay: 0.3, repeat: Infinity, ease: "easeInOut" },
                }
          }
        >
          <span className="text-fg text-[3.35rem] leading-none font-semibold tracking-[-0.06em] tabular-nums">
            {view.overall.score ?? "—"}
          </span>
          <span className="text-fg mt-2 text-sm font-semibold">Business Health</span>
          <span
            className={cn(
              "mt-2 rounded-full px-3 py-1 text-[0.7rem] font-medium",
              view.overall.state === "weak"
                ? "bg-amber/10 text-amber"
                : "bg-mint/10 text-mint",
            )}
          >
            {view.overall.stateLabel}
          </span>
        </motion.div>

        <ul className="contents" aria-label="Business dimensions">
          {view.nodes.map((node, index) => (
            <NodeButton
              key={node.id}
              node={node}
              index={index}
              selected={selected === node.id}
              related={active !== null && related.has(node.id)}
              dimmed={active !== null && !related.has(node.id)}
              reducedMotion={reducedMotion}
              onSelect={onSelect}
              onHover={onHover}
            />
          ))}
        </ul>
      </motion.div>

      <MobileBrain view={view} selected={selected} onSelect={onSelect} />
    </div>
  );
}
