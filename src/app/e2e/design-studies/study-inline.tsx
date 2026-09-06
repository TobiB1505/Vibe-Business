import type { ReactNode } from "react";
import {
  ArrowRightIcon,
  ChevronDownIcon,
  DeleteIcon,
  EditIcon,
} from "@/components/ui/icons.generated";
import type { Study } from "./studies";

/**
 * The same principles, for the controls that live inside text.
 *
 * ## What carries over, and what cannot
 *
 * The dismissal settled three things, and two of them are universal:
 *
 *   1. **A container exists at rest.** Touch has no hover, so a control with
 *      no resting container is not a control on a phone. This holds here.
 *   2. **Press is a visible step past hover.** A pointer gets three states, a
 *      finger gets two, and the last one is the only feedback it receives.
 *      This holds here.
 *   3. **The container is a 32px circle.** This does *not* carry over. There is
 *      one dismissal per overlay; there are sixty-five of these, and they sit
 *      in the middle of sentences and table rows. Sixty-five filled circles is
 *      the "furniture rather than affordance" the whole exercise is avoiding.
 *
 * So the question is narrower than the last one: **what is the lightest
 * container that still exists at rest, at text scale?**
 *
 * ## Why the label is part of the question
 *
 * A dismissal needs no word — every reader knows what a cross in a corner
 * does. "Change", "2 sources" and "Delete project" are not conventions, so a
 * bare mark would be a guess. Treatment 1 answers that by letting the
 * surrounding text carry the meaning; the other three put the word inside the
 * control. That is a real fork, not a styling difference.
 */

/* ── The four containers ───────────────────────────────────────────── */

const BASE = "vibe-control inline-flex items-center gap-1.5 transition-interactive select-none";
/** 28px, not 32: at text scale the row's line box is the constraint. */
const HEIGHT = "min-h-7";

const FILL =
  "bg-surface-3 text-fg-secondary hover:bg-surface-hover hover:text-fg " +
  "active:bg-surface-pressed active:text-fg";
const FILL_DANGER =
  "bg-surface-3 text-fg-secondary hover:bg-coral-tint-soft hover:text-coral " +
  "active:bg-coral-tint active:text-coral";
const EDGE =
  "border border-line-4 text-fg-muted hover:border-line-strong hover:bg-surface-hover " +
  "hover:text-fg active:bg-surface-pressed active:text-fg";
const EDGE_DANGER =
  "border border-line-4 text-fg-muted hover:border-coral-line hover:bg-coral-tint-soft " +
  "hover:text-coral active:bg-coral-tint active:text-coral";

type Role = "edit" | "delete" | "disclosure" | "navigation";

const MARK: Record<Role, ReactNode> = {
  edit: <EditIcon size={14} />,
  delete: <DeleteIcon size={14} />,
  disclosure: <ChevronDownIcon size={14} />,
  navigation: <ArrowRightIcon size={14} />,
};

const WORD: Record<Role, string> = {
  edit: "Change",
  delete: "Delete project",
  disclosure: "2 sources",
  navigation: "Next",
};

type Treatment = {
  key: string;
  name: string;
  argument: string;
  cost: string;
  render: (role: Role) => ReactNode;
};

