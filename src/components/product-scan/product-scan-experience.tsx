"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import { VibeMark } from "@/components/brand/vibe-mark";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";
import { useOperationPoll } from "@/lib/client/use-operation-poll";
import { operationPollPhase, type OperationView } from "@/modules/operations/view";
import { OPERATION_FAILURE_MESSAGES } from "@/modules/operations/messages";
import type { ProductScanEvent, ProductScanSource } from "@/modules/product-scan/schema";
import { startUnderstandingAction, type StartUnderstandingState } from "@/app/app/projects/[projectId]/understanding-actions";
import { getProductScanStatusAction, type ProductScanStatus } from "@/app/app/projects/[projectId]/product-scan-status-action";

const POLL_INTERVAL_MS = 2_500;
const EMPTY_SCAN_EVENTS: ProductScanEvent[] = [];

export type ProductScanVariant = "onboarding" | "workspace";

type ScanNode = {
  id: string;
  label: string;
  detail: string;
  ready: boolean;
};

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

function sourceLabel(source: ProductScanSource) {
  if (source === "repository") return "Code";
  if (source === "live_product") return "Live product";
  if (source === "product_profile") return "Product picture";
  return "Product Scan";
}

function scanNodes(events: ProductScanEvent[]): ScanNode[] {
  const has = (predicate: (event: ProductScanEvent) => boolean) => events.some(predicate);
  const profileReady = has((event) => event.type === "profile_ready" || event.type === "scan_completed");
  return [
    {
      id: "code",
      label: "Product type",
      detail: "Repository structure",
      ready: has((event) => event.source === "repository" && (event.type === "source_ready" || event.type === "finding")),
    },
    {
      id: "features",
      label: "Core capabilities",
      detail: "Surfaces and signals",
      ready: has((event) => Boolean(event.findingKey?.startsWith("surface.") || event.findingKey?.startsWith("integration."))),
    },
    {
      id: "live",
      label: "Live product",
      detail: "Public experience",
      ready: has((event) => event.source === "live_product" && (event.type === "source_ready" || event.type === "source_unavailable")),
    },
    {
      id: "audience",
      label: "Audience",
      detail: "Who it appears to serve",
      ready: profileReady,
    },
    {
      id: "model",
      label: "Business signals",
      detail: "Grounded, not guessed",
      ready: profileReady,
    },
    {
      id: "brand",
      label: "Brand identity",
      detail: "Assets and positioning",
      ready: has((event) => event.findingKey === "brand.repository_signals") || profileReady,
    },
  ];
}

