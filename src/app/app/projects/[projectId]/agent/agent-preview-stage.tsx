"use client";

import Image from "next/image";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { useStageNavigation } from "./agent-stage-navigation";
import { buttonClasses } from "@/components/ui/button";
import { useDocumentVisible } from "@/lib/client/use-document-visible";
import { MonoLabel } from "@/components/ui/typography";
import { cn } from "@/lib/utils/cn";

/**
 * Stage four — before and after (UI-19, artboard 2d).
 *
 * ## The composition, and the one thing it is for
 *
 * Two frames at the same size, side by side, with the after frame carrying a
 * mint sweep so the eye lands on the thing that changed. Everything else on the
 * screen — the rail of named changes, the totals, the button — is support for
 * that one comparison.
 *
 * Both images are captures Vibe took of the founder's own product, served
 * through short-lived signed URLs that are minted per request and never
 * persisted. An artifact that is still capturing, failed, or past its retention
 * deadline produces no URL at all, so this renders the absence rather than a
 * broken frame.
 *
 * ## Change summary
 *
 * `filesChanged` is Vibe's verified count. Line counts are optional and absent
 * by default because **no such statistic is stored**: a prepared change holds
 * the file contents, not a diff against the base, and computing one here would
 * mean a GitHub read per file on a page load. The rows appear when a caller can
 * supply them truthfully and stay away when nobody can.
 */

export type PreviewChange = {
  /** What changed, in Vibe's words. */
  title: string;
  detail: string;
  kind: "added" | "connected" | "improved";
};

export type PreviewImages = {
  beforeUrl: string;
  afterUrl: string;
  route: string;
  width: number | null;
  height: number | null;
};

const KIND_ICON = {
  added: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v8M8 12h8" />
    </>
  ),
  connected: (
    <>
      <path d="M10 13.5a4 4 0 0 0 5.7.4l2.6-2.6a4 4 0 0 0-5.7-5.7l-1.5 1.5" />
      <path d="M14 10.5a4 4 0 0 0-5.7-.4L5.7 12.7a4 4 0 0 0 5.7 5.7l1.5-1.5" />
    </>
  ),
  improved: (
    <>
      <path d="M12 3c.6 3.5 2.5 5.4 6 6-3.5.6-5.4 2.5-6 6-.6-3.5-2.5-5.4-6-6 3.5-.6 5.4-2.5 6-6Z" />
    </>
  ),
} as const;

function Frame({
  label,
  src,
  route,
  highlight,
  animate,
}: {
  label: string;
  src: string | null;
  route: string;
  highlight?: boolean;
  animate: boolean;
}) {
  return (
    <figure className="flex min-w-0 flex-col gap-2.5">
      <figcaption className="flex items-center gap-2">
        <MonoLabel className={highlight ? "text-mint" : "text-fg-meta"}>{label}</MonoLabel>
      </figcaption>
      <div
        className={cn(
          "rounded-well relative aspect-[4/3] overflow-hidden border",
          highlight ? "border-mint-line" : "border-line-2",
        )}
      >
        {src === null ? (
          <div className="bg-well text-fg-muted flex h-full items-center justify-center px-6 text-center text-sm">
            No capture available for this change.
          </div>
        ) : (
          <>
            <Image
              src={src}
              alt={`${label}: ${route}`}
              fill
              sizes="(min-width: 1280px) 32rem, 100vw"
              className="object-cover object-top"
              unoptimized
            />
            {/*
              The sweep, on the after frame only. It draws the eye and says
              nothing — there is no claim in it about how much changed.
            */}
            {highlight && animate && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 w-1/4"
                style={{
                  background:
                    "linear-gradient(90deg, transparent, color-mix(in oklab, var(--color-mint) 22%, transparent), transparent)",
                  animation: "vibe-sweep 3.6s var(--ease-vibe) infinite",
                }}
              />
            )}
          </>
        )}
      </div>
    </figure>
  );
}

