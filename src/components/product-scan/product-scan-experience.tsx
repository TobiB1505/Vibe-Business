"use client";

import type { ComponentType, SVGProps } from "react";
import {
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ProductLogo } from "@/components/brand/product-logo";
import { VibeMark } from "@/components/brand/vibe-mark";
import { Button } from "@/components/ui/button";
import {
  CheckIcon,
  CreditCardIcon,
  GlobeIcon,
  LayersIcon,
  PaletteIcon,
  ProductsIcon,
  SparklesIcon,
  TeamIcon,
} from "@/components/ui/dashboard-icons";
import { MonoLabel } from "@/components/ui/typography";
import { useOperationPoll } from "@/lib/client/use-operation-poll";
import { formatTime } from "@/lib/utils/format-datetime";
import { OPERATION_FAILURE_MESSAGES } from "@/modules/operations/messages";
import {
  operationPollPhase,
  type OperationView,
} from "@/modules/operations/view";
import type { ProductScanPresentation } from "@/modules/product-scan/presentation";
import type {
  ProductScanEvent,
  ProductScanSource,
} from "@/modules/product-scan/schema";
import {
  startUnderstandingAction,
  type StartUnderstandingState,
} from "@/app/app/projects/[projectId]/understanding-actions";
import {
  getProductScanStatusAction,
  type ProductScanStatus,
} from "@/app/app/projects/[projectId]/product-scan-status-action";

const POLL_INTERVAL_MS = 1_800;
const EMPTY_SCAN_EVENTS: ProductScanEvent[] = [];

type ScanIcon = ComponentType<
  SVGProps<SVGSVGElement> & { size?: number; strokeWidth?: number }
>;

type FacetId =
  | "product"
  | "features"
  | "live"
  | "audience"
  | "billing"
  | "brand";

type ScanFacet = {
  id: FacetId;
  label: string;
  detail: string;
  summary: string;
  ready: boolean;
  icon: ScanIcon;
};

type ProductScanExperienceProps = {
  projectId: string;
  productName?: string;
  initialOperation: OperationView | null;
  initialEvents: ProductScanEvent[];
  initialPresentation?: ProductScanPresentation | null;
  hasProfile?: boolean;
  canStart?: boolean;
  blockedReason?: string | null;
  variant?: "onboarding" | "workspace";
};

const CONNECTORS: Record<FacetId, string> = {
  product: "M 380 250 L 380 76",
  features: "M 380 250 L 153 151",
  live: "M 380 250 L 607 151",
  audience: "M 380 250 L 153 350",
  billing: "M 380 250 L 607 350",
  brand: "M 380 250 L 380 438",
};

const FACET_POSITIONS: Record<FacetId, string> = {
  product: "left-1/2 top-[5%] -translate-x-1/2",
  features: "left-[2%] top-[22%]",
  live: "right-[2%] top-[22%]",
  audience: "left-[2%] top-[64%]",
  billing: "right-[2%] top-[64%]",
  brand: "bottom-[3%] left-1/2 -translate-x-1/2",
};

const FACET_POINT: Record<FacetId, { x: number; y: number }> = {
  product: { x: 380, y: 76 },
  features: { x: 153, y: 151 },
  live: { x: 607, y: 151 },
  audience: { x: 153, y: 350 },
  billing: { x: 607, y: 350 },
  brand: { x: 380, y: 438 },
};

const ORBIT_POINTS = [
  [96, 251],
  [119, 183],
  [178, 98],
  [263, 68],
  [492, 82],
  [586, 111],
  [663, 191],
  [681, 284],
  [635, 378],
  [544, 421],
  [229, 425],
  [137, 365],
] as const;

function useDocumentVisible() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  return visible;
}

function isActive(operation: OperationView | null) {
  return operationPollPhase(operation) === "working";
}

function operationError(operation: OperationView | null) {
  if (!operation || operation.status !== "failed") return null;
  return operation.failureCode
    ? OPERATION_FAILURE_MESSAGES[operation.failureCode]
    : "The scan stopped before the product picture was complete.";
}

function firstFinding(
  events: ProductScanEvent[],
  key: string | ((event: ProductScanEvent) => boolean),
) {
  return events.find((event) =>
    typeof key === "string"
      ? event.findingKey?.startsWith(key)
      : key(event),
  );
}