function DiscoveryGraph({ events, active }: { events: ProductScanEvent[]; active: boolean }) {
  const reduceMotion = useReducedMotion();
  const visible = useDocumentVisible();
  const nodes = scanNodes(events);
  const latestEvent = events.at(-1);
  const animateContinuously = active && visible && !reduceMotion;
  const positions = [
    "left-[3%] top-[12%]",
    "left-[1%] top-[43%]",
    "left-[9%] bottom-[4%]",
    "right-[3%] top-[12%]",
    "right-[1%] top-[43%]",
    "right-[9%] bottom-[4%]",
  ];

  return (
    <div className="relative min-h-[27rem] overflow-hidden rounded-[1.35rem] border border-line-2 bg-[radial-gradient(circle_at_50%_48%,rgba(0,229,160,0.09),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.018),transparent)] max-md:min-h-0 max-md:overflow-visible max-md:border-0 max-md:bg-none">
      <svg
        className="absolute inset-0 h-full w-full max-md:hidden"
        viewBox="0 0 720 430"
        aria-hidden="true"
      >
        <defs>
          <radialGradient id="scan-core" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#00e5a0" stopOpacity="0.26" />
            <stop offset="100%" stopColor="#00e5a0" stopOpacity="0" />
          </radialGradient>
        </defs>
        {[94, 126, 168].map((radius) => (
          <circle
            key={radius}
            cx="360"
            cy="214"
            r={radius}
            fill="none"
            stroke="#00e5a0"
            strokeOpacity={radius === 94 ? 0.22 : 0.1}
            strokeDasharray={radius === 126 ? "3 9" : undefined}
          />
        ))}
        {[
          [360, 214, 137, 64],
          [360, 214, 116, 202],
          [360, 214, 174, 354],
          [360, 214, 583, 64],
          [360, 214, 604, 202],
          [360, 214, 546, 354],
        ].map(([x1, y1, x2, y2], index) => (
          <motion.line
            key={index}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="#00e5a0"
            strokeOpacity={nodes[index].ready ? 0.42 : 0.12}
            initial={false}
            animate={{ pathLength: nodes[index].ready ? 1 : 0.45 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.55, ease: "easeOut" }}
          />
        ))}
        <circle cx="360" cy="214" r="92" fill="url(#scan-core)" />
        <AnimatePresence>
          {latestEvent && !reduceMotion && (
            <motion.circle
              key={latestEvent.id}
              cx="360"
              cy="214"
              r="55"
              fill="none"
              stroke="#00e5a0"
              strokeWidth="2"
              initial={{ r: 55, opacity: 0.65 }}
              animate={{ r: 118, opacity: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.9, ease: "easeOut" }}
            />
          )}
        </AnimatePresence>
      </svg>

      <motion.div
        className="absolute left-1/2 top-1/2 z-10 flex size-[7.5rem] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-mint/60 bg-ground shadow-[0_0_50px_rgba(0,229,160,0.16)] max-md:relative max-md:left-auto max-md:top-auto max-md:mx-auto max-md:mb-5 max-md:size-20 max-md:translate-x-0 max-md:translate-y-0"
        animate={animateContinuously ? { scale: [1, 1.035, 1], boxShadow: ["0 0 32px rgba(0,229,160,.10)", "0 0 56px rgba(0,229,160,.22)", "0 0 32px rgba(0,229,160,.10)"] } : { scale: 1 }}
        transition={animateContinuously ? { duration: 3.8, repeat: Infinity, ease: "easeInOut" } : { duration: 0 }}
      >
        <VibeMark size={50} />
      </motion.div>

      <div className="max-md:grid max-md:grid-cols-1 max-md:gap-2">
        {nodes.map((node, index) => (
          <motion.div
            layout
            key={node.id}
            className={`absolute z-20 w-[11.25rem] rounded-xl border p-3 backdrop-blur-sm max-md:relative max-md:inset-auto max-md:w-full ${positions[index]} ${node.ready ? "border-mint/30 bg-mint/[0.055]" : "border-line-2 bg-surface-1/88"}`}
            initial={false}
            animate={{ opacity: node.ready ? 1 : 0.64, y: node.ready && !reduceMotion ? [4, 0] : 0 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.35 }}
          >
            <div className="flex items-start gap-2.5">
              <span className={`mt-1 size-2 shrink-0 rounded-full ${node.ready ? "bg-mint shadow-[0_0_12px_rgba(0,229,160,.55)]" : "bg-line-track"}`} />
              <span className="min-w-0">
                <span className="text-fg-body block text-xs font-semibold">{node.label}</span>
                <span className="text-fg-meta mt-0.5 block text-[0.68rem] leading-snug">{node.detail}</span>
              </span>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function DiscoveryFeed({ events }: { events: ProductScanEvent[] }) {
  const reduceMotion = useReducedMotion();
  const visible = events.slice(-8).reverse();
  return (
    <Surface level="panel" padding="md" className="flex min-h-[27rem] flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <MonoLabel>Discoveries</MonoLabel>
          <h3 className="text-fg mt-1 text-sm font-semibold">What Vibe found</h3>
        </div>
        <span className="border-mint/25 bg-mint/[0.06] text-mint rounded-full border px-2.5 py-1 font-mono text-[0.68rem]">
          {events.filter((event) => event.type === "finding" || event.type === "profile_ready").length} found
        </span>
      </div>
      <ol className="flex flex-1 flex-col gap-2" aria-label="Product Scan discoveries">
        <AnimatePresence initial={false} mode="popLayout">
          {visible.map((event) => (
            <motion.li
              layout
              key={event.id}
              initial={reduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.28 }}
              className={`rounded-lg border px-3 py-2.5 ${event.type === "source_unavailable" || event.type === "scan_failed" ? "border-amber/25 bg-amber/[0.045]" : "border-line-2 bg-surface-2"}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="text-fg-body block text-xs font-medium">{event.title}</span>
                  {event.detail && <span className="text-fg-meta mt-1 block text-[0.7rem] leading-relaxed">{event.detail}</span>}
                </div>
                <span className="text-fg-meta shrink-0 font-mono text-[0.62rem]">{sourceLabel(event.source)}</span>
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
        {visible.length === 0 && (
          <li className="border-line-2 text-fg-muted rounded-lg border border-dashed p-4 text-xs">
            Discoveries appear here as each real scan step finishes.
          </li>
        )}
      </ol>
    </Surface>
  );
}

export function ProductScanExperience({
  projectId,
  variant,
  initialOperation,
  initialEvents,
  hasProfile = false,
  canStart = true,
  blockedReason = null,
}: {
  projectId: string;
  variant: ProductScanVariant;
  initialOperation: OperationView | null;
  initialEvents: ProductScanEvent[];
  hasProfile?: boolean;
  canStart?: boolean;
  blockedReason?: string | null;
}) {
  const router = useRouter();
  const start = startUnderstandingAction.bind(null, projectId);
  const [startState, formAction, starting] = useActionState<StartUnderstandingState, FormData>(start, null);
  const startedOperation = startState?.ok && startState.kind === "running" ? startState.operation : null;
  const startFailure = startState && !startState.ok ? startState.error : null;
  const watchedOperation = startedOperation ?? initialOperation;
  const initialScan = useMemo<ProductScanStatus | null>(
    () => watchedOperation ? { operation: watchedOperation, events: watchedOperation.operationId === initialOperation?.operationId ? initialEvents : [] } : null,
    [initialEvents, initialOperation?.operationId, watchedOperation],
  );

  const { latest } = useOperationPoll<ProductScanStatus>({
    key: watchedOperation?.operationId ?? null,
    enabled: operationPollPhase(watchedOperation) === "working",
    intervalMs: POLL_INTERVAL_MS,
    poll: async () => {
      if (!watchedOperation) return { kind: "unavailable" };
      const result = await getProductScanStatusAction(projectId, watchedOperation.operationId);
      return result.ok ? { kind: "value", value: result.scan } : { kind: "unavailable" };
    },
    continueAfter: (next) => operationPollPhase(next.operation) === "working",
  });

  const scan = latest ?? initialScan;
  const operation = scan?.operation ?? null;
  const events = scan?.events ?? EMPTY_SCAN_EVENTS;
  const active = operationPollPhase(operation) === "working";
  const completed = operation?.status === "completed";
  const failed = operation?.status === "failed";
  // A terminal operation supplied by the server is already reflected in the
  // page. Refresh only when polling observes a transition after mount.
  const refreshedOperation = useRef<string | null>(
    initialOperation && (initialOperation.status === "completed" || initialOperation.status === "failed")
      ? initialOperation.operationId
      : null,
  );
  const initialSequence = useRef(initialEvents.at(-1)?.sequence ?? 0);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    const newest = events.at(-1);
    if (newest && newest.sequence > initialSequence.current) {
      initialSequence.current = newest.sequence;
      setAnnouncement(newest.title);
    }
  }, [events]);

  useEffect(() => {
    if (!operation || (!completed && !failed)) return;
    if (refreshedOperation.current === operation.operationId) return;
    refreshedOperation.current = operation.operationId;
    const delay = completed && variant === "onboarding" ? 800 : 0;
    const timer = window.setTimeout(() => router.refresh(), delay);
    return () => window.clearTimeout(timer);
  }, [completed, failed, operation, router, variant]);

  const stageTitle = completed
    ? "Your product picture is ready."
    : failed
      ? "The Product Scan stopped."
      : operation?.stage === "reading_public_product"
        ? "Mapping your public product."
        : operation?.stage === "understanding_product"
          ? "Connecting the findings."
          : "Understanding your product.";

  return (
    <LayoutGroup id={`product-scan-${projectId}-${variant}`}>
      <section className={`flex flex-col gap-5 ${variant === "onboarding" ? "py-1" : ""}`} aria-labelledby={`product-scan-title-${variant}`}>
        <span className="sr-only" aria-live="polite">{announcement}</span>
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-2">
            <MonoLabel className="text-mint">Product Scan · {active ? "Live" : completed ? "Complete" : "Ready"}</MonoLabel>
            <h2 id={`product-scan-title-${variant}`} className={`${variant === "onboarding" ? "text-[2rem] sm:text-[2.65rem]" : "text-2xl"} text-fg max-w-[24ch] font-semibold leading-tight tracking-[-0.035em]`}>
              {stageTitle}
            </h2>
            <p className="text-fg-muted max-w-[62ch] text-sm leading-relaxed">
              Vibe reads the code, checks the public product and turns each grounded discovery into one durable Product Profile.
            </p>
          </div>

          {variant === "workspace" && !active && (
            <div className="flex flex-col items-end gap-2">
              {blockedReason ? (
                <p className="text-fg-muted max-w-xs text-right text-xs">{blockedReason}</p>
              ) : (
                <form action={formAction} noValidate>
                  <input type="hidden" name="force" value="true" />
                  <Button type="submit" disabled={starting || !canStart} busy={starting}>
                    {starting ? "Starting Product Scan…" : hasProfile ? "Scan my product again" : "Scan my product"}
                  </Button>
                </form>
              )}
            </div>
          )}
        </header>

        {startFailure && (
          <Surface level="panel" padding="sm" className="border-amber/30 bg-amber/[0.04]">
            <p className="text-amber text-sm font-semibold">The Product Scan could not start.</p>
            <p className="text-fg-muted mt-1 text-xs">{OPERATION_FAILURE_MESSAGES[startFailure]}</p>
          </Surface>
        )}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(18rem,.85fr)]">
          <DiscoveryGraph events={events} active={active} />
          <DiscoveryFeed events={events} />
        </div>

        <Surface level="panel" padding="sm" className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className={`size-2 rounded-full ${failed ? "bg-amber" : active ? "bg-mint animate-pulse motion-reduce:animate-none" : completed ? "bg-mint" : "bg-line-track"}`} />
            <span className="text-fg-body text-xs">
              {operation?.stalled
                ? "This run is taking much longer than expected."
                : active
                  ? "The scan continues safely if you leave this page."
                  : completed
                    ? `${events.filter((event) => event.type === "finding" || event.type === "profile_ready").length} individual discoveries saved.`
                    : failed
                      ? "Completed source readings remain available."
                      : "Start when you want Vibe to refresh every connected source."}
            </span>
          </div>
          {active && <span className="text-fg-meta font-mono text-[0.68rem]">No invented percentage</span>}
        </Surface>

        {failed && operation?.retryAllowed && variant === "workspace" && (
          <form action={formAction} noValidate>
            <input type="hidden" name="force" value="true" />
            <Button type="submit" variant="secondary" disabled={starting}>Try again</Button>
          </form>
        )}
      </section>
    </LayoutGroup>
  );
}
