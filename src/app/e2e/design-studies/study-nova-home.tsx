import type { CSSProperties, ReactNode } from "react";
import { CostDisclosure } from "@/components/system/cost-disclosure";
import { statusForFocusTier } from "@/components/system/status-vocabulary";
import { creditsToUnits } from "@/modules/credits/units";
import { NOVA_ACTION_META } from "@/modules/nova/actions";
import type { RetailOperationKind } from "@/modules/credits/retail";
import type { NovaHomeEntry, NovaHomeView } from "@/modules/nova/home-view";
import { novaScenarioHealth, novaScenarioView, NOVA_SCENARIO_PRIORITY } from "../nova-scenarios";
import type { Study } from "./studies";

/**
 * Nova Home, rendered as a direction study.
 *
 * ## Why the markup is study-local and the data is not
 *
 * The presentation is new — that is the whole point of a study, and
 * `DESIGN.md` permits redesigning a component's presentation as long as its
 * semantics, props and states survive. What is *not* re-decided here is any
 * claim about the product: the view models come from `buildNovaHomeView` over
 * `deriveNovaFocus`, the same functions production calls, and the status word
 * beside every entry comes from `statusForFocusTier` rather than from a table
 * this file invented. A study that made up its own ranking or its own status
 * words would be a mood board, and it would look good for reasons the product
 * could never reproduce.
 *
 * ## Why `nova-review`
 *
 * It is the only fixture whose facts raise three candidates at once, so it is
 * the only one that shows the thing Home is actually for: one action
 * dominating while two more stay visible and subordinate. It also carries a
 * priced entry in the stack, which puts a real Credit price on screen beside
 * an unpressed control — the single most Vibe-specific moment on the page.
 */

const SCENARIO = "nova-review" as const;

/** The stagger index, as a typed custom property rather than a cast. */
function rise(index: number): CSSProperties {
  return { "--i": index } as CSSProperties;
}

/** Tone → the study's own surface treatment. Colour is never the only signal. */
const TONE_CLASS: Record<string, string> = {
  active: "border-mint-line bg-mint-tint-soft text-mint",
  waiting: "border-amber-line bg-amber-tint-soft text-amber",
  blocked: "border-coral-line bg-coral-tint-soft text-coral",
  neutral: "border-line-3 bg-surface-2 text-fg-secondary",
  done: "border-line-3 bg-surface-2 text-fg-secondary",
};

