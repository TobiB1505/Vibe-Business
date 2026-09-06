"use client";

import { useState, type ReactNode } from "react";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { CheckIcon, ChevronDownIcon } from "@/components/ui/icons.generated";
import { FilterIcon } from "@/components/ui/dashboard-icons";
import { cn } from "@/lib/utils/cn";
import type { Study } from "./studies";

/**
 * The form controls: what converged, and the two things that did not.
 *
 * ## What this study is answering
 *
 * Not the well — that is settled. Every text-entry surface in the product now
 * comes from `field.tsx`, because five hand-written ones had produced four
 * fills, three borders and two focus treatments between them, with the first
 * two in the same file. The top section is here as the reference: the result,
 * beside one of the things it replaced, so the convergence can be seen rather
 * than taken on trust.
 *
 * The two sections under it are open questions, and they are open for the same
 * reason: **neither control is a field, and both are currently dressed as
 * one.**
 *
 * 1. **The list filter.** It changes what you are looking at. It does not
 *    collect an answer, nothing is submitted, and there is no such thing as
 *    getting it wrong. A well says "fill this in", which is the one thing a
 *    filter never asks for.
 * 2. **The choice.** Six of these exist and three of them already know they
 *    are not radio buttons — they hide the input with `sr-only` and draw a
 *    card. The other three render the platform's dot. So the product has both
 *    conventions, on the same question type, and one of them was chosen by
 *    whoever wrote the screen.
 *
 * ## Why the variants are drawn rather than described
 *
 * A filter and a choice card are both mostly *weight* — how much border, how
 * much fill, how loud the selected state is. That is invisible in prose and
 * obvious in a picture at real size next to real content.
 */

function Section({
  title,
  question,
  children,
}: {
  title: string;
  question: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-title text-fg font-semibold">{title}</h2>
        <p className="text-fg-muted max-w-2xl text-body">{question}</p>
      </div>
      {children}
    </section>
  );
}

function Variant({ label, note, children }: { label: string; note: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-fg-body text-ui font-medium">{label}</span>
        <span className="text-fg-meta text-caption">{note}</span>
      </div>
      <div className="border-line-2 bg-surface-1 rounded-well border p-5">{children}</div>
    </div>
  );
}

/* ── The well, converged ───────────────────────────────────────────── */

/** One of the five that were replaced, verbatim, for the comparison. */
const REPLACED =
  "border-line-3 bg-surface-1 text-fg placeholder:text-fg-meta focus:border-mint-line " +
  "focus:ring-mint min-h-28 resize-none rounded-xl border px-3 py-2 text-body leading-relaxed " +
  "outline-none focus:ring-1";

function TheWell() {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Variant
        label="Now — one well, three shapes"
        note="Input, Textarea and Select all apply inputClassName. The shape is the only difference."
      >
        <div className="flex flex-col gap-4">
          <Field id="study-name" label="Product name">
            <Input id="study-name" defaultValue="Vibe Business" />
          </Field>
          <Field
            id="study-note"
            label="What Vibe should know"
            hint="Do not include passwords, credentials, API keys, or tokens."
          >
            <Textarea
              id="study-note"
              rows={3}
              aria-describedby="study-note-hint"
              placeholder="Write the direction or information Vibe should use."
            />
          </Field>
          <Field id="study-stage" label="Stage">
            <Select id="study-stage" defaultValue="building">
              <option value="">Not specified</option>
              <option value="building">Building</option>
              <option value="launched">Launched</option>
            </Select>
          </Field>
        </div>
      </Variant>

      <Variant
        label="Before — the same three, as written"
        note="A lighter fill, a softer border, a one-pixel focus ring, and a select wearing the platform's arrow."
      >
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-2">
            <span className="text-fg-muted text-caption">Product name</span>
            <input
              defaultValue="Vibe Business"
              className="border-line-strong bg-field text-fg-body w-full rounded-md border px-3 py-1.5 text-body focus:border-mint/60 focus:ring-4 focus:ring-mint/10 focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-fg-muted text-caption">What Vibe should know</span>
            <textarea
              rows={3}
              className={REPLACED}
              placeholder="Write the direction or information Vibe should use."
            />
            <span className="text-fg-muted text-caption">
              Do not include passwords, credentials, API keys, or tokens.
            </span>
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-fg-muted text-caption">Stage</span>
            <select
              defaultValue="building"
              className="border-line-strong bg-field text-fg-body w-full rounded-md border px-3 py-1.5 text-body focus:border-mint/60 focus:ring-4 focus:ring-mint/10 focus:outline-none"
            >
              <option value="">Not specified</option>
              <option value="building">Building</option>
              <option value="launched">Launched</option>
            </select>
          </label>
        </div>
      </Variant>
    </div>
  );
}

