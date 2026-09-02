"use client";

import { useId, useState, type CSSProperties } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { BusinessLens } from "@/modules/business-audit/schema";
import { useDocumentVisible } from "@/lib/client/use-document-visible";
import { cn } from "@/lib/utils/cn";
import type {
  BusinessBrainNode,
  BusinessBrainView,
} from "@/modules/projects/business-brain-view";

const VIEWBOX = { width: 780, height: 690 };
const CORE = { x: 390, y: 350 };

const NODE_POSITIONS: Record<BusinessLens, { x: number; y: number }> = {
  offer: { x: 390, y: 76 },
  audience: { x: 585, y: 140 },
  acquisition: { x: 690, y: 290 },
  conversion: { x: 685, y: 475 },
  revenue_economics: { x: 555, y: 600 },
  business_readiness: { x: 365, y: 612 },
  retention: { x: 175, y: 565 },
  measurement: { x: 90, y: 405 },
  scalability: { x: 175, y: 190 },
};

const STARS = [
  [52, 128, 1.2], [104, 86, 0.8], [177, 52, 1], [258, 95, 0.7], [332, 44, 1.2],
  [471, 66, 0.8], [548, 36, 1.1], [654, 82, 0.7], [730, 128, 1.3], [706, 206, 0.8],
  [64, 265, 0.8], [212, 286, 1.1], [306, 188, 0.7], [490, 214, 1], [602, 338, 0.7],
  [748, 370, 1], [60, 486, 1.2], [120, 582, 0.8], [244, 636, 1], [456, 652, 0.8],
  [630, 630, 1.2], [720, 548, 0.8], [508, 482, 0.7], [287, 498, 1], [382, 578, 0.7],
] as const;

type PlanetStyle = CSSProperties & {
  "--planet-rgb": string;
  "--planet-accent": string;
};

function planetStyle(node: BusinessBrainNode): PlanetStyle {
  if (node.health === "strong") {
    return { "--planet-rgb": "0 229 160", "--planet-accent": "var(--color-mint)" };
  }
  if (node.health === "adequate") {
    return { "--planet-rgb": "232 181 74", "--planet-accent": "var(--color-amber)" };
  }
  if (node.health === "weak") {
    return { "--planet-rgb": "255 122 92", "--planet-accent": "var(--color-coral)" };
  }
  return { "--planet-rgb": "149 146 138", "--planet-accent": "var(--color-fg-muted)" };
}

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
  const bendX = CORE.x + (at.x - CORE.x) * 0.46;
  const bendY = CORE.y + (at.y - CORE.y) * 0.46;
  const perpendicular = node.id.length % 2 === 0 ? 15 : -15;
  return `M ${CORE.x} ${CORE.y} Q ${bendX + perpendicular} ${bendY - perpendicular} ${at.x} ${at.y}`;
}

function statusTone(node: BusinessBrainNode): string {
  if (node.health === "strong") return "text-mint";
  if (node.health === "adequate") return "text-amber";
  if (node.health === "weak") return "text-coral";
  return "text-fg-muted";
}

