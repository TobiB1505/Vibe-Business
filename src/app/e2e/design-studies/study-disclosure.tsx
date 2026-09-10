import type { ReactNode } from "react";
import { ChevronDownIcon } from "@/components/ui/icons.generated";
import { buttonClasses } from "@/components/ui/button";
import type { Study } from "./studies";

/**
 * Four treatments for the block that opens.
 *
 * ## What is wrong with the one that ships
 *
 * Three things, and only the third is a matter of taste.
 *
 * 1. **The caret is a text character.** `Disclosure` renders `▸` — a literal
 *    glyph, not a mark from the icon set. It takes the font's weight rather
 *    than the frame's 1.5px, it sits on the text baseline rather than on the
 *    optical centre, and it rotates 90° on open, which is the one thing a
 *    triangle pointing right can do and a chevron does better.
 * 2. **The trigger has no container at rest**, which is the same objection
 *    already settled twice: on a phone there is no hover, so the only state a
 *    finger sees is the one with nothing in it.
 * 3. **How much of it is the control.** A word, a row, or the paragraph
 *    itself — that is the actual design question, and the three answers read
 *    very differently at the bottom of a card.
 *
 * ## Why both states are drawn
 *
 * A disclosure is the one control whose closed state and open state are
 * different components to a reader. Comparing only the closed one compares the
 * half that matters least: the open state is where the content lands, and
 * where a treatment either keeps the block legible or turns it into a wall.
 */

const BODY =
  "Vibe found a payments integration in the repository and no pricing or checkout page on the live site. Someone who wants to buy has nowhere to do it, so the integration earns nothing.";

/* ── The four triggers ─────────────────────────────────────────────── */

/** What ships: a text triangle and a bare summary. */
function Today({ open }: { open: boolean }) {
  return (
    <details open={open} className="group">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-sm text-xs text-fg-muted transition-interactive hover:text-fg-body [&::-webkit-details-marker]:hidden">
        <span
          aria-hidden
          className="inline-block text-fg-meta transition-transform duration-150 group-open:rotate-90"
        >
          ▸
        </span>
        More context
      </summary>
      <div className="pt-3 text-caption text-fg-prose">{BODY}</div>
    </details>
  );
}

/** The decided inline control, with the chevron turning on open. */
function AsControl({ open }: { open: boolean }) {
  return (
    <details open={open} className="group">
      <summary className="list-none [&::-webkit-details-marker]:hidden">
        {/*
          The treatment on a span, not a nested button: a `<summary>` is
          already the control the browser hands to the keyboard and to a
          screen reader, and a button inside one is two controls sharing a
          hit area.
        */}
        <span className={buttonClasses({ variant: "ghost" })}>
          <ChevronDownIcon
            size={14}
            className="transition-transform duration-150 group-open:rotate-180"
          />
          More context
        </span>
      </summary>
      <div className="pt-3 text-caption text-fg-prose">{BODY}</div>
    </details>
  );
}

/** The whole row is the control, and the block reads as a section. */
function AsRow({ open }: { open: boolean }) {
  return (
    <details open={open} className="group -mx-2">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-nav px-2 py-2 text-ui text-fg-muted transition-interactive hover:bg-surface-hover hover:text-fg-body [&::-webkit-details-marker]:hidden">
        More context
        <ChevronDownIcon
          size={15}
          className="text-fg-meta transition-transform duration-150 group-open:rotate-180"
        />
      </summary>
      <div className="px-2 pt-3 text-caption text-fg-prose">{BODY}</div>
    </details>
  );
}

/**
 * The paragraph itself continues.
 *
 * Closed shows the first line under a fade; open shows the whole thing. The
 * control is the sentence rather than a label above it, which is what "see
 * more" means everywhere else on the web.
 *
 * ## Why this one is not a `<details>`
 *
 * A first draft made it one and rendered nothing at all when closed: `details`
 * hides everything that is not the `summary`, so the line meant to be visible
 * under the fade was the line the element was hiding. Putting the paragraph
 * inside the `summary` fixes the picture and duplicates the text for a screen
 * reader, which is worse.
 *
 * So this treatment needs client state and a `line-clamp` toggle — the only
 * one of the four that cannot use the platform's own disclosure. That is a
 * real cost and it is in its cost line rather than discovered later. Here the
 * two states are rendered directly, because a study compares pictures.
 */
