"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CONSOLE_WINDOWS,
  type ConsoleSnapshot,
  type ConsoleWindow,
  type FeedLevel,
} from "@/modules/internal-console/schema";
import { formatMicroUsd } from "@/modules/internal-console/shape";
import { refreshConsoleAction } from "./actions";

/**
 * The live feed ([ADR 0088](../../../../docs/decisions/0088-the-internal-operator-console.md) §3).
 *
 * ## Polling, and why that is the design
 *
 * There is no websocket and no subscription. A push transport would be a second
 * durable liveness mechanism beside Vercel Workflows — what rule 24 exists to
 * prevent — and it would buy latency nobody can use: the rows below are written
 * by workflow steps that take tens of seconds.
 *
 * The interval pauses while the tab is hidden, and resumes with an immediate
 * refresh rather than waiting out the remainder of a tick. A console left open
 * on a second monitor should not spend queries nobody is reading.
 *
 * ## Why staleness is shown rather than hidden
 *
 * Every panel is a photograph. When a refresh fails, the last good snapshot
 * stays on screen and the header says how old it is — a console that silently
 * showed stale numbers during an incident would be worse than one that showed
 * nothing.
 */

const POLL_MS = 5_000;

const LEVEL_CLASS: Record<FeedLevel, string> = {
  ok: "text-fg-muted",
  active: "text-mint",
  waiting: "text-amber",
  bad: "text-coral",
};

function duration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60)
    return `${minutes}m${String(Math.floor((ms % 60_000) / 1_000)).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}m`;
}

/** UTC, always. A machine time must never claim to be the reader's local one. */
function clock(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return "--:--:--";
  return new Date(parsed).toISOString().slice(11, 19);
}