export function BusinessLensIcon({
  lens,
  className,
}: {
  lens: BusinessLens;
  className?: string;
}) {
  const shared = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": true,
  };

  if (lens === "offer") {
    return <svg {...shared}><path d="M4 10h16v10H4zM3 7h18v3H3zM12 7v13M12 7H8.8a2.3 2.3 0 1 1 2.3-2.3L12 7Zm0 0h3.2a2.3 2.3 0 1 0-2.3-2.3L12 7Z" /></svg>;
  }
  if (lens === "audience") {
    return <svg {...shared}><circle cx="12" cy="7" r="3.2" /><path d="M5.5 20v-2.2a6.5 6.5 0 0 1 13 0V20" /></svg>;
  }
  if (lens === "acquisition") {
    return <svg {...shared}><path d="M7.2 7.2A6.8 6.8 0 1 0 18 9M16 4h4v4M20 4l-5.5 5.5" /><circle cx="9" cy="15" r="1" /></svg>;
  }
  if (lens === "conversion") {
    return <svg {...shared}><path d="M3.5 5h17l-6.6 7.5V19l-3.8-2v-4.5L3.5 5Z" /></svg>;
  }
  if (lens === "revenue_economics") {
    return <svg {...shared}><circle cx="12" cy="12" r="9" /><path d="M15.5 8.4c-.8-.8-2-1.3-3.5-1.3-1.9 0-3.3 1-3.3 2.4 0 3.8 7 1.4 7 5.3 0 1.5-1.5 2.5-3.7 2.5-1.6 0-3-.6-3.8-1.5M12 5.3v13.4" /></svg>;
  }
  if (lens === "business_readiness") {
    return <svg {...shared}><path d="m12 3 7 3v5.3c0 4.4-2.7 7.7-7 9.7-4.3-2-7-5.3-7-9.7V6l7-3Z" /><path d="m9 12 2 2 4-4" /></svg>;
  }
  if (lens === "retention") {
    return <svg {...shared}><path d="M19 8.2A8 8 0 0 0 5.6 6L4 8M5 16a8 8 0 0 0 13.4 2L20 16M4 4v4h4M20 20v-4h-4" /></svg>;
  }
  if (lens === "measurement") {
    return <svg {...shared}><path d="M4 19V5M4 19h16M7 15l4-4 3 2 5-6" /><circle cx="7" cy="15" r="1" /><circle cx="11" cy="11" r="1" /><circle cx="14" cy="13" r="1" /><circle cx="19" cy="7" r="1" /></svg>;
  }
  return <svg {...shared}><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="m4 7.5 8 4.5 8-4.5M12 12v9" /></svg>;
}

function scoreLabel(node: BusinessBrainNode): string {
  return node.score === null ? "not scored" : `score ${node.score} out of 100`;
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
      style={{ left: `${(at.x / VIEWBOX.width) * 100}%`, top: `${(at.y / VIEWBOX.height) * 100}%` }}
      initial={reducedMotion ? { opacity: 0, x: "-50%", y: "-50%" } : { opacity: 0, scale: 0.72, x: "-50%", y: "calc(-50% + 12px)" }}
      animate={{ opacity: dimmed ? 0.32 : 1, scale: 1, x: "-50%", y: "-50%" }}
      transition={{
        opacity: { duration: reducedMotion ? 0.08 : 0.24 },
        scale: { type: "spring", stiffness: 260, damping: 24, delay: reducedMotion ? 0 : 0.12 + index * 0.025 },
        y: { type: "spring", stiffness: 260, damping: 24, delay: reducedMotion ? 0 : 0.12 + index * 0.025 },
      }}
    >
      <motion.button
        type="button"
        aria-pressed={selected}
        aria-label={`${node.label}, ${scoreLabel(node)}, ${node.healthLabel}, priority ${node.priorityLabel}`}
        onClick={() => onSelect(node.id)}
        onHoverStart={() => onHover(node.id)}
        onHoverEnd={() => onHover(null)}
        onFocus={() => onHover(node.id)}
        onBlur={() => onHover(null)}
        whileHover={reducedMotion ? undefined : { scale: 1.065, y: -3 }}
        whileFocus={reducedMotion ? undefined : { scale: 1.035 }}
        whileTap={reducedMotion ? undefined : { scale: 0.985 }}
        transition={{ type: "spring", stiffness: 350, damping: 24 }}
        style={planetStyle(node)}
        data-selected={selected ? "true" : "false"}
        data-related={related ? "true" : "false"}
        data-priority={node.priority}
        className={cn(
          "business-brain-planet group relative flex cursor-pointer flex-col items-center justify-center rounded-full border text-center outline-none",
          "focus-visible:ring-mint focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-app",
          // Priority still changes halo and contrast, but never the spatial
          // footprint: every lens keeps the same orbit spacing and hit area.
          "size-[8.15rem]",
        )}
      >
        <BusinessLensIcon lens={node.id} className="business-brain-planet-icon size-6" />
        <span className="text-fg mt-1.5 max-w-[6.5rem] text-[0.72rem] leading-[1.1] font-semibold tracking-[-0.018em]">{node.label}</span>
        <span className="text-fg mt-1 text-[1.35rem] leading-none font-semibold tracking-[-0.04em] tabular-nums">{node.score ?? "—"}</span>
        <span className={cn("mt-1.5 flex items-center gap-1.5 text-[0.65rem] font-medium", statusTone(node))}>
          <span aria-hidden="true" className="business-brain-status-dot size-1.5 rounded-full" />
          {node.healthLabel}
        </span>
      </motion.button>
    </motion.li>
  );
}

