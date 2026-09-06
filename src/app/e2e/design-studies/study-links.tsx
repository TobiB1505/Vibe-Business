import type { ReactNode } from "react";
import { ArrowRightIcon, DeleteIcon } from "@/components/ui/icons.generated";
import type { Study } from "./studies";

/**
 * The two questions the inline-action work left open.
 *
 * ## Why they are on one page
 *
 * Both are the same shape of mistake waiting to happen: a treatment that was
 * decided for one role being carried to a neighbouring one because it looks
 * similar. The underline decision was about *actions* — eighteen `TextAction`
 * call sites doing five jobs. Neither of the groups below is one of those.
 *
 * ## Question 1 — the links
 *
 * Forty-eight elements write a bare `underline` by hand. Counted by element:
 * thirty-eight `Link`, ten `a`, one `button`. So they are navigation, not
 * actions, and the underline on them is the web's own convention rather than a
 * dated action treatment.
 *
 * Counted again by *context*, which is what actually decides this:
 *
 *   39  standalone   a card header, a row, a page header
 *    9  in prose     "By creating an account you agree to the Terms"
 *
 * That split is the finding. For the nine, the underline is the only signal
 * besides colour that the words are a link, and WCAG 1.4.1 is explicit that
 * colour alone may not carry it inside a block of text. For the thirty-nine,
 * the link is already its own object in its own position, and the line is
 * doing what the study said an underline does everywhere: the least possible
 * work, loudly.
 *
 * So a single answer for all forty-eight is probably wrong, and treatment 4 is
 * the one that says so. Every treatment is therefore drawn twice — standalone
 * and inside a sentence — because a treatment that only works in one of them
 * is not an answer.
 *
 * ## Question 2 — how loud a delete is at rest
 *
 * `InlineAction`'s `danger` tone was built neutral at rest, becoming coral
 * under the pointer, on the argument that destruction should not advertise.
 * Applying it to the three destructive call sites would be a regression, and
 * the reason is the argument this whole exercise rests on: **touch has no
 * hover.** Today `TextAction`'s danger tone is `text-coral` at rest, so
 * "Delete account" is marked as destructive before it is read. Under the tone
 * as built, a phone would never see coral at all — "Delete account" and
 * "Change" would be the same object.
 *
 * Each treatment below therefore carries what a phone sees, because that is
 * the state that decides it.
 */

/* ── Question 1: the links ──────────────────────────────────────────── */

const LINK_BASE = "rounded-sm transition-interactive";

type LinkTreatment = {
  key: string;
  name: string;
  argument: string;
  cost: string;
  /** Standing on its own, in a card header. */
  standalone: ReactNode;
  /** Continuing a sentence, where the accessibility question lives. */
  inProse: ReactNode;
};

function Standalone({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-panel border border-line-2 bg-surface-1 px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="eyebrow text-fg-meta">Business health</p>
        {children}
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-3">
        <span className="text-hero font-semibold text-fg">62</span>
        <span className="text-caption text-fg-prose">Taking shape</span>
      </div>
    </div>
  );
}

function InProse({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-panel border border-line-2 bg-surface-1 px-5 py-4">
      <p className="max-w-[52ch] text-caption text-fg-prose">
        By creating an account you agree to the {children} and confirm you have read how Vibe
        handles your repository.
      </p>
    </div>
  );
}

