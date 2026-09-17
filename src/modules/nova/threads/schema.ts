import { ARTIFACT_KINDS, type ArtifactKind } from "../artifacts";
import { NOVA_ACTION_IDS, type NovaActionId } from "../actions";
import type { NovaActionSubject } from "../feed";
import { OPERATION_TYPES, type OperationType } from "../../operations/schema";

/**
 * What a thread is, and what a turn in one may be.
 *
 * ## The transcript is memory; the domain is truth
 *
 * [ADR 0109](../../../../docs/decisions/0109-nova-first-application-shell.md)
 * §6 is the rule this whole directory exists under: **deleting a thread must
 * not change canonical business state**, though it may remove what Nova can
 * infer from earlier dialogue. So nothing here is a position, a balance, a
 * status or a decision — an audit lives in `business_audit_results`, an
 * approval in `change_approvals`, a charge in the ledger, and a message can
 * only ever *point at* one.
 *
 * The Nova audit's §M closed "a transcript as source of truth" and that stays
 * closed. What it did not close is a transcript that **records**, which is what
 * this is.
 *
 * ## Why one table for messages and not five
 *
 * §C.9 of the restructure audit: a `kind` discriminator with per-kind CHECK
 * constraints, the idiom `nova_voice_messages` already uses. A table per
 * message kind is five joins to read one conversation; a JSON blob is a schema
 * nothing enforces. The CHECKs are the schema, and they are asserted against
 * these unions by `schema.test.ts` — a union and a CHECK are the same rule in
 * two places nothing forces to agree.
 */

/** Open, or put away. A thread is never deleted by the product's own hand. */
export const THREAD_STATUSES = ["open", "archived"] as const;
export type ThreadStatus = (typeof THREAD_STATUSES)[number];

/**
 * Who a message is from.
 *
 * `system` is Vibe itself, and it is not Nova: a run finishing is a fact the
 * product observed, not a sentence she chose to say. Keeping the two apart is
 * what lets a surface render one in her register and the other in the quiet
 * one, and what stops a future reader taking an event for something she wrote.
 */
export const MESSAGE_AUTHORS = ["founder", "nova", "system"] as const;
export type MessageAuthor = (typeof MESSAGE_AUTHORS)[number];

/**
 * What a turn can be.
 *
 * `confirmation` is deliberately absent. Whether a proposal needs one is
 * `NOVA_ACTION_META.requiresConfirmation`, and what happened to it is the
 * `action_result` — a kind for the dialog would be a third place the same fact
 * lives, and the one most likely to disagree with the catalogue.
 */
export const MESSAGE_KINDS = [
  /** Words. The founder's, or Nova's. */
  "text",
  /** A catalogue action Nova is offering. Never itself an action. */
  "action_proposal",
  /** What happened when the founder pressed one. Observed, never predicted. */
  "action_result",
  /** The thing under discussion, by reference. */
  "artifact",
  /** A run reached a terminal state. The only kind Vibe writes on its own. */
  "event",
] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

/** The subject kinds an action message may name — `NovaActionSubject`'s tags. */
export const MESSAGE_SUBJECT_KINDS = [
  "prepared_change",
  "move",
  "founder_input_request",
  "plan_step",
  "project",
] as const;
export type MessageSubjectKind = (typeof MESSAGE_SUBJECT_KINDS)[number];

/**
 * The longest a stored message may be.
 *
 * 1200 is `project_founder_resolutions.resolved_statement`'s ceiling and the
 * same number for the same reason: it is long enough for a founder to make a
 * real point and short enough that nobody pastes a document into it. The
 * database enforces it; this constant is what the composer will refuse against
 * so a founder learns before they press rather than after.
 */
export const MAX_MESSAGE_CHARS = 1200;

/** The longest a thread title may be. Vibe composes it, or it is a first line. */
export const MAX_THREAD_TITLE_CHARS = 120;

