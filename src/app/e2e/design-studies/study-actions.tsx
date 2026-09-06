import type { ReactNode } from "react";
import { ArrowRightIcon, ChevronDownIcon, CloseIcon } from "@/components/ui/dashboard-icons";
import type { Study } from "./studies";

/**
 * Four treatments for the inline action, across the five jobs it actually does.
 *
 * ## The finding this exists to settle
 *
 * `TextAction` is one visual treatment — a word with an underline — used 18
 * times, beside 47 more places that write the same underline by hand. Reading
 * the labels, it is not one control. It is five:
 *
 *   dismiss      Close · Cancel
 *   destructive  Delete account · Delete project · Disconnect repository
 *   inline edit  Change · Edit what you're working toward
 *   disclosure   2 sources · More context / Show less · Preview the diff here
 *   navigation   Next · Previous · Sign out
 *
 * An underline is the lowest-information signal available, and it is applied
 * uniformly to all five. That is why it reads as dated rather than as quiet: a
 * reader has to get to the word before anything tells them what the control
 * will do.
 *
 * ## The constraint that rules out the obvious answer
 *
 * These are everywhere, so they cannot become contained buttons. A drawer
 * header with a filled Close, a settings row with a filled Change, and a
 * paragraph with a filled More context is three pieces of furniture where the
 * product wanted three affordances. Every treatment below stays inline and
 * stays small; what changes is how much each one says before it is read.
 *
 * ## Nothing here changes a component
 *
 * These are rendered treatments. Whichever wins becomes `TextAction`'s own
 * variants, which is one file and no call-site churn for the 18 — the 47
 * hand-written underlines are a separate conversion, and worth doing precisely
 * because they exist.
 */

type Treatment = {
  key: string;
  name: string;
  argument: string;
  cost: string;
  /** Rendered per role, so the trade-off is visible rather than described. */
  dismiss: ReactNode;
  destructive: ReactNode;
  edit: ReactNode;
  disclosure: ReactNode;
  navigation: ReactNode;
};

/* ── Shared shapes ─────────────────────────────────────────────────── */

const TAP = "inline-flex items-center gap-1.5 rounded-nav";
/** Never smaller than this: an inline control is still a target. */
const TAP_AREA = "min-h-8 px-2 -mx-2";

function Chip({
  children,
  tone = "muted",
  className,
}: {
  children: ReactNode;
  tone?: "muted" | "danger";
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`${TAP} ${TAP_AREA} text-ui transition-interactive ${
        tone === "danger"
          ? "text-coral hover:bg-coral-tint-soft"
          : "text-fg-muted hover:bg-surface-hover hover:text-fg-body"
      } ${className ?? ""}`}
    >
      {children}
    </button>
  );
}

const TREATMENTS: readonly Treatment[] = [
  {
    key: "today",
    name: "1 · Unterstrichen, wie heute",
    argument:
      "The reference. One signal, five jobs. It is legible and it is honest about being a control — and it is the same word-with-a-line the web used before hover states were reliable.",
    cost: "Every role looks identical until it is read.",
    dismiss: <UnderlineAction>Close</UnderlineAction>,
    destructive: <UnderlineAction tone="danger">Delete project</UnderlineAction>,
    edit: <UnderlineAction>Change</UnderlineAction>,
    disclosure: <UnderlineAction>2 sources</UnderlineAction>,
    navigation: <UnderlineAction>Next</UnderlineAction>,
  },
  {
    key: "quiet",
    name: "2 · Ruhig, Unterstrich erst bei Interaktion",
    argument:
      "The same words with the line held back until hover or focus. The quietest option, and the smallest change — the underline still exists, it just stops shouting on a screen with eleven of them.",
    cost: "An affordance nobody can see is not an affordance. This is the treatment most likely to lose a control on a page a founder is scanning.",
    dismiss: <QuietAction>Close</QuietAction>,
    destructive: <QuietAction tone="danger">Delete project</QuietAction>,
    edit: <QuietAction>Change</QuietAction>,
    disclosure: <QuietAction>2 sources</QuietAction>,
    navigation: <QuietAction>Next</QuietAction>,
  },
  {
    key: "chip",
    name: "3 · Ghost-Chip",
    argument:
      "No line at rest; a soft fill arrives under the pointer. Reads as a control without becoming one — the fill is the affordance, and it costs no ink until it is wanted. Dismissal drops the word entirely.",
    cost: "Uniform again: a chip says 'pressable', not what pressing does. And a fill on hover is invisible to a keyboard user until focus lands.",
    dismiss: (
      <Chip className="px-2" aria-label="Close">
        <CloseIcon size={16} />
      </Chip>
    ),
    destructive: <Chip tone="danger">Delete project</Chip>,
    edit: <Chip>Change</Chip>,
    disclosure: <Chip>2 sources</Chip>,
    navigation: <Chip>Next</Chip>,
  },
  {
    key: "role",
    name: "4 · Nach Rolle getrennt",
    argument:
      "Not a style — an argument. The underline is replaced by meaning: dismissal is a mark, disclosure carries the chevron that says it opens, navigation carries the arrow that says it leaves, destruction stays a word in coral, and only inline edit keeps a line.",
    cost: "Five treatments to maintain instead of one, and the variant has to be chosen correctly at every call site. It is the most work and the most information.",
    dismiss: (
      <Chip className="px-2" aria-label="Close">
        <CloseIcon size={16} />
      </Chip>
    ),
    destructive: (
      <Chip tone="danger" className="font-medium">
        Delete project
      </Chip>
    ),
    edit: <UnderlineAction>Change</UnderlineAction>,
    disclosure: (
      <Chip>
        2 sources
        <ChevronDownIcon size={14} />
      </Chip>
    ),
    navigation: (
      <Chip>
        Next
        <ArrowRightIcon size={14} />
      </Chip>
    ),
  },
];

