import Link from "next/link";
import {
  ATTENTION_DISPLAY_LIMIT,
  type AttentionItem,
  type AttentionTier,
} from "@/modules/projects/attention";
import { buttonClasses } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import { MonoLabel } from "@/components/ui/typography";

/**
 * Needs your attention (Sprint UI-3).
 *
 * The dashboard's primary hierarchy. It sits above the project list because
 * the question this product answers is "what should I do next", not "what do
 * I own".
 *
 * Visually the strongest thing on the page — a level-2 surface where the
 * project rows are level 1 — but only **one** item carries a mint button: the
 * first. Four equally-loud primaries is the same as none, and mint is the
 * product's single accent rather than a way to say "important".
 */

const TIER_MARKER: Record<AttentionTier, string> = {
  blocked: "bg-coral",
  decision: "bg-amber",
  ready: "bg-mint",
  setup: "bg-fg-meta",
};

/**
 * The word beside the marker, so the tier is never carried by colour alone.
 * These are the product's own vocabulary for the states, not new terms.
 */
const TIER_LABEL: Record<AttentionTier, string> = {
  blocked: "Blocked",
  decision: "Waiting for you",
  ready: "Ready",
  setup: "Setup",
};

function AttentionRow({ item, index, primary }: { item: AttentionItem; index: number; primary: boolean }) {
  return (
    <li className="border-line-1 flex flex-col gap-3 border-b py-5 first:pt-0 last:border-b-0 last:pb-0 sm:flex-row sm:items-center sm:gap-6">
      <span className="text-fg-meta hidden font-mono text-xs tabular-nums sm:block">
        {String(index + 1).padStart(2, "0")}
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span aria-hidden className={`size-2 shrink-0 rounded-full ${TIER_MARKER[item.tier]}`} />
          <h3 className="text-fg text-[0.9375rem] font-semibold">{item.title}</h3>
          <MonoLabel className="tracking-[0.14em]">{TIER_LABEL[item.tier]}</MonoLabel>
        </div>
        <p className="text-fg-muted text-sm">{item.detail}</p>
        <p className="text-fg-meta font-mono text-meta">{item.projectName}</p>
      </div>

      <div className="shrink-0">
        <Link
          href={item.action.href}
          className={buttonClasses({ variant: primary ? "primary" : "secondary", size: "sm" })}
        >
          {item.action.label}
          {/* The label repeats across rows, so the accessible name says which
              one it belongs to. */}
          <span className="sr-only"> — {item.title}, {item.projectName}</span>
        </Link>
      </div>
    </li>
  );
}

export function AttentionList({ items }: { items: AttentionItem[] }) {
  const shown = items.slice(0, ATTENTION_DISPLAY_LIMIT);
  const remaining = items.length - shown.length;

  return (
    <Surface
      as="section"
      level="panel"
      padding="lg"
      aria-labelledby="attention-heading"
      className="flex flex-col gap-4"
    >
      {/* A real heading, not just a styled label: this is the page's most
          important section and it has to appear in the document outline. */}
      <MonoLabel as="h2" id="attention-heading">
        Next up
      </MonoLabel>
      <ul className="flex flex-col">
        {shown.map((item, index) => (
          <AttentionRow key={item.id} item={item} index={index} primary={index === 0} />
        ))}
      </ul>
      {remaining > 0 && (
        // Stated rather than expanded. A dashboard that lists fourteen
        // warnings has stopped being a dashboard.
        <p className="text-fg-muted text-xs">
          {remaining} more {remaining === 1 ? "item needs" : "items need"} attention across your
          projects.
        </p>
      )}
    </Surface>
  );
}