function MobileBrain({ view, selected, onSelect }: {
  view: BusinessBrainView;
  selected: BusinessLens | null;
  onSelect: (id: BusinessLens) => void;
}) {
  return (
    <div className="flex flex-col gap-6 md:hidden" data-testid="business-map-list">
      <div className="business-brain-mobile-core mx-auto flex size-48 flex-col items-center justify-center rounded-full text-center">
        <span className="text-fg text-5xl leading-none font-semibold tracking-[-0.05em]">{view.overall.score ?? "—"}</span>
        <span className="text-fg mt-2 text-sm font-semibold">Business Health</span>
        <span className="text-amber mt-2 text-xs">{view.overall.stateLabel}</span>
      </div>

      <div className="-mx-4 overflow-x-auto px-4 pb-3">
        <ul className="flex w-max snap-x gap-3" aria-label="Business dimensions">
          {view.nodes.map((node) => (
            <li key={node.id} className="w-36 snap-center">
              <button
                type="button"
                aria-pressed={selected === node.id}
                aria-label={`${node.label}, ${scoreLabel(node)}, ${node.healthLabel}, priority ${node.priorityLabel}`}
                onClick={() => onSelect(node.id)}
                style={planetStyle(node)}
                data-selected={selected === node.id ? "true" : "false"}
                className="business-brain-planet flex size-36 cursor-pointer flex-col items-center justify-center rounded-full border text-center outline-none focus-visible:ring-2 focus-visible:ring-mint"
              >
                <BusinessLensIcon lens={node.id} className="business-brain-planet-icon size-6" />
                <span className="text-fg mt-2 max-w-28 text-xs font-semibold leading-tight">{node.label}</span>
                <span className="text-fg mt-1 text-xl font-semibold tabular-nums">{node.score ?? "—"}</span>
                <span className={cn("mt-1 text-[0.65rem]", statusTone(node))}>{node.healthLabel}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-fg-muted text-center text-xs">Swipe through the nine business areas.</p>
    </div>
  );
}

export function BusinessMap({
  view,
  selected,
  hovered: controlledHovered,
  onSelect,
  onHover,
}: {
  view: BusinessBrainView;
  selected: BusinessLens | null;
  hovered?: BusinessLens | null;
  onSelect: (id: BusinessLens) => void;
  onHover?: (id: BusinessLens | null) => void;
}) {
  const reducedMotion = Boolean(useReducedMotion());
  const visible = useDocumentVisible();
  // The production Business Brain owns hover locally. Keeping these optional
  // controlled props preserves the onboarding/marketing compositions without
  // making every pointer move rerender the surrounding audit panels.
  const [internalHovered, setInternalHovered] = useState<BusinessLens | null>(null);
  const hovered = controlledHovered === undefined ? internalHovered : controlledHovered;
  const setHovered = onHover ?? setInternalHovered;
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
  const activeNode = active ? view.nodes.find((node) => node.id === active) ?? null : null;
  const activeAccent = activeNode ? planetStyle(activeNode)["--planet-accent"] : "var(--color-mint)";

  return (
    <div className="min-w-0">
      <div
        className="business-brain-canvas relative mx-auto hidden aspect-[780/690] w-full max-w-[58rem] md:block"
        data-testid="business-map-radial"
      >
        <svg viewBox={`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`} className="pointer-events-none absolute inset-0 size-full overflow-visible" aria-hidden="true">
          <defs>
            <radialGradient id={gradientId}>
              <stop offset="0" stopColor="var(--color-mint)" stopOpacity="0.17" />
              <stop offset="0.46" stopColor="var(--color-mint)" stopOpacity="0.045" />
              <stop offset="1" stopColor="var(--color-mint)" stopOpacity="0" />
            </radialGradient>
            <filter id={`${gradientId}-glow`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          {/* Static depth does not need a JavaScript animation. Only an active,
              evidence-grounded relationship moves below. */}
          <ellipse cx={CORE.x} cy={CORE.y} rx="350" ry="300" fill={`url(#${gradientId})`} />

          {STARS.map(([cx, cy, radius], index) => (
            <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={radius} fill={index % 7 === 0 ? "var(--color-amber)" : "var(--color-mint)"} opacity={index % 4 === 0 ? 0.62 : 0.24} />
          ))}

          {[0, 1, 2, 3].map((ring) => (
            <ellipse key={ring} cx={CORE.x} cy={CORE.y} rx={150 + ring * 64} ry={122 + ring * 57} fill="none" stroke="var(--color-mint)" strokeOpacity={0.13 - ring * 0.022} strokeWidth="1" strokeDasharray={ring > 1 ? "2 9" : undefined} />
          ))}

          {view.nodes.map((node) => {
            const isActive = active === node.id || related.has(node.id);
            return (
              <path key={`core-${node.id}`} d={corePath(node)} fill="none" stroke={isActive ? activeAccent : "var(--color-line-strong)"} strokeOpacity={active ? (isActive ? 0.52 : 0.045) : 0.09} strokeWidth={isActive ? 1.7 : 1} strokeDasharray={isActive ? "5 8" : "2 10"} className="transition-[stroke,stroke-opacity,stroke-width] duration-200" />
            );
          })}

          {view.relationships.map((relationship) => {
            const isActive = active === relationship.from || active === relationship.to;
            const dimmed = active !== null && !isActive;
            const d = relationPath(relationship.from, relationship.to);
            return (
              <g key={relationship.id}>
                <path d={d} fill="none" stroke={isActive ? activeAccent : "var(--color-line-strong)"} strokeOpacity={dimmed ? 0.04 : isActive ? 0.82 : 0.2} strokeWidth={isActive ? 2.2 : 1.1} className="transition-[stroke,stroke-opacity,stroke-width] duration-200" />
                {!reducedMotion && visible && active && isActive && (
                  <motion.path data-business-signal="true" d={d} fill="none" stroke={isActive ? activeAccent : "var(--color-mint)"} strokeWidth={isActive ? 3 : 2} strokeLinecap="round" strokeDasharray="1 32" filter={`url(#${gradientId}-glow)`} initial={{ strokeDashoffset: 0, opacity: 0 }} animate={{ strokeDashoffset: -190, opacity: isActive ? 0.9 : 0.35 }} transition={{ strokeDashoffset: { duration: isActive ? 1.8 : 8, repeat: Infinity, ease: "linear" }, opacity: { duration: 0.2 } }} />
                )}
              </g>
            );
          })}
        </svg>

        <div
          className="business-brain-core pointer-events-none absolute top-1/2 left-1/2 z-10 flex size-[13.4rem] flex-col items-center justify-center rounded-full text-center"
          style={{ transform: "translate(-50%, -50%)" }}
        >
          <span className="text-fg text-[3.9rem] leading-none font-semibold tracking-[-0.065em] tabular-nums">{view.overall.score ?? "—"}</span>
          <span className="text-fg mt-2.5 text-base font-semibold">Business Health</span>
          <span className={cn("mt-2.5 rounded-full px-3 py-1 text-[0.7rem] font-medium", view.overall.state === "weak" ? "bg-amber/10 text-amber" : "bg-mint/10 text-mint")}>{view.overall.stateLabel}</span>
        </div>

        <ul className="contents" aria-label="Business dimensions">
          {view.nodes.map((node, index) => (
            <NodeButton key={node.id} node={node} index={index} selected={selected === node.id} related={active !== null && related.has(node.id)} dimmed={active !== null && !related.has(node.id)} reducedMotion={reducedMotion} onSelect={onSelect} onHover={setHovered} />
          ))}
        </ul>
      </div>

      <MobileBrain view={view} selected={selected} onSelect={onSelect} />
    </div>
  );
}