function Pill({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-label font-semibold tracking-[0.14em] uppercase ${
        TONE_CLASS[tone] ?? TONE_CLASS.neutral
      }`}
    >
      {children}
    </span>
  );
}

function Label({ children }: { children: ReactNode }) {
  return (
    <p className="text-label font-mono tracking-[0.16em] text-fg-meta uppercase">{children}</p>
  );
}

/**
 * The retail kind a control charges under, or null when it charges nothing.
 *
 * `NOVA_ACTION_META[...].price` is a `RetailOperationKind` — `business_audit`,
 * not a number — and resolving it to Credits is `CostDisclosure`'s job, under
 * the rate card in force. An earlier draft of this file printed the field
 * directly and rendered "business_audit Credits" on screen, which is exactly
 * the raw-enum leak the product keeps a component to prevent.
 */
function retailKindOf(entry: NovaHomeEntry): RetailOperationKind | null {
  if (entry.control.kind !== "server_action") return null;
  return NOVA_ACTION_META[entry.control.option.actionId].price ?? null;
}

/**
 * The fixture balance, built through `creditsToUnits` rather than cast — the
 * same reason the Nova fixture gives. A raw `420` is 420 internal units, which
 * is 0.42 Credits, and would render an affordable price as unaffordable.
 */
const STUDY_BALANCE = { availableCredits: creditsToUnits(420), display: "420" };

function controlLabel(entry: NovaHomeEntry): string | null {
  const control = entry.control;
  if (control.kind === "none") return null;
  return control.kind === "elsewhere" ? control.label : control.option.label;
}

export function StudyNovaHome({ study }: { study: Study }) {
  const view: NovaHomeView = novaScenarioView(SCENARIO);
  const health = novaScenarioHealth(SCENARIO);
  const primary = view.primary;
  const status = statusForFocusTier(primary.tier);
  const priceKind = retailKindOf(primary);
  const action = controlLabel(primary);

  const glass = study.id === "a";
  const serif = study.id === "c";
  /* Study C's display face, applied where the study argues type carries the
     material. Declared inline because it is one study's exception, not a
     token every direction has. */
  const displayFont = serif ? { fontFamily: "var(--font-serif)" } : undefined;

  /*
    Study C is not a box direction. Its own thesis is hairline rules and almost
    no fill, and the first render contradicted it — three rounded panels with
    a serif headline inside, which reads as A with a different font rather than
    as a third direction. A study that argues one thing and shows another is
    worse than no study, so C separates with rules and spends its contrast on
    the type.
  */
  const editorial = study.id === "c";
  const cardSkin = glass
    ? "study-glass study-glass-sheen rounded-card"
    : study.id === "b"
      ? "study-panel rounded-card"
      : "border-t border-line-3 bg-transparent";
  const sectionSkin = editorial
    ? "border-t border-line-1 bg-transparent"
    : "rounded-panel border border-line-2 bg-surface-1";
  const blockerSkin = glass
    ? "study-glass study-glass-sheen rounded-card"
    : editorial
      ? "border-t border-line-3 bg-transparent"
      : "rounded-card border border-line-2 bg-surface-1";

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-12 max-sm:px-4 max-sm:py-8">
      <StudyChrome study={study} />

      <main className="flex flex-col gap-7">
        {/* ── Product identity ─────────────────────────────────────── */}
        <header className="study-rise flex flex-wrap items-center gap-4" style={rise(0)}>
          <span
            aria-hidden
            className="grid size-11 place-items-center rounded-nav border border-line-3 bg-surface-2 text-title font-semibold text-fg"
          >
            P
          </span>
          <div className="min-w-0">
            <h1 className="text-title font-semibold tracking-tight text-fg" style={displayFont}>
              Payflow
            </h1>
            <p className="text-caption text-fg-meta">Developer tool · Confirmed by you</p>
          </div>
        </header>

        {/* ── The focus card ───────────────────────────────────────── */}
        <section
          className={`study-rise study-press relative overflow-hidden ${editorial ? "px-0 pt-9 pb-10" : "p-8 max-sm:p-5"} ${cardSkin}`}
          style={rise(1)}
          aria-labelledby="study-focus-heading"
        >
          {/*
            Study B's light: a single directional band across the top of the
            focused element. Not ambience — it exists to say *this one*, and it
            appears on exactly one card per screen.
          */}
          {study.id === "b" && (
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-px"
              style={{
                background:
                  "linear-gradient(90deg, transparent, var(--color-mint) 32%, var(--color-mint) 68%, transparent)",
                opacity: 0.7,
              }}
            />
          )}

          <div className="flex items-center gap-3">
            {/* Nova's presence. The one element that moves continuously, and
                only while there is something to attend to. */}
            <span aria-hidden className="relative grid size-3 place-items-center">
              <span className="study-breathe absolute inset-0 rounded-full bg-mint" />
              <span className="absolute inset-0 rounded-full bg-mint opacity-40" />
            </span>
            <Label>Nova</Label>
            <Pill tone={status.tone}>{status.word}</Pill>
          </div>

          <h2
            id="study-focus-heading"
            className="mt-5 text-headline font-semibold text-balance text-fg"
            style={displayFont}
          >
            {primary.message}
          </h2>

          {primary.detail && (
            <p className="study-measure mt-3 text-lead text-fg-prose">{primary.detail}</p>
          )}

          {primary.prompt && (
            <p className="study-measure mt-4 text-ui text-fg-secondary">{primary.prompt}</p>
          )}

          {action && (
            <div className="mt-7 flex flex-wrap items-center gap-x-4 gap-y-2">
              <button
                type="button"
                className="study-press rounded-nav bg-mint px-5 py-2.5 text-ui font-semibold text-mint-ink"
              >
                {action}
              </button>
              {/* The price sits beside the control, before it is pressed.
                  Absent means free-or-unpriced, and renders nothing rather
                  than the word "free" — the billing decision this product
                  already made. */}
              <CostDisclosure operation={priceKind} balance={STUDY_BALANCE} />
            </div>
          )}
        </section>

        {/* ── The stack ────────────────────────────────────────────── */}
        {view.secondary.length > 0 && (
          <section className="study-rise flex flex-col gap-3" style={rise(2)}>
            <Label>Also waiting</Label>
            <ul className={`flex flex-col divide-y divide-line-1 ${sectionSkin}`}>
              {view.secondary.map((entry) => {
                const entryStatus = statusForFocusTier(entry.tier);
                const entryKind = retailKindOf(entry);
                const entryAction = controlLabel(entry);
                return (
                  <li
                    key={entry.id}
                    className={`study-press flex flex-wrap items-center gap-x-4 gap-y-2 py-4 hover:bg-surface-hover ${editorial ? "px-0" : "px-5"}`}
                  >
                    <Pill tone={entryStatus.tone}>{entryStatus.word}</Pill>
                    <span className="min-w-0 flex-1 text-ui text-fg-body">{entry.message}</span>
                    <CostDisclosure operation={entryKind} balance={STUDY_BALANCE} />
                    {entryAction && (
                      <span className="text-caption font-semibold text-mint">{entryAction} →</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* ── Health ───────────────────────────────────────────────── */}
        {health && (
          <section
            className={`study-rise grid gap-6 sm:grid-cols-[auto_1fr] sm:items-center ${editorial ? "py-7" : "p-6"} ${sectionSkin}`}
            style={rise(3)}
          >
            <div className="flex items-baseline gap-2">
              <span className="text-hero font-semibold tabular-nums text-fg" style={displayFont}>
                {health.score ?? "—"}
              </span>
              <span className="text-caption text-fg-meta">/ 100</span>
            </div>
            <div>
              <p className="text-title font-semibold text-fg" style={displayFont}>
                {health.stateLabel}
              </p>
              {/* Coverage, always. An average over 7 of 9 areas is a different
                  claim from an average over 9, and the product says which. */}
              <p className="mt-1 text-caption text-fg-secondary">
                Scored {health.scoredLenses} of {health.eligibleLenses} applicable areas
              </p>
              {health.insufficientCoverageReason && (
                <p className="mt-2 text-caption text-amber">{health.insufficientCoverageReason}</p>
              )}
            </div>
          </section>
        )}

        {/* ── The first blocker ────────────────────────────────────── */}
        <section
          className={`study-rise ${editorial ? "pt-8 pb-10" : "p-7 max-sm:p-5"} ${blockerSkin}`}
          style={rise(4)}
        >
          <div className="flex flex-wrap items-center gap-3">
            <Pill tone="blocked">Critical</Pill>
            <Label>First blocker</Label>
          </div>
          <h3 className="mt-4 text-title font-semibold text-balance text-fg" style={displayFont}>
            {NOVA_SCENARIO_PRIORITY.headline}
          </h3>
          <p className="study-measure mt-3 text-lead text-fg-prose">
            {NOVA_SCENARIO_PRIORITY.explanation}
          </p>
          <p className="study-measure mt-2 text-lead text-fg-secondary">
            {NOVA_SCENARIO_PRIORITY.whyItMatters}
          </p>

          {/* Citations. The count is the control that opens evidence, and it
              is the only way in — a finding never asserts without one. */}
          <ul className="mt-5 flex flex-wrap gap-2">
            {NOVA_SCENARIO_PRIORITY.citations.map((citation) => (
              <li
                key={citation.detail}
                className="rounded-full border border-line-3 bg-surface-2 px-3 py-1 text-caption text-fg-secondary"
              >
                {citation.detail} · <span className="text-fg-meta">{citation.source}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}

/**
 * Lab chrome: what this study is, printed on the study.
 *
 * Deliberately inside the screenshot. Three PNGs of three dark screens are
 * indistinguishable in a folder, and a caption that lives somewhere else is a
 * caption that will be wrong by the second round.
 */
function StudyChrome({ study }: { study: Study }) {
  return (
    <div className="flex flex-col gap-3 rounded-panel border border-dashed border-line-3 bg-well p-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-label font-mono tracking-[0.16em] text-fg-meta uppercase">
          Study {study.id.toUpperCase()}
        </span>
        <span className="text-title font-semibold text-fg">{study.name}</span>
      </div>
      <p className="study-measure text-ui text-fg-prose">{study.thesis}</p>
      <p className="study-measure text-caption text-fg-muted">{study.material}</p>
      <dl className="mt-1 flex flex-wrap gap-x-8 gap-y-2 text-caption">
        <div className="flex items-center gap-2">
          <dt className="text-fg-meta">Accent</dt>
          <dd className="flex items-center gap-2 text-fg-body">
            <span
              aria-hidden
              className="size-3 rounded-full border border-line-4"
              style={{ background: study.accent }}
            />
            {study.accentName} <span className="font-mono text-fg-meta">{study.accent}</span>
          </dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="text-fg-meta">Typeface</dt>
          <dd className="text-fg-body">{study.typeface}</dd>
        </div>
      </dl>
    </div>
  );
}