const LINK_TREATMENTS: readonly LinkTreatment[] = [
  {
    key: "today",
    name: "1 · Wie heute",
    argument:
      "A full-contrast underline at rest, in both places. It is the web's oldest link signal, it needs no colour to work, and it is the only treatment here that is already correct for a screen reader and for somebody who cannot separate the link's colour from the text around it.",
    cost: "On a card header it is the loudest thing in a quiet row — a line under two words beside a number that is the actual content. Thirty-nine of these are that.",
    standalone: (
      <a
        href="#0"
        className={`${LINK_BASE} text-ui text-fg-muted underline underline-offset-4 hover:text-fg-body`}
      >
        See the nine areas
      </a>
    ),
    inProse: (
      <a
        href="#0"
        className={`${LINK_BASE} text-fg-body underline underline-offset-4 hover:text-fg`}
      >
        Terms of Service
      </a>
    ),
  },
  {
    key: "quiet-line",
    name: "2 · Die Linie bleibt, aber leise",
    argument:
      "The underline stays — so nothing depends on colour and nothing is lost for assistive technology — but it takes a faint colour of its own instead of the text's. It becomes structure rather than emphasis, and darkens to the text colour on hover and focus.",
    cost: "A hairline at 16% on a dark ground is close to the threshold where a line stops being seen at all. This is the treatment most likely to be technically present and practically invisible, and it needs measuring rather than judging by eye.",
    standalone: (
      <a
        href="#0"
        className={`${LINK_BASE} text-ui text-fg-muted underline decoration-line-4 underline-offset-4 hover:text-fg-body hover:decoration-current`}
      >
        See the nine areas
      </a>
    ),
    inProse: (
      <a
        href="#0"
        className={`${LINK_BASE} text-fg-body underline decoration-line-4 underline-offset-4 hover:text-fg hover:decoration-current`}
      >
        Terms of Service
      </a>
    ),
  },
  {
    key: "colour",
    name: "3 · Farbe statt Linie",
    argument:
      "No line at rest; the link is brighter than the text around it, and the underline arrives on hover and focus. The quietest option, and the one that reads most like current software.",
    cost: "It fails the nine in prose outright: inside a paragraph this identifies a link by colour alone, which is the thing WCAG 1.4.1 names. It is also the treatment a keyboard user meets last — nothing about it is visible until focus lands.",
    standalone: (
      <a
        href="#0"
        className={`${LINK_BASE} text-ui text-fg-body underline-offset-4 hover:underline focus-visible:underline`}
      >
        See the nine areas
      </a>
    ),
    inProse: (
      <a
        href="#0"
        className={`${LINK_BASE} text-mint underline-offset-4 hover:underline focus-visible:underline`}
      >
        Terms of Service
      </a>
    ),
  },
  {
    key: "split",
    name: "4 · Nach Kontext getrennt",
    argument:
      "Not one answer, because the measurement says there are two groups. A link standing on its own gets the mark that says where it goes and no line — it is already an object in its own position. A link inside a sentence keeps the underline, because there the line is not decoration, it is the thing that says these words are different from the words around them.",
    cost: "Two treatments, and the call site has to pick. It is the same cost the by-role split for actions carries — and the same argument for paying it: the two cases genuinely are different, and one rule for both gets one of them wrong.",
    standalone: (
      <a
        href="#0"
        className={`${LINK_BASE} inline-flex items-center gap-1.5 text-ui text-fg-muted hover:text-fg-body`}
      >
        See the nine areas
        <ArrowRightIcon size={14} />
      </a>
    ),
    inProse: (
      <a
        href="#0"
        className={`${LINK_BASE} text-fg-body underline underline-offset-4 hover:text-fg`}
      >
        Terms of Service
      </a>
    ),
  },
];

/* ── Question 2: how loud a delete is at rest ───────────────────────── */

const PILL =
  "inline-flex min-h-7 items-center gap-1.5 rounded-full px-3 text-ui transition-interactive select-none vibe-control";

type DangerTreatment = {
  key: string;
  name: string;
  argument: string;
  /** What a finger sees, which is the state with no hover in it. */
  onTouch: string;
  control: ReactNode;
};

const DANGER_TREATMENTS: readonly DangerTreatment[] = [
  {
    key: "today",
    name: "1 · Wie heute",
    argument:
      "Coral text with an underline, darkening rather than lightening on hover so a destructive control is never the most inviting thing on the screen. It is the underline treatment the rest of the product is leaving — but it is also the only one of these four that is already correct without a pointer.",
    onTouch: "Coral. The control is marked as destructive before it is read.",
    control: (
      <button
        type="button"
        className="rounded-sm text-coral underline underline-offset-4 transition-interactive hover:text-coral/80"
      >
        Delete account
      </button>
    ),
  },
  {
    key: "as-built",
    name: "2 · Wie gebaut",
    argument:
      "The pill with InlineAction’s danger tone exactly as it stands: neutral at rest, coral once a pointer is on it. Consistent with every other inline control by construction, and it makes destruction quiet.",
    onTouch:
      "Grey. Identical to “Change” and to “2 sources” — a phone never reaches the state that says this one deletes your account.",
    control: (
      <button
        type="button"
        className={`${PILL} bg-surface-3 text-fg-secondary hover:bg-coral-tint-soft hover:text-coral active:bg-coral-tint active:text-coral`}
      >
        <DeleteIcon size={14} />
        Delete account
      </button>
    ),
  },
  {
    key: "coral-text",
    name: "3 · Pille, coraler Text bei Ruhe",
    argument:
      "The container of treatment 2 with the colour of treatment 1: a neutral fill, coral text and mark from the start. The container says pressable, the colour says destructive, and neither waits for a pointer.",
    onTouch: "Coral text on a neutral fill. Distinguishable from every other pill at a glance.",
    control: (
      <button
        type="button"
        className={`${PILL} bg-surface-3 text-coral hover:bg-coral-tint-soft active:bg-coral-tint`}
      >
        <DeleteIcon size={14} />
        Delete account
      </button>
    ),
  },
  {
    key: "coral-fill",
    name: "4 · Pille, coral getönt bei Ruhe",
    argument:
      "The fill is tinted too, so the control carries its warning in shape as well as in colour — the only one of the four that still reads as destructive with the colour removed entirely.",
    onTouch: "A coral-tinted pill. The most legible, and the hardest to press by accident.",
    control: (
      <button
        type="button"
        className={`${PILL} border border-coral-line bg-coral-tint-soft text-coral hover:bg-coral-tint active:bg-coral-tint`}
      >
        <DeleteIcon size={14} />
        Delete account
      </button>
    ),
  },
];