/* ── The filter ────────────────────────────────────────────────────── */

const VISIBILITY = [
  { value: "all", label: "All visibility" },
  { value: "private", label: "Private" },
  { value: "public", label: "Public" },
];

/** What ships: the filter in a field's clothes. */
function FilterToday() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="border-line-2 bg-field rounded-nav text-fg-muted flex items-center gap-2 border px-3 py-2.5 text-body">
        <FilterIcon size={15} />
        <span className="sr-only">Filter repository visibility</span>
        <select
          defaultValue="all"
          className="text-fg-body bg-transparent text-body font-medium outline-none"
        >
          {VISIBILITY.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="border-line-2 bg-field rounded-nav flex items-center gap-2 border px-3 py-2.5">
        <span className="text-fg-meta text-caption font-medium">Sort:</span>
        <select
          defaultValue="recent"
          className="text-fg-body bg-transparent text-body font-semibold outline-none"
        >
          <option value="recent">Connected</option>
          <option value="name">Repository</option>
        </select>
      </label>
    </div>
  );
}

/**
 * F1 — the field, properly.
 *
 * The honest version of what ships: stop half-dressing it and use `Select`.
 * Cheapest possible answer, and it says the wrong thing loudly rather than
 * quietly.
 */
function FilterAsField() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select defaultValue="all" className="w-auto">
        {VISIBILITY.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
      <Select defaultValue="recent" className="w-auto">
        <option value="recent">Connected first</option>
        <option value="name">By repository</option>
      </Select>
    </div>
  );
}

/**
 * F2 — a control, not a container.
 *
 * No well, no border at rest. The label is the current value and the chevron
 * is the affordance; the surface appears on hover and focus, which is what
 * every other quiet control in the product does. Reads as chrome above a list
 * rather than as a form the list is inside.
 */
function FilterAsControl() {
  const trigger =
    "text-fg-body inline-flex items-center gap-2 rounded-nav border border-transparent " +
    "px-2.5 py-1.5 text-ui font-medium transition-interactive " +
    "hover:border-line-2 hover:bg-surface-hover " +
    "focus-within:border-line-2 focus-within:bg-surface-hover";
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-fg-meta text-caption pr-1">Showing</span>
      <label className={trigger}>
        <span className="sr-only">Filter repository visibility</span>
        <select
          defaultValue="all"
          className="appearance-none bg-transparent text-ui font-medium outline-none"
        >
          {VISIBILITY.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDownIcon aria-hidden size={14} className="text-fg-meta pointer-events-none" />
      </label>
      <span className="text-fg-meta text-caption px-1">sorted by</span>
      <label className={trigger}>
        <span className="sr-only">Sort repositories</span>
        <select
          defaultValue="recent"
          className="appearance-none bg-transparent text-ui font-medium outline-none"
        >
          <option value="recent">connected</option>
          <option value="name">repository</option>
        </select>
        <ChevronDownIcon aria-hidden size={14} className="text-fg-meta pointer-events-none" />
      </label>
    </div>
  );
}

/**
 * F3 — the segment.
 *
 * Three options is few enough to show all of them, so nothing has to be opened
 * to find out what the alternatives are. Trades width for that, and stops
 * working the moment a filter has eight options — which is the question this
 * variant is really asking: will these lists ever have more?
 */
