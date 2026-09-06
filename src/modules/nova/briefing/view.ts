import {
  LINK_REMEDY,
  type ProvenanceLinkKind,
  type ProvenanceRemedy,
  type ProvenanceState,
} from "@/modules/provenance/chain";
import {
  FREE_REMEDIES,
  PROVENANCE_LINK_LABELS,
  PROVENANCE_REASONS,
  PROVENANCE_REMEDY_LABELS,
} from "@/modules/provenance/view";

import type { NovaBriefing } from "./briefing";
import { FRESHNESS_LABELS } from "./freshness";

/**
 * The briefing, as a founder reads it.
 *
 * ## Why the sentences are here and not in the panel
 *
 * Because a sentence typed into JSX is a sentence no test sweeps, and these
 * make claims about a customer's own evidence. `briefing-copy.test.ts` reads
 * every string in this file: that none of them names a figure, that none
 * promises an outcome, and that every member of every union is covered. The
 * provenance panel's copy lives under the same rule for the same reason.
 *
 * ## What Nova is allowed to say here
 *
 * She may **report** and she may **advise** — "your audit was last produced
 * about a week ago, and a fresh run would give it something newer to read".
 * She may not **push**: no urgency Vibe has not measured, no consequence
 * nobody observed, no number she invented. Every fact below comes from a
 * decision another module already made, and the one judgment this file adds is
 * the order — repair, then age, then the Move — which is the same order the
 * provenance chain itself argues for.
 *
 * ## And she is honest about herself
 *
 * `BRIEFING_SOURCE_NOTE` is on the panel unconditionally. Nova reads stored
 * documents; she does not watch a product between runs, and a briefing that
 * did not say so would be inviting a founder to read it as live monitoring.
 */

/** The panel's own name, in a founder's words rather than the module's. */
export const BRIEFING_HEADING = "Where you stand";

/**
 * What Nova is, said on every render.
 *
 * Unconditional on purpose. The one sentence a founder needs in order to read
 * everything above it correctly is the sentence about its limits, and a note
 * that only appears when something is wrong teaches the opposite.
 */
export const BRIEFING_SOURCE_NOTE =
  "Nova reads this from what Vibe has stored. She does not watch your product between runs.";

/** How the goal on file is introduced. The label itself is Vibe's own. */
export const BRIEFING_GOAL_PREFIX = "Working toward";

/** Whether anything is waiting, said without restating the card that says it. */
export const BRIEFING_STANDING = {
  clear: "Nothing is waiting on you right now.",
  waiting: "One thing is waiting on you, above.",
} as const;

/**
 * Nova's closing read, in the four shapes it takes.
 *
 * Ordered by what outranks what: something genuinely broken, then something
 * merely old, then the Move the engine ranked, then the honest admission that
 * there is nothing to say. `buildBriefingView` never reorders these — the
 * briefing already decided, and `ageToRaise` is null whenever `firstFix` is
 * set precisely so that this cannot report two problems where there is one.
 */
export type BriefingRead =
  /** Something in the chain is broken, and it is the top of the chain. */
  | {
      kind: "repair";
      subject: ProvenanceLinkKind;
      sentence: string;
      /**
       * Vibe's own account of what is wrong, from the chain's reason table.
       *
       * Nullable because the type is: every non-current link the chain builds
       * carries a reason, and defaulting to one of the five rather than
       * showing none would put a specific, checkable claim on screen that
       * nothing decided.
       */
      because: string | null;
      remedy: ProvenanceRemedy;
      remedyLabel: string;
      free: boolean;
    }
  /** Nothing is wrong; something has been sitting long enough to mention. */
  | {
      kind: "age";
      subject: ProvenanceLinkKind;
      sentence: string;
      advice: string;
      remedy: ProvenanceRemedy;
      remedyLabel: string;
      free: boolean;
    }
  /** The evidence is sound, so the thing to talk about is the work. */
  | { kind: "move"; sentence: string; title: string; whyNow: string }
  /** Sound, and nothing ranked. Saying so is better than finding something. */
  | { kind: "settled"; sentence: string };