function eventFacet(event: ProductScanEvent): FacetId {
  if (event.findingKey?.startsWith("brand.")) return "brand";
  if (
    event.findingKey?.includes("payment") ||
    event.findingKey?.includes("pricing") ||
    event.findingKey?.includes("subscription")
  ) {
    return "billing";
  }
  if (
    event.findingKey?.includes("audience") ||
    event.findingKey?.includes("positioning")
  ) {
    return "audience";
  }
  if (event.source === "live_product") return "live";
  if (
    event.findingKey?.startsWith("framework.") ||
    event.findingKey?.startsWith("technical.") ||
    event.findingKey?.startsWith("repository.")
  ) {
    return "product";
  }
  return "features";
}

function discoveryCount(events: ProductScanEvent[]) {
  return events.filter(
    (event) => event.type === "finding" || event.type === "profile_ready",
  ).length;
}

function sourceLabel(source: ProductScanSource) {
  if (source === "repository") return "Code";
  if (source === "live_product") return "Live product";
  if (source === "product_profile") return "Product picture";
  return "Product Scan";
}

function buildFacets(
  events: ProductScanEvent[],
  presentation: ProductScanPresentation | null,
  active: boolean,
): ScanFacet[] {
  const productFinding = firstFinding(events, (event) =>
    Boolean(
      event.findingKey?.startsWith("framework.") ||
        event.findingKey?.startsWith("technical.framework"),
    ),
  );
  const featureFinding = firstFinding(events, (event) =>
    Boolean(
      event.findingKey?.startsWith("capability.") ||
        event.findingKey?.startsWith("surface.") ||
        event.findingKey?.startsWith("integration."),
    ),
  );
  const liveFinding = firstFinding(
    events,
    (event) => event.source === "live_product",
  );
  const audienceFinding = firstFinding(events, (event) =>
    Boolean(event.findingKey?.includes("audience")),
  );
  const billingFinding = firstFinding(events, (event) =>
    Boolean(
      event.findingKey?.includes("pricing") ||
        event.findingKey?.includes("payment") ||
        event.findingKey?.includes("subscription"),
    ),
  );
  const brandFinding = firstFinding(events, "brand.");

  const capabilitySummary = presentation?.capabilities
    .slice(0, 2)
    .map((capability) => capability)
    .join(", ");
  const brandSummary = presentation?.logo
    ? "Logo detected"
    : presentation?.typeface
      ? presentation.typeface
      : presentation?.colors.length
        ? `${presentation.colors.length} colors detected`
        : brandFinding?.title ?? "Assets & positioning";

  return [
    {
      id: "product",
      label: "Product type",
      detail: productFinding?.detail ?? "Repository structure",
      summary:
        presentation?.productType ?? productFinding?.title ?? "Detecting…",
      ready: Boolean(productFinding || presentation?.productType),
      icon: ProductsIcon,
    },
    {
      id: "features",
      label: "Core features",
      detail: featureFinding ? sourceLabel(featureFinding.source) : "Scanning",
      summary:
        capabilitySummary || featureFinding?.title || (active ? "Learning…" : "—"),
      ready: Boolean(featureFinding || capabilitySummary),
      icon: LayersIcon,
    },
    {
      id: "live",
      label: "Live product",
      detail: liveFinding ? sourceLabel(liveFinding.source) : "Environment",
      summary: liveFinding?.title ?? (active ? "Exploring…" : "Not observed"),
      ready: Boolean(liveFinding),
      icon: GlobeIcon,
    },
    {
      id: "audience",
      label: "Audience signals",
      detail: audienceFinding ? sourceLabel(audienceFinding.source) : "Learning",
      summary:
        presentation?.audience ?? audienceFinding?.title ?? (active ? "Learning…" : "—"),
      ready: Boolean(audienceFinding || presentation?.audience),
      icon: TeamIcon,
    },
    {
      id: "billing",
      label: "Billing",
      detail: billingFinding ? sourceLabel(billingFinding.source) : "Model & plans",
      summary:
        presentation?.businessModel ??
        billingFinding?.title ??
        (active ? "Identifying…" : "Not observed"),
      ready: Boolean(billingFinding || presentation?.businessModel),
      icon: CreditCardIcon,
    },
    {
      id: "brand",
      label: "Brand / identity",
      detail: brandFinding ? sourceLabel(brandFinding.source) : "Assets & positioning",
      summary: brandSummary,
      ready: Boolean(brandFinding || presentation?.logo),
      icon: PaletteIcon,
    },
  ];
}