function FilterAsSegments() {
  const [visibility, setVisibility] = useState("all");
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div
        role="group"
        aria-label="Filter repository visibility"
        className="border-line-2 bg-field rounded-nav inline-flex items-center gap-0.5 border p-0.5"
      >
        {VISIBILITY.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setVisibility(option.value)}
            aria-pressed={visibility === option.value}
            className={cn(
              "rounded-[calc(var(--radius-nav)-2px)] px-3 py-1.5 text-ui font-medium",
              "transition-interactive",
              visibility === option.value
                ? "bg-surface-3 text-fg shadow-raise"
                : "text-fg-muted hover:text-fg-body",
            )}
          >
            {option.label === "All visibility" ? "All" : option.label}
          </button>
        ))}
      </div>
      <label className="text-fg-muted flex items-center gap-1.5 text-ui">
        <span className="text-fg-meta text-caption">Sort:</span>
        <select
          defaultValue="recent"
          className="text-fg-body appearance-none bg-transparent text-ui font-medium outline-none"
        >
          <option value="recent">Connected</option>
          <option value="name">Repository</option>
        </select>
        <ChevronDownIcon aria-hidden size={14} className="text-fg-meta pointer-events-none" />
      </label>
    </div>
  );
}

/* ── The choice ────────────────────────────────────────────────────── */

const CHOICES = [
  {
    value: "checkout",
    label: "Add a checkout page",
    detail: "The payments integration exists and nothing on the site reaches it.",
  },
  {
    value: "pricing",
    label: "Publish pricing first",
    detail: "Visitors can see what it costs before they are asked to pay.",
  },
  {
    value: "wait",
    label: "Neither — not yet",
    detail: "Vibe leaves this alone and asks again after the next audit.",
  },
];

function useChoice() {
  return useState("checkout");
}

/** What ships in three of the six places: the platform's dot, in mint. */
function ChoiceToday() {
  const [choice, setChoice] = useChoice();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="sr-only">What should Vibe do</legend>
      {CHOICES.map((option) => (
        <label
          key={option.value}
          className="border-line-3 hover:border-line-4 has-checked:border-mint/60 flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 transition-[border-color]"
        >
          <input
            type="radio"
            name="today"
            value={option.value}
            checked={choice === option.value}
            onChange={() => setChoice(option.value)}
            className="accent-mint"
          />
          <span className="text-fg-body text-body">{option.label}</span>
        </label>
      ))}
    </fieldset>
  );
}

/**
 * C1 — the card, as the other three already draw it.
 *
 * Not a new design: this is what `founder-input-card` does, promoted to being
 * the convention. The input is `sr-only`, the whole card is the hit area, and
 * selection is a mint border over a mint tint. Adopting it means the product
 * stops having two answers; it does not mean anybody designed the answer.
 */
function ChoiceAsCard() {
  const [choice, setChoice] = useChoice();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="sr-only">What should Vibe do</legend>
      {CHOICES.map((option) => {
        const selected = choice === option.value;
        return (
          <label
            key={option.value}
            className={cn(
              "flex cursor-pointer flex-col gap-1 rounded-well border px-4 py-3",
              "transition-interactive",
              selected
                ? "border-mint bg-mint-tint-soft"
                : "border-line-3 bg-surface-2 hover:border-line-strong hover:bg-surface-hover",
            )}
          >
            <input
              type="radio"
              name="card"
              value={option.value}
              checked={selected}
              onChange={() => setChoice(option.value)}
              className="sr-only"
            />
            <span className="text-fg text-body font-medium">{option.label}</span>
            <span className="text-fg-muted text-caption">{option.detail}</span>
          </label>
        );
      })}
    </fieldset>
  );
}

/**
 * C2 — the card with a mark.
 *
 * The objection to C1 is that a tinted border is the entire selected state, so
 * on a colour-blind reading, a dim screen or a screenshot, "selected" and
 * "hovered" are close. This keeps the card and puts back the one thing the
 * platform's dot was actually doing — a mark that is either there or not — as
 * a check in a mint disc, which is how the product already says done.
 */