function UnderlineAction({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "danger";
}) {
  return (
    <button
      type="button"
      className={`rounded-sm text-ui underline underline-offset-4 transition-interactive ${
        tone === "danger" ? "text-coral hover:text-coral/80" : "text-fg-muted hover:text-fg-body"
      }`}
    >
      {children}
    </button>
  );
}

function QuietAction({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "danger";
}) {
  return (
    <button
      type="button"
      className={`rounded-sm text-ui underline-offset-4 transition-interactive hover:underline focus-visible:underline ${
        tone === "danger" ? "text-coral hover:text-coral/80" : "text-fg-muted hover:text-fg-body"
      }`}
    >
      {children}
    </button>
  );
}

const ROLES = [
  ["Verwerfen", "dismiss", "Close · Cancel"],
  ["Destruktiv", "destructive", "Delete project · Disconnect repository"],
  ["Inline-Bearbeitung", "edit", "Change · Edit what you're working toward"],
  ["Aufklappen", "disclosure", "2 sources · More context"],
  ["Navigation", "navigation", "Next · Sign out"],
] as const;

function Row({ treatment }: { treatment: Treatment }) {
  return (
    <section className="flex flex-col gap-4 border-t border-line-2 py-8">
      <div>
        <h2 className="text-title font-semibold text-fg">{treatment.name}</h2>
        <p className="mt-2 max-w-[66ch] text-caption text-fg-prose">{treatment.argument}</p>
        <p className="mt-2 max-w-[66ch] text-caption text-amber">{treatment.cost}</p>
      </div>

      <dl className="grid gap-x-8 gap-y-1 sm:grid-cols-[11rem_9rem_minmax(0,1fr)] sm:items-center">
        {ROLES.map(([label, key, examples]) => (
          <div key={key} className="contents">
            <dt className="eyebrow text-fg-meta">{label}</dt>
            <dd className="py-1.5">{treatment[key]}</dd>
            <dd className="pb-2 text-caption text-fg-disabled sm:pb-0">{examples}</dd>
          </div>
        ))}
      </dl>

      {/* In place: a drawer header, where the objection was raised. */}
      <div className="mt-2 rounded-card border border-line-3 bg-surface-2 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow text-fg-meta">Evidence</p>
            <p className="mt-2 text-card-title font-semibold text-fg">
              Your code takes payments and your site offers no way to pay
            </p>
          </div>
          {treatment.dismiss}
        </div>
      </div>
    </section>
  );
}

export function StudyActions({ study }: { study: Study }) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col px-6 py-12 max-sm:px-4">
      <header className="pb-5">
        <p className="eyebrow text-fg-meta">Inline actions</p>
        <h1 className="mt-3 text-headline font-semibold text-fg">One underline, five jobs</h1>
        <p className="mt-3 max-w-[66ch] text-lead text-fg-prose">
          Rendered in {study.name}. `TextAction` is used 18 times and the same underline is
          hand-written in 47 more places — so this is a group, and it changes in one file. None of
          these becomes a contained button: they are everywhere, and eleven filled controls on a
          screen is furniture rather than affordance.
        </p>
      </header>

      {TREATMENTS.map((treatment) => (
        <Row key={treatment.key} treatment={treatment} />
      ))}
    </div>
  );
}