const TREATMENTS: readonly Treatment[] = [
  {
    key: "mark",
    name: "1 · Nur Zeichen, runder Behälter",
    argument:
      "The dismissal's language at text scale — a 28px circle holding the mark alone. The lightest of the four, and the only one whose width does not depend on how long the label is, so a table column stays a column.",
    cost: "It only works where the text beside it already says what the control does. “Change” next to a URL is obvious; a chevron alone under a paragraph is a guess, and “Delete project” loses the word that makes it a warning.",
    render: (role) => (
      <button
        type="button"
        aria-label={WORD[role]}
        className={`${BASE} ${HEIGHT} size-7 justify-center rounded-full ${
          role === "delete" ? FILL_DANGER : FILL
        }`}
      >
        {MARK[role]}
      </button>
    ),
  },
  {
    key: "pill",
    name: "2 · Pille, Zeichen und Wort, gefüllt",
    argument:
      "The control names itself. Same fill and same three states as the dismissal, shaped to the text rather than to a corner — and the word means it works on a phone, under a screen reader, and for somebody who has never seen a pencil mean edit.",
    cost: "A pill is round, and this direction runs 8px corners. On the dismissal that borrowing was worth it because a cross in a corner is a convention; a labelled inline control has no such excuse.",
    render: (role) => (
      <button
        type="button"
        className={`${BASE} ${HEIGHT} rounded-full px-3 text-ui ${
          role === "delete" ? FILL_DANGER : FILL
        }`}
      >
        {MARK[role]}
        {WORD[role]}
      </button>
    ),
  },
  {
    key: "corner",
    name: "3 · Wie 2, in Vibes eigener Ecke",
    argument:
      "Identical to 2 except for the radius. Everything the container does, with none of the vocabulary borrowed — and beside a card that already runs an 8px corner, it reads as part of the same system rather than as something dropped in.",
    cost: "Slightly more button-like. At this size the difference between an 8px corner and a pill is small, which is either the point or an argument that the choice does not matter.",
    render: (role) => (
      <button
        type="button"
        className={`${BASE} ${HEIGHT} rounded-nav px-3 text-ui ${
          role === "delete" ? FILL_DANGER : FILL
        }`}
      >
        {MARK[role]}
        {WORD[role]}
      </button>
    ),
  },
  {
    key: "edge",
    name: "4 · Behälter als Hairline",
    argument:
      "The container is an edge rather than a fill, which is the material this direction already spends its contrast on. The lightest option that still has a resting container, and the one that stays quietest when a screen has six of them.",
    cost: "A hairline inside a panel that already has a border competes with it, and on the dark well below it nearly disappears. This is the treatment that fails on exactly the surfaces where the fill treatments do not.",
    render: (role) => (
      <button
        type="button"
        className={`${BASE} ${HEIGHT} rounded-nav px-3 text-ui ${
          role === "delete" ? EDGE_DANGER : EDGE
        }`}
      >
        {MARK[role]}
        {WORD[role]}
      </button>
    ),
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

      {/* Inline edit: the value beside it already names the thing. */}
      <div className="rounded-panel border border-line-2 bg-surface-1 px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="eyebrow text-fg-meta">Production URL</span>
          <span className="font-mono text-ui text-fg-body">payflow.dev</span>
          {treatment.render("edit")}
        </div>
      </div>

      {/* Disclosure: under a paragraph, where nothing else says what it opens. */}
      <div className="rounded-panel border border-line-2 bg-surface-1 px-5 py-4">
        <p className="max-w-[58ch] text-caption text-fg-prose">
          Vibe found a payments integration in the repository and no pricing or checkout page on the
          live site.
        </p>
        <div className="mt-3">{treatment.render("disclosure")}</div>
      </div>

      {/* Destructive, in a settings row — and on a dark well, which is where a
          hairline container has to survive or admit it cannot. */}
      <div className="rounded-panel border border-line-2 bg-well px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-caption text-fg-muted">
            Removes the project and everything Vibe learned about it.
          </span>
          {treatment.render("delete")}
        </div>
      </div>

      {/* Navigation, at the end of a row. */}
      <div className="flex justify-end">{treatment.render("navigation")}</div>
    </section>
  );
}

export function StudyInline({ study }: { study: Study }) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col px-6 py-12 max-sm:px-4">
      <header className="pb-5">
        <p className="eyebrow text-fg-meta">Inline controls</p>
        <h1 className="mt-3 text-headline font-semibold text-fg">
          The same principles, at text scale
        </h1>
        <p className="mt-3 max-w-[66ch] text-lead text-fg-prose">
          Rendered in {study.name}. Two things carry over from the dismissal — a container at rest,
          and a press that is a visible step past hover. The 32px circle does not: there is one
          dismissal per overlay and sixty-five of these, in the middle of sentences.
        </p>
        <p className="mt-3 max-w-[66ch] text-caption text-fg-muted">
          Every mark here is Lucide through Vibe&rsquo;s frame at 1.5px. The chevron and the arrow
          were hand-drawn until this change and disagreed with the rest of the set — Vibe&rsquo;s
          chevron spanned ten grid units against Lucide&rsquo;s twelve.
        </p>
      </header>

      {TREATMENTS.map((treatment) => (
        <Row key={treatment.key} treatment={treatment} />
      ))}
    </div>
  );
}