/* ── The page ───────────────────────────────────────────────────────── */

function LinkRow({ treatment }: { treatment: LinkTreatment }) {
  return (
    <section className="flex flex-col gap-5 border-t border-line-2 py-8">
      <div>
        <h3 className="text-title font-semibold text-fg">{treatment.name}</h3>
        <p className="mt-2 max-w-[66ch] text-caption text-fg-prose">{treatment.argument}</p>
        <p className="mt-2 max-w-[66ch] text-caption text-amber">{treatment.cost}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <p className="eyebrow text-fg-meta">Allein · 39 Stellen</p>
          <Standalone>{treatment.standalone}</Standalone>
        </div>
        <div className="flex flex-col gap-2">
          <p className="eyebrow text-fg-meta">Im Satz · 9 Stellen</p>
          <InProse>{treatment.inProse}</InProse>
        </div>
      </div>
    </section>
  );
}

function DangerRow({ treatment }: { treatment: DangerTreatment }) {
  return (
    <section className="flex flex-col gap-5 border-t border-line-2 py-8">
      <div>
        <h3 className="text-title font-semibold text-fg">{treatment.name}</h3>
        <p className="mt-2 max-w-[66ch] text-caption text-fg-prose">{treatment.argument}</p>
        <p className="mt-2 max-w-[66ch] text-caption text-amber">
          Auf dem Telefon: {treatment.onTouch}
        </p>
      </div>
      <div className="rounded-panel border border-line-2 bg-well px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="max-w-[46ch] text-caption text-fg-muted">
            Deletes your account, your projects and everything Vibe learned about them. This cannot
            be undone.
          </span>
          {treatment.control}
        </div>
      </div>
    </section>
  );
}

export function StudyLinks({ study }: { study: Study }) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col px-6 py-12 max-sm:px-4">
      <header className="pb-5">
        <p className="eyebrow text-fg-meta">Was offen blieb</p>
        <h1 className="mt-3 text-headline font-semibold text-fg">
          Die Links, und wie laut ein Löschen ist
        </h1>
        <p className="mt-3 max-w-[66ch] text-lead text-fg-prose">
          Rendered in {study.name}. Two questions the action work left open, and both are the same
          shape: a treatment decided for one role being carried to a neighbouring one because it
          looks similar.
        </p>
      </header>

      <div className="border-t border-line-3 pt-8">
        <p className="eyebrow text-mint">Frage 1 · Die Unterstreichungen der Links</p>
        <h2 className="mt-3 text-title font-semibold text-fg">Achtundvierzig, in zwei Gruppen</h2>
        <p className="mt-3 max-w-[66ch] text-caption text-fg-prose">
          Counted by element: 38 <code className="font-mono text-ui text-fg-secondary">Link</code>,
          10 <code className="font-mono text-ui text-fg-secondary">a</code>, one{" "}
          <code className="font-mono text-ui text-fg-secondary">button</code>. So these are
          navigation, not actions — the underline on them is the web&rsquo;s convention rather than
          a dated action treatment, which is why the TextAction decision does not reach them.
        </p>
        <p className="mt-3 max-w-[66ch] text-caption text-fg-prose">
          Counted by context, which is what decides it: <b className="text-fg">39 stand alone</b> in
          a card header or a row, and <b className="text-fg">9 continue a sentence</b>. For the
          nine, the line is the only signal besides colour, and colour alone is not allowed to carry
          a link inside text. Every treatment below is drawn in both places.
        </p>
      </div>

      {LINK_TREATMENTS.map((treatment) => (
        <LinkRow key={treatment.key} treatment={treatment} />
      ))}

      <div className="mt-12 border-t border-line-3 pt-8">
        <p className="eyebrow text-coral">Frage 2 · Wie laut ein Löschen bei Ruhe ist</p>
        <h2 className="mt-3 text-title font-semibold text-fg">
          Drei Stellen, und ein Argument, das sich umdreht
        </h2>
        <p className="mt-3 max-w-[66ch] text-caption text-fg-prose">
          &ldquo;Delete account&rdquo;, &ldquo;Delete project&rdquo; and &ldquo;Disconnect
          repository&rdquo; were not migrated with the other ten. Today they are{" "}
          <code className="font-mono text-ui text-fg-secondary">text-coral</code> at rest;{" "}
          <code className="font-mono text-ui text-fg-secondary">InlineAction</code>&rsquo;s danger
          tone as built is neutral until hover.
        </p>
        <p className="mt-3 max-w-[66ch] text-caption text-fg-prose">
          &ldquo;Destruction does not advertise&rdquo; was my argument for that, and touch is what
          breaks it: a finger never reaches the hover state, so on a phone the quiet version is not
          quiet, it is <em className="text-fg not-italic">absent</em>. That is the same sentence the
          resting container was built on, pointed the other way.
        </p>
      </div>

      {DANGER_TREATMENTS.map((treatment) => (
        <DangerRow key={treatment.key} treatment={treatment} />
      ))}
    </div>
  );
}
