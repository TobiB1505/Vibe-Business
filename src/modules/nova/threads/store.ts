import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ArtifactKind } from "../artifacts";
import type { NovaActionSubject } from "../feed";
import type { NovaActionId } from "../actions";
import {
  MAX_THREAD_TITLE_CHARS,
  type MessageAuthor,
  type MessageKind,
  type Thread,
  type ThreadMessage,
} from "./schema";

/**
 * Reading and appending to a transcript, and nothing else.
 *
 * ## What this module is forbidden to do
 *
 * Decide anything. [ADR 0109](../../../../docs/decisions/0109-nova-first-application-shell.md)
 * §6: the transcript is memory, the domain is truth. Nothing here reads a
 * message to answer a question about the business, and nothing anywhere else in
 * `src/modules/nova/` imports this file — `transcript-is-not-a-position.test.ts`
 * is the guard, because a ranking that started reading messages would be the
 * "transcript as source of truth" the Nova audit's §M closed.
 *
 * ## Why appending takes a sequence from the database
 *
 * A message's place has to be stable enough to read *"everything after 7"* from
 * a read marker. Two writers computing `max + 1` in application code would both
 * read the same maximum; `(thread_id, sequence)` unique is what turns that into
 * a failed insert rather than two messages at position 8 and a reader that sees
 * one of them. The retry below is bounded and re-reads rather than incrementing
 * blindly — an unbounded loop against a contended thread is a worse failure
 * than a dropped system event.
 */

const THREADS = "nova_threads";
const MESSAGES = "nova_messages";

/** How many times an append will step past a taken sequence before giving up. */
const SEQUENCE_ATTEMPTS = 3;

type ThreadRow = {
  id: string;
  project_id: string;
  title: string;
  status: string;
  created_at: string;
  last_message_at: string | null;
  last_read_sequence: number;
};

type MessageRow = {
  id: string;
  thread_id: string;
  sequence: number;
  author: string;
  kind: string;
  body: string | null;
  action_id: string | null;
  subject_kind: string | null;
  subject_id: string | null;
  artifact_kind: string | null;
  artifact_ref: string | null;
  operation_run_id: string | null;
  outcome: string | null;
  created_at: string;
};

const THREAD_COLUMNS =
  "id, project_id, title, status, created_at, last_message_at, last_read_sequence";
const MESSAGE_COLUMNS =
  "id, thread_id, sequence, author, kind, body, action_id, subject_kind, subject_id," +
  " artifact_kind, artifact_ref, operation_run_id, outcome, created_at";

function toThread(row: ThreadRow): Thread {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    status: row.status === "archived" ? "archived" : "open",
    createdAt: row.created_at,
    /*
     * A thread with no turns yet. Coalesced rather than passed through,
     * because "no messages" is a value the view compares against and an
     * `undefined` reaching it would read as a thread that had one.
     */
    lastMessageAt: row.last_message_at ?? null,
    lastReadSequence: row.last_read_sequence,
  };
}

function toMessage(row: MessageRow): ThreadMessage {
  return {
    id: row.id,
    threadId: row.thread_id,
    sequence: row.sequence,
    author: row.author as MessageAuthor,
    kind: row.kind as MessageKind,
    body: row.body,
    actionId: (row.action_id as NovaActionId | null) ?? null,
    subject: toSubject(row),
    artifact:
      row.artifact_kind === null
        ? null
        : { kind: row.artifact_kind as ArtifactKind, ref: row.artifact_ref ?? "" },
    operationRunId: row.operation_run_id,
    outcome: row.outcome,
    createdAt: row.created_at,
  };
}

/**
 * Two columns back into the union the catalogue already has.
 *
 * Rebuilt rather than stored as JSON, because a JSON subject is a shape nothing
 * enforces — and the CHECK that keeps a subject whole can only see columns.
 */
function toSubject(row: MessageRow): NovaActionSubject | null {
  switch (row.subject_kind) {
    case "prepared_change":
      return { kind: "prepared_change", preparedChangeId: row.subject_id ?? "" };
    case "move":
      return { kind: "move", opportunityId: row.subject_id ?? "" };
    case "founder_input_request":
      return { kind: "founder_input_request", founderInputRequestId: row.subject_id ?? "" };
    case "plan_step":
      return { kind: "plan_step", stepOrder: Number(row.subject_id ?? 0) };
    case "project":
      return { kind: "project" };
    default:
      return null;
  }
}

/**
 * The thread a project's conversation is currently in, created if there is none.
 *
 * One open thread per project until a founder can start a second one (Slice 6's
 * composer, Slice 7's *New chat*). "The most recent open one" rather than a
 * unique index, because the index would have to be dropped the moment a second
 * thread is possible, and a schema that has to change to allow a planned
 * feature is a schema that decided something it was not asked to.
 */
export async function ensureOpenThread(
  supabase: SupabaseClient,
  params: { projectId: string; userId: string; title: string },
): Promise<Thread> {
  const existing = await findOpenThread(supabase, params.projectId);
  if (existing) return existing;

  const { data: created, error: createError } = await supabase
    .from(THREADS)
    .insert({
      project_id: params.projectId,
      user_id: params.userId,
      title: params.title.trim().slice(0, MAX_THREAD_TITLE_CHARS),
      /* The column's default, sent explicitly: a thread is opened, and the
         status is what the read above selects on. */
      status: "open",
    })
    .select(THREAD_COLUMNS)
    .single();

  if (createError) throw createError;
  return toThread(created as ThreadRow);
}

/**
 * The thread a project's conversation is currently in, or none.
 *
 * A read, and only a read. `/threads` calls it to resolve an address, and a
 * version of it that opened a thread would mean looking at a screen wrote a
 * row — which is the same line `ADR 0086` draws around a paid attempt, asked
 * one layer down where the cost is a record rather than money.
 */