function ChoiceAsMarkedCard() {
  const [choice, setChoice] = useChoice();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="sr-only">What should Vibe do</legend>
      {CHOICES.map((option) => {
        const selected = choice === option.value;
        return (
          <label
            key={option.value}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-well border px-4 py-3",
              "transition-interactive",
              selected
                ? "border-mint bg-mint-tint-soft"
                : "border-line-3 bg-surface-2 hover:border-line-strong hover:bg-surface-hover",
            )}
          >
            <input
              type="radio"
              name="marked"
              value={option.value}
              checked={selected}
              onChange={() => setChoice(option.value)}
              className="sr-only"
            />
            <span
              aria-hidden
              className={cn(
                "mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full border",
                "transition-interactive",
                selected ? "border-mint bg-mint text-ink" : "border-line-strong bg-surface-1",
              )}
            >
              {selected && <CheckIcon size={12} strokeWidth={2.5} />}
            </span>
            <span className="flex flex-col gap-1">
              <span className="text-fg text-body font-medium">{option.label}</span>
              <span className="text-fg-muted text-caption">{option.detail}</span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

/**
 * C3 — the rail.
 *
 * No box per option. One rule down the left, and the selected row takes a mint
 * rail and the full-strength text while the others sit muted. Much quieter
 * than a stack of cards, and the reason to consider it is that several of
 * these questions sit *inside* a card already — a card inside a card is the
 * thing every one of these screens is currently doing.
 */
function ChoiceAsRail() {
  const [choice, setChoice] = useChoice();
  return (
    <fieldset className="border-line-2 flex flex-col border-l">
      <legend className="sr-only">What should Vibe do</legend>
      {CHOICES.map((option) => {
        const selected = choice === option.value;
        return (
          <label
            key={option.value}
            className={cn(
              "-ml-px flex cursor-pointer flex-col gap-1 border-l-2 py-2.5 pl-4",
              "transition-interactive",
              selected ? "border-mint" : "hover:border-line-4 border-transparent",
            )}
          >
            <input
              type="radio"
              name="rail"
              value={option.value}
              checked={selected}
              onChange={() => setChoice(option.value)}
              className="sr-only"
            />
            <span className={cn("text-body", selected ? "text-fg font-medium" : "text-fg-muted")}>
              {option.label}
            </span>
            <span className="text-fg-meta text-caption">{option.detail}</span>
          </label>
        );
      })}
    </fieldset>
  );
}

/* ── The study ─────────────────────────────────────────────────────── */

export function StudyForms({ study }: { study: Study }) {
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-14 px-6 py-14">
      <header className="flex flex-col gap-2">
        <p className="text-fg-meta text-caption tracking-wide uppercase">Forms — {study.name}</p>
        <h1 className="text-display text-fg font-semibold">
          One well, and two controls that are not fields
        </h1>
        <p className="text-fg-muted max-w-2xl text-body">
          The text-entry surfaces converged. The filter and the choice did not, because neither of
          them is a field and both are currently dressed as one.
        </p>
      </header>

      <Section
        title="The well"
        question="Settled. Every input, textarea and select in the product is now built on one class string — shown here beside one of the five hand-written surfaces it replaced."
      >
        <TheWell />
      </Section>

      <Section
        title="The filter"
        question="It changes what you are looking at. Nothing is submitted and there is no wrong answer, so how much should it look like something you fill in?"
      >
        <div className="flex flex-col gap-6">
          <Variant
            label="Today"
            note="A well, a border and a fill — with a bare select inside it wearing the platform's arrow."
          >
            <FilterToday />
          </Variant>
          <Variant
            label="F1 — the field, properly"
            note="Stop half-dressing it. Cheapest answer; says the wrong thing loudly instead of quietly."
          >
            <FilterAsField />
          </Variant>
          <Variant
            label="F2 — a control, not a container"
            note="No surface at rest. Reads as a sentence above the list; the well appears on hover and focus."
          >
            <FilterAsControl />
          </Variant>
          <Variant
            label="F3 — the segment"
            note="All the options visible at once. Costs width, and stops working past about four options."
          >
            <FilterAsSegments />
          </Variant>
        </div>
      </Section>

      <Section
        title="The choice"
        question="Six of these exist. Three already hide the input and draw a card; three render the platform's dot. Which one is the convention?"
      >
        <div className="grid gap-6 md:grid-cols-2">
          <Variant
            label="Today (three of the six)"
            note="The platform's radio in mint, on a bordered row. The other three already do something else."
          >
            <ChoiceToday />
          </Variant>
          <Variant
            label="C1 — the card"
            note="What the other three already draw, promoted to the convention. Selection is border and tint."
          >
            <ChoiceAsCard />
          </Variant>
          <Variant
            label="C2 — the card with a mark"
            note="C1 plus the one thing the dot was doing: a mark that is there or is not."
          >
            <ChoiceAsMarkedCard />
          </Variant>
          <Variant
            label="C3 — the rail"
            note="No box per option. Quiet enough to sit inside a card, which is where most of these live."
          >
            <ChoiceAsRail />
          </Variant>
        </div>
      </Section>
    </main>
  );
}