function AsContinuation({ open }: { open: boolean }) {
  return (
    <div>
      <div className="relative">
        <p
          className={
            open ? "text-caption text-fg-prose" : "line-clamp-1 text-caption text-fg-prose"
          }
        >
          {BODY}
        </p>
        {!open && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-gradient-to-r from-transparent to-surface-1"
          />
        )}
      </div>
      <button
        type="button"
        className="mt-1 inline-flex items-center gap-1 rounded-sm text-caption text-fg-muted transition-interactive hover:text-fg-body"
      >
        {open ? "Show less" : "See more"}
        <ChevronDownIcon size={13} className={open ? "rotate-180" : undefined} />
      </button>
    </div>
  );
}

type Treatment = {
  key: string;
  name: string;
  argument: string;
  cost: string;
  render: (open: boolean) => ReactNode;
};

const TREATMENTS: readonly Treatment[] = [
  {
    key: "today",
    name: "1 · Wie heute",
    argument:
      "A text triangle and a bare summary. Kept as the reference, and as the only one of the four whose caret is a character rather than a mark from the set.",
    cost: "The glyph takes the font's weight instead of the frame's 1.5px, and a triangle rotating 90° is the least a caret can say. No container at rest, so on a phone it is a small grey word.",
    render: (open) => <Today open={open} />,
  },
  {
    key: "control",
    name: "2 · Der entschiedene Inline-Behälter",
    argument:
      "The pill chosen for inline actions, with the chevron turning through 180° on open. Consistent with every other inline control by construction rather than by resemblance — it is the same component.",
    cost: "A pill at the bottom of a card is a visible object, and a card with two disclosures now has two of them. This is the treatment that costs the most ink on a dense screen.",
    render: (open) => <AsControl open={open} />,
  },
  {
    key: "row",
    name: "3 · Die ganze Zeile ist der Auslöser",
    argument:
      "Label left, chevron right, the whole row highlights. The block reads as a section that opens rather than as a link that does something, which is what most of these twenty-two actually are.",
    cost: "It needs the full width, so it cannot sit inline beside anything, and a row inside a card with its own padding has to reach past it to look deliberate.",
    render: (open) => <AsRow open={open} />,
  },
  {
    key: "continuation",
    name: "4 · Der Absatz läuft weiter",
    argument:
      "Closed shows the first line under a fade; open shows the rest. The control continues the sentence rather than labelling it, which is what “see more” means everywhere else on the web — and the reader sees the beginning of the answer before deciding.",
    cost: "Two costs. It only works where the hidden thing is prose — “Technical details” and a list of SHAs are not a sentence, and a fade over them promises a continuation that is not there. And it is the one treatment that cannot be a native `<details>`: the line under the fade is exactly what that element hides when closed, so this needs client state and a line-clamp toggle.",
    render: (open) => <AsContinuation open={open} />,
  },
];

function Row({ treatment }: { treatment: Treatment }) {
  return (
    <section className="flex flex-col gap-5 border-t border-line-2 py-8">
      <div>
        <h2 className="text-title font-semibold text-fg">{treatment.name}</h2>
        <p className="mt-2 max-w-[66ch] text-caption text-fg-prose">{treatment.argument}</p>
        <p className="mt-2 max-w-[66ch] text-caption text-amber">{treatment.cost}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {[false, true].map((open) => (
          <div key={String(open)} className="flex flex-col gap-2">
            <p className="eyebrow text-fg-meta">{open ? "Offen" : "Geschlossen"}</p>
            <div className="rounded-panel border border-line-2 bg-surface-1 p-5">
              <p className="mb-3 text-card-title font-semibold text-fg">
                Your code takes payments and your site offers no way to pay
              </p>
              {treatment.render(open)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function StudyDisclosure({ study }: { study: Study }) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col px-6 py-12 max-sm:px-4">
      <header className="pb-5">
        <p className="eyebrow text-fg-meta">Disclosure</p>
        <h1 className="mt-3 text-headline font-semibold text-fg">The block that opens</h1>
        <p className="mt-3 max-w-[66ch] text-lead text-fg-prose">
          Rendered in {study.name}. Twenty-two uses of the component plus eleven raw
          <code className="mx-1 font-mono text-ui text-fg-secondary">&lt;details&gt;</code>
          elements, all of them opening on a caret that is a text character rather than a mark from
          the icon set.
        </p>
        <p className="mt-3 max-w-[66ch] text-caption text-fg-muted">
          Both states are drawn for each treatment. A disclosure is the one control whose closed and
          open states are different components to a reader, and the open one is where the content
          either stays legible or becomes a wall.
        </p>
      </header>

      {TREATMENTS.map((treatment) => (
        <Row key={treatment.key} treatment={treatment} />
      ))}
    </div>
  );
}