export async function findOpenThread(
  supabase: SupabaseClient,
  projectId: string,
): Promise<Thread | null> {
  const { data, error } = await supabase
    .from(THREADS)
    .select(THREAD_COLUMNS)
    .eq("project_id", projectId)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) throw error;

  const row = (data ?? [])[0] as ThreadRow | undefined;
  return row === undefined ? null : toThread(row);
}

export async function getThread(
  supabase: SupabaseClient,
  params: { threadId: string; projectId: string },
): Promise<Thread | null> {
  const { data, error } = await supabase
    .from(THREADS)
    .select(THREAD_COLUMNS)
    .eq("id", params.threadId)
    /*
     * Scoped by project as well as by id, because a service-role client
     * bypasses RLS and rule 53 requires ownership to come from a persisted row
     * rather than from a caller's argument. The project id a caller passes is
     * checked against the row, so a thread from another project answers null.
     */
    .eq("project_id", params.projectId)
    .maybeSingle();

  if (error) throw error;
  return data === null ? null : toThread(data as ThreadRow);
}

/**
 * One thread's turns, oldest first and explicitly bounded.
 *
 * `nova_messages` grows with use, so an unbounded read would return the first
 * thousand and `206 Partial Content` with nothing surfacing the truncation
 * (PERF-018). A conversation is read from its *end*, so the limit takes the
 * newest and the caller gets them back in reading order.
 */
export async function readThreadMessages(
  supabase: SupabaseClient,
  params: { threadId: string; limit: number },
): Promise<ThreadMessage[]> {
  const { data, error } = await supabase
    .from(MESSAGES)
    .select(MESSAGE_COLUMNS)
    .eq("thread_id", params.threadId)
    .order("sequence", { ascending: false })
    .limit(params.limit);

  if (error) throw error;
  return ((data ?? []) as unknown as MessageRow[]).map(toMessage).reverse();
}

/** What an append needs beyond the thread it goes in. */
export type AppendedMessage = {
  author: MessageAuthor;
  kind: MessageKind;
  body?: string | null;
  actionId?: NovaActionId | null;
  subject?: NovaActionSubject | null;
  artifact?: { kind: ArtifactKind; ref?: string | null } | null;
  operationRunId?: string | null;
  outcome?: string | null;
};

/**
 * Append one turn, taking the next free sequence.
 *
 * Returns the stored message, or `null` when the sequence was contended past
 * {@link SEQUENCE_ATTEMPTS}. Null rather than a throw because the one caller
 * today is an operation's terminal transition, and a conversation entry is
 * never worth failing a run that already succeeded over.
 */
export async function appendMessage(
  supabase: SupabaseClient,
  params: { thread: Thread; userId: string; message: AppendedMessage },
): Promise<ThreadMessage | null> {
  for (let attempt = 0; attempt < SEQUENCE_ATTEMPTS; attempt += 1) {
    const next = await nextSequence(supabase, params.thread.id);

    const { data, error } = await supabase
      .from(MESSAGES)
      .insert({
        thread_id: params.thread.id,
        project_id: params.thread.projectId,
        user_id: params.userId,
        sequence: next,
        author: params.message.author,
        kind: params.message.kind,
        body: params.message.body ?? null,
        action_id: params.message.actionId ?? null,
        subject_kind: params.message.subject?.kind ?? null,
        subject_id: subjectId(params.message.subject ?? null),
        artifact_kind: params.message.artifact?.kind ?? null,
        artifact_ref: params.message.artifact?.ref ?? null,
        operation_run_id: params.message.operationRunId ?? null,
        outcome: params.message.outcome ?? null,
      })
      .select(MESSAGE_COLUMNS)
      .single();

    if (error) {
      // 23505 is unique_violation: somebody else took this sequence, so the
      // next attempt re-reads and steps past them. Anything else is a real
      // error and is not a race to retry through — retrying one would insert
      // the same turn again on the attempt that happened to succeed.
      if (error.code === "23505") continue;
      throw error;
    }

    await supabase
      .from(THREADS)
      .update({
        last_message_at: (data as unknown as MessageRow).created_at,
        updated_at: new Date().toISOString(),
      })
      .eq("id", params.thread.id);

    return toMessage(data as unknown as MessageRow);
  }

  return null;
}

function subjectId(subject: NovaActionSubject | null): string | null {
  if (subject === null) return null;
  switch (subject.kind) {
    case "prepared_change":
      return subject.preparedChangeId;
    case "move":
      return subject.opportunityId;
    case "founder_input_request":
      return subject.founderInputRequestId;
    case "plan_step":
      return String(subject.stepOrder);
    case "project":
      return null;
  }
}

async function nextSequence(supabase: SupabaseClient, threadId: string): Promise<number> {
  const { data, error } = await supabase
    .from(MESSAGES)
    .select("sequence")
    .eq("thread_id", threadId)
    .order("sequence", { ascending: false })
    .limit(1);

  if (error) throw error;
  return ((data ?? [])[0]?.sequence ?? 0) + 1;
}

/**
 * How far the founder has read.
 *
 * Never decreases: a marker that went backwards would re-announce turns
 * somebody had already seen, and two tabs settling in the wrong order is
 * exactly how that happens.
 */
export async function markThreadRead(
  supabase: SupabaseClient,
  params: { threadId: string; projectId: string; sequence: number },
): Promise<void> {
  const { error } = await supabase
    .from(THREADS)
    .update({ last_read_sequence: params.sequence })
    .eq("id", params.threadId)
    .eq("project_id", params.projectId)
    .lt("last_read_sequence", params.sequence);

  if (error) throw error;
}