export function AgentPreviewStage({
  images,
  changes,
  filesChanged,
  linesAdded,
  linesRemoved,
  filesHref,
}: {
  images: PreviewImages | null;
  changes: readonly PreviewChange[];
  filesChanged: number;
  linesAdded?: number;
  linesRemoved?: number;
  filesHref?: string;
}) {
  const reduceMotion = useReducedMotion();
  const visible = useDocumentVisible();
  const { go } = useStageNavigation();
  const animate = !reduceMotion && visible;

  return (
    <div
      className="grid min-w-0 gap-8 xl:grid-cols-[minmax(0,1.7fr)_minmax(19rem,1fr)]"
      data-testid="agent-preview"
    >
      <div className="flex min-w-0 flex-col gap-5">
        <div className="flex flex-col gap-2">
          <MonoLabel className="text-mint">Stage 4 of 5</MonoLabel>
          <h3 className="text-fg text-2xl leading-tight font-bold tracking-[-0.03em]">
            Your change is ready to preview
          </h3>
          <p className="text-fg-muted max-w-[46ch] text-[0.9375rem] leading-relaxed">
            Vibe has prepared the changes below. Review what&rsquo;s new before deciding.
          </p>
        </div>

        <div className="grid items-start gap-4 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <Frame
            label="Before"
            src={images?.beforeUrl ?? null}
            route={images?.route ?? ""}
            animate={animate}
          />
          <span
            aria-hidden="true"
            className="border-line-3 text-fg-secondary mt-9 hidden size-8 items-center justify-center self-center rounded-full border sm:flex"
          >
            <svg
              viewBox="0 0 24 24"
              width="15"
              height="15"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={animate ? { animation: "vibe-arrow-nudge 2.2s var(--ease-vibe) infinite" } : undefined}
            >
              <path d="M4 12h16m-6-6 6 6-6 6" />
            </svg>
          </span>
          <Frame
            label="After (preview)"
            src={images?.afterUrl ?? null}
            route={images?.route ?? ""}
            highlight
            animate={animate}
          />
        </div>
      </div>

      <aside className="flex min-w-0 flex-col gap-6">
        {changes.length > 0 && (
          <section className="flex flex-col gap-3.5">
            <MonoLabel as="h3" className="text-mint">
              What changed
            </MonoLabel>
            <ul className="flex flex-col gap-3.5">
              {changes.map((change, index) => (
                <motion.li
                  key={change.title}
                  className="flex gap-3"
                  initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: 0.4,
                    ease: [0.2, 0.7, 0.2, 1],
                    delay: reduceMotion ? 0 : index * 0.08,
                  }}
                >
                  <span className="border-mint-line bg-mint-tint text-mint flex size-8 flex-none items-center justify-center rounded-[10px] border">
                    <svg
                      viewBox="0 0 24 24"
                      width="16"
                      height="16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      {KIND_ICON[change.kind]}
                    </svg>
                  </span>
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="text-fg-body text-sm font-semibold">{change.title}</span>
                    <span className="text-fg-muted text-[0.8125rem] leading-relaxed">
                      {change.detail}
                    </span>
                  </span>
                </motion.li>
              ))}
            </ul>
          </section>
        )}

        <section className="flex flex-col gap-3">
          <MonoLabel as="h3" className="text-fg-secondary">
            Change summary
          </MonoLabel>
          <dl className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-fg-muted text-sm">Files changed</dt>
              <dd className="text-fg font-mono text-sm">{filesChanged}</dd>
            </div>
            {linesAdded !== undefined && (
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-fg-muted text-sm">Lines added</dt>
                <dd className="text-mint font-mono text-sm">+{linesAdded}</dd>
              </div>
            )}
            {linesRemoved !== undefined && (
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-fg-muted text-sm">Lines removed</dt>
                <dd className="text-coral font-mono text-sm">−{linesRemoved}</dd>
              </div>
            )}
          </dl>
        </section>

        <div className="flex flex-col gap-2.5">
          {/*
            Forward, not down. This was an anchor to the merge panel lower on
            the page, so pressing it scrolled and left the founder on stage four
            looking at two preview frames. The step it moves the run to is stage
            five, so it puts them on stage five.
          */}
          <button
            type="button"
            onClick={() => go?.("review")}
            disabled={go === null}
            className={cn(buttonClasses({ variant: "primary" }), "justify-center")}
          >
            Review changes
          </button>
          <p className="text-fg-meta text-center text-xs">
            Nothing is live yet. You&rsquo;re in control.
          </p>
          {filesHref !== undefined && (
            <Link
              href={filesHref}
              className="text-fg-muted hover:text-fg-body text-center text-[0.8125rem] underline underline-offset-4"
            >
              View changed files ({filesChanged})
            </Link>
          )}
        </div>
      </aside>
    </div>
  );
}