export type BriefingRow = {
  kind: ProvenanceLinkKind;
  label: string;
  state: ProvenanceState;
  /** Vibe's sentence for why it is not current. Null when it is. */
  reason: string | null;
  /** The bucket, in words. Null when nothing was ever produced. */
  age: string | null;
  /** For the screen to render a real date from — live, on every draw. */
  producedAt: string | null;
  /** The one row the read is about, so the panel marks exactly one. */
  subject: boolean;
};

export type BriefingView = {
  /** Null when the founder has not said what to call them. */
  founderName: string | null;
  projectName: string;
  /** Vibe's own label for the goal on file. Null when none is. */
  goalLabel: string | null;
  standing: string;
  rows: readonly BriefingRow[];
  read: BriefingRead;
};

export function buildBriefingView(briefing: NovaBriefing): BriefingView {
  const read = readOf(briefing);
  const subject = "subject" in read ? read.subject : null;

  return {
    founderName: briefing.founder.name,
    projectName: briefing.project.name,
    goalLabel: briefing.goal?.label ?? null,
    standing:
      briefing.open.kind === "nothing_to_do" ? BRIEFING_STANDING.clear : BRIEFING_STANDING.waiting,
    rows: briefing.evidence.map((entry) => ({
      kind: entry.kind,
      label: PROVENANCE_LINK_LABELS[entry.kind],
      state: entry.state,
      reason: entry.reason === null ? null : PROVENANCE_REASONS[entry.reason],
      age: entry.freshness === null ? null : FRESHNESS_LABELS[entry.freshness],
      producedAt: entry.producedAt,
      subject: entry.kind === subject,
    })),
    read,
  };
}

function remedyOf(link: ProvenanceLinkKind): {
  remedy: ProvenanceRemedy;
  remedyLabel: string;
  free: boolean;
} {
  const remedy = LINK_REMEDY[link];
  return {
    remedy,
    remedyLabel: PROVENANCE_REMEDY_LABELS[remedy],
    free: FREE_REMEDIES.includes(remedy),
  };
}

function readOf(briefing: NovaBriefing): BriefingRead {
  const fix = briefing.firstFix;
  if (fix !== null) {
    return {
      kind: "repair",
      subject: fix.link,
      /*
       * "Where to start" rather than "everything after it rests on this",
       * which is true of four links and false of the fifth. The chain's own
       * reason sentence carries the why, and it is right for all five.
       */
      sentence: `${PROVENANCE_LINK_LABELS[fix.link]} is where to start.`,
      because: fix.reason === null ? null : PROVENANCE_REASONS[fix.reason],
      ...remedyOf(fix.link),
    };
  }

  const old = briefing.ageToRaise;
  if (old !== null) {
    return {
      kind: "age",
      subject: old.link,
      sentence: `${PROVENANCE_LINK_LABELS[old.link]} was last produced ${FRESHNESS_LABELS[old.freshness]}.`,
      /*
       * Conditional, and deliberately. Nova cannot see whether the product
       * moved — that is what `BRIEFING_SOURCE_NOTE` admits — so the sentence
       * that follows an age has to be an offer rather than an instruction.
       */
      advice:
        "Nothing about it is wrong. If your product has moved since, a fresh run would give Vibe something newer to read.",
      ...remedyOf(old.link),
    };
  }

  const move = briefing.recommendation;
  if (move !== null) {
    return {
      kind: "move",
      sentence: "This is the Move at the top of your list.",
      /* The engine's own words. Nova quotes them; she does not rewrite them. */
      title: move.title,
      whyNow: move.whyNow,
    };
  }

  return {
    kind: "settled",
    sentence: "Everything Vibe reads from is current, and no Move is waiting on your list.",
  };
}