function Panel({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[14px] border border-line-2 bg-app p-4">
      <h2 className="text-[13px] font-semibold text-fg">{title}</h2>
      {note ? <p className="mt-0.5 text-[12px] text-fg-meta">{note}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Rows({ rows }: { rows: readonly { key: string; label: string; value: string }[] }) {
  if (rows.length === 0) {
    return <p className="font-mono text-[12px] text-fg-disabled">nothing in this window</p>;
  }
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 font-mono text-[12px]">
      {rows.map((row) => (
        <div key={row.key} className="contents">
          <dt className="truncate text-fg-muted">{row.label}</dt>
          <dd className="tabular-nums text-fg">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function OperatorConsole({ initial }: { initial: ConsoleSnapshot }) {
  const [snapshot, setSnapshot] = useState(initial);
  const [window_, setWindow] = useState<ConsoleWindow>(initial.window);
  const [failing, setFailing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const mounted = useRef(false);

  const refresh = useCallback(async () => {
    const result = await refreshConsoleAction(window_);
    if (result.ok) {
      setSnapshot(result.snapshot);
      setFailing(false);
    } else {
      // A denied poll means the allowlist changed underneath an open tab. The
      // page reload lets the server answer with notFound() rather than leaving
      // a console on screen that is no longer authorized.
      if (result.reason === "denied") globalThis.location.reload();
      else setFailing(true);
    }
  }, [window_]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer !== null) return;
      timer = setInterval(() => void refresh(), POLL_MS);
    };
    const stop = () => {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void refresh();
        start();
      } else stop();
    };

    /*
     * The page already rendered a server-built snapshot, so the first pass
     * only starts the timer. A later pass means the window changed, and that
     * asks immediately rather than waiting out a tick.
     */
    if (mounted.current) void refresh();
    else mounted.current = true;

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  // A separate, cheap tick so "12s ago" keeps counting between polls.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  const ageMs = Math.max(0, now - Date.parse(snapshot.takenAt));
  const { inFlight } = snapshot;

  return (
    <main className="mx-auto max-w-[1180px] px-8 py-10">
      <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line-2 pb-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-fg">Internal console</h1>
          <p className="mt-1 text-[13px] text-fg-muted">
            Read-only. No action here writes anything. Identifiers are truncated and no page, prompt
            or repository content is read.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex rounded-[10px] border border-line-2">
            {CONSOLE_WINDOWS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setWindow(option)}
                aria-pressed={option === window_}
                className={`px-3 py-1.5 font-mono text-[12px] first:rounded-l-[9px] last:rounded-r-[9px] ${
                  option === window_ ? "bg-mint-tint text-mint" : "text-fg-muted"
                }`}
              >
                {option}
              </button>
            ))}
          </div>
          <p
            className={`font-mono text-[12px] tabular-nums ${failing ? "text-coral" : "text-fg-meta"}`}
            aria-live="polite"
          >
            {failing ? "refresh failed · " : ""}
            {Math.round(ageMs / 1000)}s ago
          </p>
        </div>
      </header>

      {snapshot.truncated ? (
        <p className="mt-4 rounded-[10px] border border-amber-line bg-amber-tint-soft px-3 py-2 text-[12px] text-amber-deep">
          A query reached its bound, so the totals below are a floor rather than a total.
        </p>
      ) : null}

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <Panel
          title="Feed"
          note="Newest first, by the last thing that happened to the operation — not by when it started."
        >
          <ol className="max-h-[560px] overflow-y-auto font-mono text-[12px] leading-[1.7]">
            {snapshot.feed.length === 0 ? (
              <li className="text-fg-disabled">nothing in this window</li>
            ) : (
              snapshot.feed.map((line) => (
                <li
                  key={line.id}
                  className="flex gap-3 border-b border-line-1 py-1 last:border-b-0"
                >
                  <span className="shrink-0 tabular-nums text-fg-faint">{clock(line.at)}</span>
                  <span className={`w-[6.5rem] shrink-0 ${LEVEL_CLASS[line.level]}`}>
                    {line.status}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-fg-body">
                    {line.operationType}
                    <span className="text-fg-faint"> · {line.stage}</span>
                    {line.failureCode ? (
                      <span className="text-coral"> · {line.failureCode}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-fg-faint">{line.projectRef ?? "—"}</span>
                  <span className="w-16 shrink-0 text-right tabular-nums text-fg-meta">
                    {duration(line.durationMs)}
                  </span>
                </li>
              ))
            )}
          </ol>
        </Panel>

        <div className="grid gap-4">
          <Panel title="In flight" note="Every unfinished operation, regardless of window.">
            <Rows
              rows={[
                { key: "running", label: "running", value: String(inFlight.running) },
                { key: "queued", label: "queued", value: String(inFlight.queued) },
                {
                  key: "needs_user",
                  label: "waiting on a person",
                  value: String(inFlight.needsUser),
                },
              ]}
            />
            <p className="mt-3 border-t border-line-1 pt-2 font-mono text-[12px] text-fg-meta">
              {inFlight.oldest
                ? `oldest · ${inFlight.oldest.operationType} · ${inFlight.oldest.stage} · ${duration(inFlight.oldest.ageMs)}`
                : "nothing unfinished"}
            </p>
          </Panel>

          <Panel title="Provider spend" note="What the providers billed, not what a customer paid.">
            <Rows
              rows={snapshot.spend.map((row) => ({
                key: row.source,
                label: `${row.source} · ${row.events} events`,
                value: formatMicroUsd(row.microUsd),
              }))}
            />
          </Panel>

          <Panel title="Failures" note="Failed operations in this window, by code.">
            <Rows
              rows={snapshot.failures.map((row) => ({
                key: row.failureCode,
                label: row.failureCode,
                value: String(row.count),
              }))}
            />
          </Panel>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel title="Outcomes" note="Finished operations in this window, by type.">
          <Rows
            rows={snapshot.outcomes.map((row) => ({
              key: row.operationType,
              label: row.operationType,
              value: `${row.completed}✓ ${row.failed}✗${row.cancelled > 0 ? ` ${row.cancelled}⊘` : ""}`,
            }))}
          />
        </Panel>

        <Panel title="Onboarding" note="Where projects currently stand. States, never names.">
          <Rows
            rows={snapshot.funnel.map((row) => ({
              key: row.state,
              label: row.state,
              value: String(row.count),
            }))}
          />
        </Panel>

        <Panel title="Agent tools" note="What the gateway allowed and refused in this window.">
          <Rows
            rows={snapshot.tools.map((row) => ({
              key: row.tool,
              label: row.tool,
              value: `${row.allowed} ok${row.denied > 0 ? ` · ${row.denied} denied` : ""}${
                row.failed > 0 ? ` · ${row.failed} failed` : ""
              }`,
            }))}
          />
        </Panel>
      </div>
    </main>
  );
}