function ScanCore({
  motionEnabled,
  pulseKey,
}: {
  motionEnabled: boolean;
  pulseKey: string | null;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2 z-20 size-[8.75rem] -translate-x-1/2 -translate-y-1/2 max-md:relative max-md:left-auto max-md:top-auto max-md:mx-auto max-md:my-9 max-md:translate-x-0 max-md:translate-y-0">
      <motion.div
        aria-hidden="true"
        className="absolute inset-[-2rem] rounded-full border border-mint/20"
        animate={motionEnabled ? { rotate: 360 } : { rotate: 0 }}
        transition={
          motionEnabled
            ? { duration: 22, ease: "linear", repeat: Infinity }
            : { duration: 0 }
        }
      >
        <span className="absolute left-1/2 top-[-0.2rem] size-1.5 -translate-x-1/2 rounded-full bg-mint shadow-[0_0_14px_var(--color-mint)]" />
      </motion.div>
      <motion.div
        aria-hidden="true"
        className="absolute inset-[-1rem] rounded-full border border-dashed border-mint/40"
        animate={motionEnabled ? { rotate: -360 } : { rotate: 0 }}
        transition={
          motionEnabled
            ? { duration: 16, ease: "linear", repeat: Infinity }
            : { duration: 0 }
        }
      />
      <div className="absolute inset-0 rounded-full border border-mint/70 bg-app shadow-[0_0_0_8px_color-mix(in_srgb,var(--color-mint)_8%,transparent),0_0_55px_color-mix(in_srgb,var(--color-mint)_38%,transparent)]" />
      <div className="absolute inset-3 rounded-full border border-mint/50 bg-surface-1" />
      <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <VibeMark size={56} />
      </span>
      <AnimatePresence initial={false}>
        {pulseKey && !reduceMotion ? (
          <motion.span
            key={pulseKey}
            aria-hidden="true"
            className="absolute inset-[-0.5rem] rounded-full border border-mint"
            initial={{ opacity: 0.8, scale: 0.84 }}
            animate={{ opacity: 0, scale: 1.45 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function ScanFacetCard({
  facet,
  presentation,
  pulse,
}: {
  facet: ScanFacet;
  presentation: ProductScanPresentation | null;
  pulse: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const Icon = facet.icon;

  return (
    <motion.article
      data-facet={facet.id}
      className={`absolute z-30 flex h-[4.2rem] w-[10.75rem] items-center gap-3 rounded-xl border bg-app/95 px-3 shadow-lg backdrop-blur-md max-md:relative max-md:inset-auto max-md:h-[4.5rem] max-md:w-full max-md:translate-x-0 ${FACET_POSITIONS[facet.id]} ${
        facet.ready
          ? "border-mint/35 shadow-mint/5"
          : "border-line-2"
      }`}
      initial={false}
      animate={
        pulse && !reduceMotion
          ? { opacity: [0.72, 1], y: [4, 0], scale: [0.98, 1] }
          : { opacity: facet.ready ? 1 : 0.72, y: 0, scale: 1 }
      }
      transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
    >
      <div
        className={`grid size-8 shrink-0 place-items-center rounded-lg border ${
          facet.ready
            ? "border-mint/25 bg-mint/[0.07] text-mint"
            : "border-line-1 text-fg-muted"
        }`}
      >
        <AnimatePresence initial={false} mode="wait">
          {facet.id === "brand" && presentation?.logo ? (
            <motion.div
              key="brand-logo"
              className="grid size-7 place-items-center overflow-hidden rounded-md"
              initial={reduceMotion ? false : { opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3 }}
            >
              <ProductLogo
                src={presentation.logo.url}
                alt={`${presentation.name} logo`}
                size={24}
                className="max-h-6 max-w-6 object-contain"
              />
            </motion.div>
          ) : (
            <motion.span key="facet-icon" initial={false} animate={{ opacity: 1 }}>
              <Icon size={18} />
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      <div className="min-w-0">
        <p className="truncate text-[0.78rem] font-semibold text-fg">
          {facet.label}
        </p>
        <p className={`truncate text-[0.68rem] ${facet.ready ? "text-fg-muted" : "text-fg-meta"}`}>
          {facet.detail}
        </p>
      </div>
      <span
        aria-hidden="true"
        className={`absolute -left-1 top-1/2 size-2 -translate-y-1/2 rounded-full ${
          facet.ready
            ? "bg-mint shadow-[0_0_12px_var(--color-mint)]"
            : "bg-line-track"
        }`}
      />
    </motion.article>
  );
}

function DiscoveryGraph({
  facets,
  presentation,
  pulseEvent,
  motionEnabled,
}: {
  facets: ScanFacet[];
  presentation: ProductScanPresentation | null;
  pulseEvent: ProductScanEvent | null;
  motionEnabled: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const pulsingFacet = pulseEvent ? eventFacet(pulseEvent) : null;

  return (
    <div
      data-testid="product-scan-graph"
      className="relative h-[31rem] overflow-hidden rounded-2xl border border-line-2 bg-app/55 max-md:h-auto max-md:min-h-0 max-md:overflow-visible max-md:p-4"
    >
      <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(circle_at_center,color-mix(in_srgb,var(--color-mint)_10%,transparent),transparent_38%)]" />
      <svg
        aria-hidden="true"
        viewBox="0 0 760 500"
        className="absolute inset-0 h-full w-full text-mint max-md:hidden"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <radialGradient id="scan-node-glow">
            <stop offset="0" stopColor="var(--color-mint)" stopOpacity="0.9" />
            <stop offset="1" stopColor="var(--color-mint)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse cx="380" cy="250" rx="300" ry="188" fill="none" stroke="currentColor" strokeOpacity="0.08" />
        <ellipse cx="380" cy="250" rx="262" ry="146" fill="none" stroke="currentColor" strokeDasharray="3 12" strokeOpacity="0.12" />
        <ellipse cx="380" cy="250" rx="212" ry="204" fill="none" stroke="currentColor" strokeOpacity="0.08" />
        <motion.g
          animate={motionEnabled ? { rotate: 360 } : { rotate: 0 }}
          transition={motionEnabled ? { duration: 38, repeat: Infinity, ease: "linear" } : { duration: 0 }}
          style={{ transformOrigin: "380px 250px" }}
        >
          <path d="M 82 250 C 175 165, 252 135, 380 135 C 512 135, 594 178, 680 250" fill="none" stroke="currentColor" strokeOpacity="0.08" />
          <path d="M 93 271 C 176 354, 260 384, 380 384 C 505 384, 588 349, 667 271" fill="none" stroke="currentColor" strokeOpacity="0.08" />
        </motion.g>
        {ORBIT_POINTS.map(([x, y], index) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r={index % 3 === 0 ? 2 : 1.25} fill="currentColor" opacity={index % 3 === 0 ? 0.75 : 0.35} />
        ))}
        {facets.map((facet) => (
          <g key={facet.id}>
            <path d={CONNECTORS[facet.id]} fill="none" stroke="currentColor" strokeWidth="1.25" strokeOpacity={facet.ready ? 0.55 : 0.11} />
            <motion.path
              d={CONNECTORS[facet.id]}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              initial={false}
              animate={{ pathLength: facet.ready ? 1 : 0, opacity: facet.ready ? 0.7 : 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.65, ease: "easeOut" }}
            />
            <circle cx={FACET_POINT[facet.id].x} cy={FACET_POINT[facet.id].y} r="12" fill="url(#scan-node-glow)" opacity={facet.ready ? 0.55 : 0} />
            <circle cx={FACET_POINT[facet.id].x} cy={FACET_POINT[facet.id].y} r="2.5" fill="currentColor" opacity={facet.ready ? 1 : 0.2} />
          </g>
        ))}
      </svg>

      <ScanCore motionEnabled={motionEnabled} pulseKey={pulseEvent?.id ?? null} />

      <div className="contents max-md:grid max-md:grid-cols-2 max-md:gap-2.5 max-[520px]:grid-cols-1">
        {facets.map((facet) => (
          <ScanFacetCard
            key={facet.id}
            facet={facet}
            presentation={presentation}
            pulse={pulsingFacet === facet.id}
          />
        ))}
      </div>
    </div>
  );
}

function DiscoveryStatusIcon({
  ready,
  active,
  motionEnabled,
}: {
  ready: boolean;
  active: boolean;
  motionEnabled: boolean;
}) {
  if (ready) {
    return (
      <span className="grid size-6 place-items-center rounded-full border border-mint/25 bg-mint/[0.07] text-mint">
        <CheckIcon size={13} strokeWidth={2.4} />
      </span>
    );
  }

  return (
    <span className="relative grid size-6 place-items-center rounded-full border border-line-1 text-fg-meta">
      {active ? (
        <motion.span
          aria-hidden="true"
          className="size-2 rounded-full border border-mint border-t-transparent"
          animate={motionEnabled ? { rotate: 360 } : { rotate: 0 }}
          transition={motionEnabled ? { duration: 0.9, ease: "linear", repeat: Infinity } : { duration: 0 }}
        />
      ) : (
        <span className="size-1 rounded-full bg-fg-faint" />
      )}
    </span>
  );
}

function DiscoveringPanel({
  facets,
  presentation,
  productName,
  active,
  motionEnabled,
}: {
  facets: ScanFacet[];
  presentation: ProductScanPresentation | null;
  productName: string;
  active: boolean;
  motionEnabled: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const rows = [
    { facet: facets[0], icon: ProductsIcon },
    { facet: facets[4], icon: CreditCardIcon },
    { facet: facets[3], icon: TeamIcon },
    {
      facet: {
        ...facets[0],
        id: "product" as const,
        label: "Profile status",
        summary: presentation?.profileStatus ?? (active ? "Building…" : "Not ready"),
        ready: Boolean(presentation?.profileStatus),
      },
      icon: SparklesIcon,
    },
    {
      facet: {
        ...facets[0],
        id: "product" as const,
        label: "Tech stack",
        summary: presentation?.techStack ?? (active ? "Detecting…" : "Not detected"),
        ready: Boolean(presentation?.techStack),
      },
      icon: LayersIcon,
    },
    { facet: facets[5], icon: PaletteIcon },
  ];

  const initials = productName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <aside className="flex h-[31rem] flex-col rounded-2xl border border-line-2 bg-surface-1 p-4 max-lg:h-auto max-lg:min-h-[31rem]">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-fg">What we&apos;re discovering</h3>
        <SparklesIcon size={17} className="text-mint" />
      </div>

      <div className="mt-4 flex min-h-[4.4rem] items-center gap-3 border-b border-line-1 pb-4">
        <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl border border-mint/25 bg-app text-lg font-semibold text-mint">
          <AnimatePresence initial={false} mode="wait">
            {presentation?.logo ? (
              <motion.div
                key="discovered-logo"
                className="grid size-full place-items-center p-2"
                initial={reduceMotion ? false : { opacity: 0, scale: 0.72 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.35 }}
              >
                <ProductLogo
                  src={presentation.logo.url}
                  alt={`${productName} logo`}
                  size={36}
                  className="max-h-full max-w-full object-contain"
                />
              </motion.div>
            ) : (
              <motion.span key="initials" initial={false}>{initials || "V"}</motion.span>
            )}
          </AnimatePresence>
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-fg">{productName}</p>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-fg-muted">
            {presentation?.description ?? "Vibe is assembling a grounded product picture."}
          </p>
        </div>
      </div>

      <div className="mt-3 grid flex-1 grid-rows-6 overflow-hidden rounded-xl border border-line-1">
        {rows.map(({ facet, icon: Icon }) => (
          <div key={facet.label} className="grid min-h-0 grid-cols-[1fr_auto] items-center gap-3 border-b border-line-1 px-3 last:border-b-0">
            <div className="flex min-w-0 items-center gap-2.5">
              <Icon size={16} className={facet.ready ? "text-fg-body" : "text-fg-muted"} />
              <span className="truncate text-xs text-fg-muted">{facet.label}</span>
            </div>
            <div className="flex min-w-0 max-w-[9.5rem] items-center gap-2">
              <span className={`truncate text-right text-xs ${facet.ready ? "text-mint" : "text-fg-meta"}`}>
                {facet.summary}
              </span>
              <DiscoveryStatusIcon
                ready={facet.ready}
                active={active}
                motionEnabled={motionEnabled}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-end gap-2 text-xs text-mint">
        <span>{presentation ? "Product profile ready" : "Live discovery"}</span>
        <span aria-hidden="true">→</span>
      </div>
    </aside>
  );
}

function LiveActivity({
  events,
  active,
  pulseEventId,
}: {
  events: ProductScanEvent[];
  active: boolean;
  pulseEventId: string | null;
}) {
  const reduceMotion = useReducedMotion();
  const visibleEvents = events.slice(-8);

  return (
    <section className="flex h-[18rem] flex-col rounded-2xl border border-line-2 bg-surface-1 p-4 max-md:h-auto max-md:min-h-[18rem]">
      <div className="flex items-center gap-2">
        <span className={`size-2 rounded-full ${active ? "bg-mint shadow-[0_0_10px_var(--color-mint)]" : "bg-mint/70"}`} />
        <h3 className="text-sm font-semibold text-fg">Live activity</h3>
      </div>
      <ol className="mt-3 grid flex-1 grid-rows-8 overflow-hidden">
        {visibleEvents.length ? (
          visibleEvents.map((event) => (
            <motion.li
              key={event.id}
              className={`grid min-h-0 grid-cols-[1.25rem_1fr_auto] items-center gap-2 rounded-lg px-1.5 text-xs ${
                event.id === pulseEventId ? "bg-mint/[0.07] text-mint" : "text-fg-muted"
              }`}
              initial={false}
              animate={
                event.id === pulseEventId && !reduceMotion
                  ? { opacity: [0.55, 1], x: [-5, 0] }
                  : { opacity: 1, x: 0 }
              }
              transition={{ duration: reduceMotion ? 0 : 0.34 }}
            >
              <span className="grid size-4 place-items-center rounded-full border border-mint/60 text-mint">
                <CheckIcon size={10} strokeWidth={2.5} />
              </span>
              <span className="truncate">{event.title}</span>
              <time className="font-mono text-[0.66rem] tabular-nums text-fg-meta" dateTime={event.occurredAt}>
                {formatTime(event.occurredAt)}
              </time>
            </motion.li>
          ))
        ) : (
          <li className="col-span-full row-span-8 flex items-center justify-center text-center text-xs text-fg-muted">
            {active
              ? "The first grounded discovery will appear here."
              : "Start a scan to build the activity trail."}
          </li>
        )}
      </ol>
    </section>
  );
}

function DiscoveriesGrid({
  facets,
  events,
  presentation,
  pulseEvent,
}: {
  facets: ScanFacet[];
  events: ProductScanEvent[];
  presentation: ProductScanPresentation | null;
  pulseEvent: ProductScanEvent | null;
}) {
  const reduceMotion = useReducedMotion();
  const found = discoveryCount(events);
  return (
    <section className="flex h-[18rem] flex-col rounded-2xl border border-line-2 bg-surface-1 p-4 max-md:h-auto max-md:min-h-[18rem]">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-fg">What we&apos;ve discovered so far</h3>
        <span className="rounded-full border border-mint/25 bg-mint/[0.06] px-2.5 py-1 font-mono text-[0.66rem] text-mint">
          {found} found
        </span>
      </div>
      <div className="mt-3 grid flex-1 grid-cols-3 grid-rows-2 gap-2 max-sm:grid-cols-2 max-sm:grid-rows-3">
        {facets.map((facet) => {
          const Icon = facet.icon;
          const pulse = pulseEvent ? eventFacet(pulseEvent) === facet.id : false;
          return (
            <motion.article
              key={facet.id}
              className={`flex min-h-0 items-center gap-3 rounded-xl border px-3 ${facet.ready ? "border-line-2 bg-app/65" : "border-line-1 bg-app/30"}`}
              initial={false}
              animate={pulse && !reduceMotion ? { borderColor: ["var(--color-line-2)", "var(--color-mint)", "var(--color-line-2)"] } : undefined}
              transition={{ duration: reduceMotion ? 0 : 0.7 }}
            >
              <div className={`grid size-8 shrink-0 place-items-center rounded-lg ${facet.ready ? "text-mint" : "text-fg-meta"}`}>
                {facet.id === "brand" && presentation?.logo ? (
                  <ProductLogo
                    src={presentation.logo.url}
                    alt={`${presentation.name} logo`}
                    size={28}
                    className="max-h-7 max-w-7 object-contain"
                  />
                ) : (
                  <Icon size={22} />
                )}
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-fg">{facet.label}</p>
                <p className={`mt-1 line-clamp-2 text-[0.68rem] leading-4 ${facet.ready ? "text-fg-muted" : "text-fg-meta"}`}>
                  {facet.summary}
                </p>
              </div>
            </motion.article>
          );
        })}
      </div>
    </section>
  );
}

function ScanFooter({
  operation,
  eventCount,
  motionEnabled,
}: {
  operation: OperationView | null;
  eventCount: number;
  motionEnabled: boolean;
}) {
  const active = isActive(operation);
  const failed = operation?.status === "failed";

  return (
    <footer className="mt-4 flex min-h-[4.5rem] items-center gap-3 rounded-2xl border border-line-2 bg-surface-1 px-4 py-3">
      <div className={`grid size-10 shrink-0 place-items-center rounded-full ${failed ? "bg-coral-tint-soft text-coral" : "bg-mint-tint-soft text-mint"}`}>
        <SparklesIcon size={20} />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-fg">
          {failed
            ? "The scan needs attention"
            : active
              ? "Vibe is building your product picture"
              : eventCount
                ? `${eventCount} individual discoveries saved`
                : "Ready to understand your product"}
        </p>
        <p className="mt-0.5 text-xs text-fg-muted">
          {active
            ? "You can leave this page — every discovery is stored as it arrives."
            : failed
              ? "Your existing product data is safe. You can start the scan again."
              : "Only grounded findings from the repository and public product are shown."}
        </p>
      </div>
      {active ? (
        <span className="ml-auto hidden items-center gap-2 font-mono text-[0.66rem] uppercase tracking-[0.16em] text-mint sm:flex">
          <motion.span
            aria-hidden="true"
            className="size-2 rounded-full bg-mint"
            animate={motionEnabled ? { opacity: [0.35, 1, 0.35] } : { opacity: 1 }}
            transition={motionEnabled ? { duration: 1.35, repeat: Infinity } : { duration: 0 }}
          />
          Live scan
        </span>
      ) : null}
    </footer>
  );
}

export function ProductScanExperience({
  projectId,
  productName = "Vibe Business",
  initialOperation,
  initialEvents,
  initialPresentation = null,
  hasProfile = false,
  canStart = true,
  blockedReason = null,
  variant = "workspace",
}: ProductScanExperienceProps) {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const documentVisible = useDocumentVisible();
  const start = startUnderstandingAction.bind(null, projectId);
  const [startState, startDispatch, startPending] = useActionState<
    StartUnderstandingState,
    FormData
  >(start, null);
  const startedOperation =
    startState?.ok && startState.kind === "running"
      ? startState.operation
      : null;
  const startFailure = startState && !startState.ok ? startState.error : null;
  const watchedOperation = startedOperation ?? initialOperation;
  const initialScan = useMemo<ProductScanStatus | null>(
    () =>
      watchedOperation
        ? {
            operation: watchedOperation,
            events:
              watchedOperation.operationId === initialOperation?.operationId
                ? initialEvents
                : [],
            presentation:
              watchedOperation.operationId === initialOperation?.operationId
                ? initialPresentation
                : null,
          }
        : null,
    [initialEvents, initialOperation?.operationId, initialPresentation, watchedOperation],
  );
  const { latest } = useOperationPoll<ProductScanStatus>({
    key: watchedOperation?.operationId ?? null,
    enabled: operationPollPhase(watchedOperation) === "working",
    intervalMs: POLL_INTERVAL_MS,
    poll: async () => {
      if (!watchedOperation) return { kind: "unavailable" };
      const result = await getProductScanStatusAction(
        projectId,
        watchedOperation.operationId,
      );
      return result.ok
        ? { kind: "value", value: result.scan }
        : { kind: "unavailable" };
    },
    continueAfter: (next) =>
      operationPollPhase(next.operation) === "working",
  });
  const scan = latest ?? initialScan;
  const operation = scan?.operation ?? null;
  const events = scan?.events ?? EMPTY_SCAN_EVENTS;
  const presentation = scan?.presentation ?? null;
  const [pulseEventId, setPulseEventId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [revealState, setRevealState] = useState({
    operationId: initialOperation?.operationId ?? null,
    sequence: initialEvents.at(-1)?.sequence ?? 0,
  });
  const currentRevealState =
    revealState.operationId === (watchedOperation?.operationId ?? null)
      ? revealState
      : {
          operationId: watchedOperation?.operationId ?? null,
          sequence: 0,
        };
  const revealedSequence = currentRevealState.sequence;
  const refreshedOperation = useRef<string | null>(
    initialOperation &&
      (initialOperation.status === "completed" ||
        initialOperation.status === "failed")
      ? initialOperation.operationId
      : null,
  );

  useEffect(() => {
    const pendingEvents = events.filter(
      (event) => event.sequence > revealedSequence,
    );
    if (!pendingEvents.length) return;

    const nextEvent = reduceMotion
      ? pendingEvents.at(-1) ?? null
      : pendingEvents[0];
    if (!nextEvent) return;

    const reveal = () => {
      setRevealState({
        operationId: watchedOperation?.operationId ?? null,
        sequence: nextEvent.sequence,
      });
      setPulseEventId(nextEvent.id);
      setAnnouncement(
        `${nextEvent.title}${nextEvent.detail ? `. ${nextEvent.detail}` : ""}`,
      );
    };

    const timeoutId = window.setTimeout(reveal, reduceMotion ? 0 : 440);
    return () => window.clearTimeout(timeoutId);
  }, [events, reduceMotion, revealedSequence, watchedOperation?.operationId]);

  useEffect(() => {
    if (
      !operation ||
      (operation.status !== "completed" && operation.status !== "failed") ||
      refreshedOperation.current === operation.operationId
    ) {
      return;
    }
    refreshedOperation.current = operation.operationId;
    const timeoutId = window.setTimeout(
      () => router.refresh(),
      operation.status === "completed" && variant === "onboarding" ? 800 : 0,
    );
    return () => window.clearTimeout(timeoutId);
  }, [operation, router, variant]);

  useEffect(() => {
    if (!pulseEventId) return;
    const timeoutId = setTimeout(() => setPulseEventId(null), reduceMotion ? 50 : 1_100);
    return () => clearTimeout(timeoutId);
  }, [pulseEventId, reduceMotion]);

  const active = isActive(operation) || startPending;
  const motionEnabled = active && documentVisible && !reduceMotion;
  const failure = operationError(operation);
  const revealedEvents = useMemo(
    () => events.filter((event) => event.sequence <= revealedSequence),
    [events, revealedSequence],
  );
  const revealedPresentation = revealedEvents.some(
    (event) => event.type === "profile_ready",
  )
    ? presentation
    : null;
  const pulseEvent = events.find((event) => event.id === pulseEventId) ?? null;
  const facets = useMemo(
    () => buildFacets(revealedEvents, revealedPresentation, active),
    [active, revealedEvents, revealedPresentation],
  );
  const displayFailure = startFailure
    ? OPERATION_FAILURE_MESSAGES[startFailure]
    : failure;

  return (
    <section
      aria-labelledby="product-scan-title"
      className="relative overflow-hidden rounded-[1.2rem] border border-line-2 bg-surface-1 p-4 shadow-xl sm:p-5"
    >
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>

      <header className="relative flex min-h-[8.25rem] flex-col items-center justify-center px-3 text-center">
        <MonoLabel className={active ? "text-mint" : undefined}>
          {active ? "Product scan · live" : operation?.status === "completed" ? "Product scan · complete" : "Product scan"}
        </MonoLabel>
        <h2 id="product-scan-title" className="mt-2 text-balance text-3xl font-semibold tracking-[-0.035em] text-fg sm:text-4xl">
          Understanding <span className="text-mint">your product</span>
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-fg-muted sm:text-base">
          Vibe is learning what you built, how it works, and what kind of business it could become.
        </p>

        {variant === "workspace" && !active ? (
          blockedReason ? (
            <p className="absolute right-0 top-0 max-w-xs text-right text-xs text-fg-muted max-lg:relative max-lg:mt-4 max-lg:text-center">
              {blockedReason}
            </p>
          ) : (
            <form action={startDispatch} noValidate className="absolute right-0 top-0 max-lg:relative max-lg:mt-4">
              <input type="hidden" name="force" value="true" />
              <Button type="submit" disabled={startPending || !canStart} busy={startPending}>
                {startPending
                  ? "Starting Product Scan…"
                  : hasProfile
                    ? "Scan my product again"
                    : "Scan my product"}
              </Button>
            </form>
          )
        ) : null}
      </header>

      {displayFailure ? (
        <div role="alert" className="mb-4 rounded-xl border border-coral-line bg-coral-tint-soft px-4 py-3 text-sm text-coral">
          {displayFailure}
        </div>
      ) : null}

      <div className="grid grid-cols-[minmax(0,1fr)_21rem] gap-4 max-lg:grid-cols-1">
        <DiscoveryGraph
          facets={facets}
          presentation={revealedPresentation}
          pulseEvent={pulseEvent}
          motionEnabled={motionEnabled}
        />
        <DiscoveringPanel
          facets={facets}
          presentation={revealedPresentation}
          productName={productName}
          active={active}
          motionEnabled={motionEnabled}
        />
      </div>

      <div className="mt-4 grid grid-cols-[0.92fr_1.08fr] gap-4 max-lg:grid-cols-1">
        <LiveActivity
          events={revealedEvents}
          active={active}
          pulseEventId={pulseEventId}
        />
        <DiscoveriesGrid
          facets={facets}
          events={revealedEvents}
          presentation={revealedPresentation}
          pulseEvent={pulseEvent}
        />
      </div>

      <ScanFooter
        operation={operation}
        eventCount={discoveryCount(revealedEvents)}
        motionEnabled={motionEnabled}
      />

      {variant === "onboarding" && !active && operation?.status === "failed" && operation.retryAllowed ? (
        <form action={startDispatch} noValidate className="mt-4 flex justify-center">
          <input type="hidden" name="force" value="true" />
          <Button type="submit" variant="primary" disabled={startPending}>
            Try product scan again
          </Button>
        </form>
      ) : null}
    </section>
  );
}