/**
 * What a founder reads when a run ends, and which runs they read about at all.
 *
 * ## Why the words are here and not composed at the surface
 *
 * Because an `event` message stores no text — the migration's CHECK refuses it,
 * on `nova_voice_messages`' argument that a stored sentence freezes today's
 * wording into a row that outlives it. So the sentence has to be composed on
 * every read, and it has to be composed from **one** table, or a thread and the
 * "Earlier" list start describing the same run in two different ways.
 *
 * ## Why this is also the decision about *which* runs
 *
 * `null` is not-remembered, and it is a decision rather than a gap. Two tables —
 * one saying whether, one saying what — would be two places to add a row and one
 * place to forget. Total over `OperationType`, so a sixteenth operation type
 * fails the build until somebody decides whether a founder should be able to
 * scroll back and find it.
 *
 * ## Why it is not `BLOCK_FOR_OPERATION` filtered
 *
 * They answer different questions. `BLOCK_FOR_OPERATION` decides what is drawn
 * *while a run is in flight*; this decides what is worth remembering
 * afterwards. A change's six lifecycle operations all draw the same review
 * block — correctly, because a founder watching wants the gate — and all six
 * leaving an event in the transcript would bury the one that mattered.
 */
export type ThreadEventWords = {
  /** The run finished and produced what it was for. */
  done: string;
  /** It did not. Never a reason — the operation's own failure copy owns that. */
  failed: string;
};

export const THREAD_EVENT_WORDS: Record<OperationType, ThreadEventWords | null> = {
  /* The four a founder came back to find out about. */
  business_audit: {
    done: "I finished reading your business.",
    failed: "I could not finish reading your business.",
  },
  product_scan: {
    done: "I finished looking at your product.",
    failed: "I could not finish looking at your product.",
  },
  agent_execution: {
    done: "I finished building, and there is a change to look at.",
    failed: "The build did not finish.",
  },
  action_planning: {
    done: "Your plan is ready.",
    failed: "I could not finish your plan.",
  },

  /* The two that produce something to read. */
  product_understanding: {
    done: "I updated what I understand your product to be.",
    failed: "I could not update what I understand your product to be.",
  },
  opportunity_generation: {
    done: "There are new moves to read.",
    failed: "I could not work out what to move on next.",
  },

  /*
   * One change, one memory. The merge is the step that changes what a founder's
   * repository contains, and it is the one they will look for in three weeks —
   * the five steps around it are the gate, and a gate is a screen rather than a
   * memory.
   */
  change_merge: {
    done: "The change is on your default branch.",
    failed: "The change did not reach your default branch.",
  },
  change_preparation: null,
  change_validation: null,
  change_preview: null,
  change_review: null,
  change_outcome_verification: null,

  /* Machinery, as `BLOCK_FOR_OPERATION` says of the same three. */
  preview_teardown: null,
  business_measurement: null,
  /*
   * And an erasure, which is emphatically not a conversation: the account is
   * going away, and a message in a record about to be deleted with it would be
   * a record of nothing.
   */
  account_erasure: null,
};

/** Whether a run of this type leaves anything behind in a thread. */
export function leavesThreadEvent(type: OperationType): boolean {
  return THREAD_EVENT_WORDS[type] !== null;
}

/** Every operation type that leaves a message, for a caller that needs the set. */
export function operationsWithThreadEvents(): OperationType[] {
  return OPERATION_TYPES.filter(leavesThreadEvent);
}

/** One message, as the store hands it to a view builder. */
export type ThreadMessage = {
  id: string;
  threadId: string;
  /** Monotonic within one thread. The order a founder read them in. */
  sequence: number;
  author: MessageAuthor;
  kind: MessageKind;
  /** Words, and only for `text`. */
  body: string | null;
  /** The catalogue action, for a proposal or its result. */
  actionId: NovaActionId | null;
  /** What that action is about. Rebuilt from two columns, never stored as JSON. */
  subject: NovaActionSubject | null;
  /** The thing under discussion, for an `artifact` message. */
  artifact: { kind: ArtifactKind; ref: string } | null;
  /** The run this message is about, for `event` and `action_result`. */
  operationRunId: string | null;
  /** The observed outcome of a pressed proposal. Never the model's account. */
  outcome: string | null;
  createdAt: string;
};

/** One thread, as the store hands it over. */
export type Thread = {
  id: string;
  projectId: string;
  title: string;
  status: ThreadStatus;
  createdAt: string;
  lastMessageAt: string | null;
  /** The highest sequence the founder has seen. Zero means nothing yet. */
  lastReadSequence: number;
};

/** Re-exported so a caller checking a stored id has one place to ask. */
export function isNovaActionId(value: string): value is NovaActionId {
  return (NOVA_ACTION_IDS as readonly string[]).includes(value);
}

/** The same, for an artifact kind read back out of a row. */
export function isArtifactKind(value: string): value is ArtifactKind {
  return (ARTIFACT_KINDS as readonly string[]).includes(value);
}
