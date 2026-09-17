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
 * ## Why this is one database call and not a read then an insert
 *
 * Because it used to be two, and the window between them is a split
 * conversation. Two tabs asking a first question at once — or a run finishing
 * while a founder asks — both read *no open thread* and both insert, and the
 * turns then land in two different threads, each looking complete.
 *
 * No client-side fix reaches it: PostgREST runs each request in its own
 * transaction, so nothing here can be held across the read and the write.
 * `open_nova_thread` makes the decision under a per-project advisory lock, and
 * is `security invoker`, so this call has exactly the reach the caller already
 * had — RLS for a founder, no RLS for the service role.
 *
 * "The most recent open one" rather than a unique index, still: the index would
 * have to be dropped for *New chat*, and a schema that has to change to allow a
 * planned feature is a schema that decided something it was not asked to.
 */
export async function ensureOpenThread(
  supabase: SupabaseClient,
  params: { projectId: string; userId: string; title: string },
): Promise<Thread> {
  return openThread(supabase, { ...params, onlyIfEmpty: false });
}

/**
 * Open a new conversation, unless the current one has had nothing said in it.
 *
 * ## Why this is not `ensureOpenThread`
 *
 * They answer opposite questions. `ensureOpenThread` is *where does this belong*
 * — a run finishing, a question asked with no thread in progress — and it must
 * reuse. This is a founder pressing **New chat**, which is a request for a
 * second place to talk, and reusing a thread with anything in it would be
 * ignoring them.
 *
 * An **empty** open thread is reused, and that is not the same concession: a
 * second press means the same thing as the first, and two identical empty rows
 * in the founder's own list is not an answer to it. Under the same lock, so two
 * presses race to one thread rather than to two.
 *
 * The two coexist because the newest open thread is the current one: after
 * this, that is the new one, so the next run event lands in the conversation
 * the founder is actually in.
 */
export async function openNewThread(
  supabase: SupabaseClient,
  params: { projectId: string; userId: string; title: string },
): Promise<Thread> {
  return openThread(supabase, { ...params, onlyIfEmpty: true });
}

/**
 * The one call both of them are.
 *
 * `userId` is deliberately not sent. The function takes it from `auth.uid()`
 * for a founder and from the project row for the service role, which has no
 * session — the authority is the persisted relationship, never an argument
 * (rule 53). It stays in the signature because every caller has it to hand and
 * removing it from two public functions would be a wider change than this is.
 */
async function openThread(
  supabase: SupabaseClient,
  params: { projectId: string; title: string; onlyIfEmpty: boolean },
): Promise<Thread> {
  const { data, error } = await supabase.rpc("open_nova_thread", {
    p_project_id: params.projectId,
    p_title: params.title.trim().slice(0, MAX_THREAD_TITLE_CHARS),
    p_only_if_empty: params.onlyIfEmpty,
  });

  if (error) throw error;

  const row = (Array.isArray(data) ? data[0] : data) as ThreadRow | undefined;
  /*
   * A project that does not exist, or one the caller cannot insert into. The
   * function returns no row rather than raising, because the insert selects
   * from `projects` — so an unresolvable project is an empty result and is an
   * error here rather than a thread nobody can find.
   */
  if (row === undefined) throw new Error("open_nova_thread returned no thread");

  return toThread(row);
}

/**
 * The thread a project's conversation is currently in, or none.
 *
 * A read, and only a read. The conversations index calls it to mark which one
 * is **current** — where the next run event will land — and a version of it
 * that opened a thread would mean looking at a screen wrote a row, which is the
 * line `ADR 0086` draws around a paid attempt, asked one layer down where the
 * cost is a record rather than money.
 *
 * Deliberately *not* what `ensureOpenThread` calls any more: find-and-create is
 * one statement under a lock now, and a read here followed by an insert there
 * is exactly the race that statement exists to close.
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

/**
 * This project's recent conversations, newest first.
 *
 * ## Why the order is `last_message_at` and not `created_at`
 *
 * A founder looks for the conversation they were *in*, not the one they started
 * most recently, and those stop being the same thread the moment a run writes
 * into an older one. `nova_threads_project_idx` is `(project_id, status,
 * last_message_at desc nulls last)`, which is this read exactly — a thread with
 * nothing in it yet sorts last rather than first, which is also right: an empty
 * conversation is not the one you were having.
 *
 * Bounded, because this table grows with use and an unbounded read of a growing
 * table is the truncating read PERF-018 is about. Archived threads are included
 * deliberately: a founder who put one away can still find it, and the status
 * travels so a surface can say which is which.
 */
export async function listThreads(
  supabase: SupabaseClient,
  params: { projectId: string; limit: number },
): Promise<Thread[]> {
  const { data, error } = await supabase
    .from(THREADS)
    .select(THREAD_COLUMNS)
    .eq("project_id", params.projectId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(params.limit);

  if (error) throw error;
  return ((data ?? []) as ThreadRow[]).map(toThread);
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

/**
 * The four refusals `append_nova_conversation_turn` raises by name.
 *
 * Every one is reachable from a browser without anything going wrong: a thread
 * archived in another tab, a double press, a thread deleted between the read
 * that addressed it and the write, an empty field that got past the composer.
 * They are matched on the exception text because that is what PostgREST
 * surfaces, and they are a closed list so that a fifth one — a genuine fault —
 * keeps throwing instead of being quietly rendered as a polite sentence.
 */
export const TURN_REFUSALS = [
  "thread_not_found",
  "thread_archived",
  "turn_duplicate",
  "turn_incomplete",
] as const;

export type TurnRefusal = (typeof TURN_REFUSALS)[number];

export type AppendTurnResult = { ok: true; sequence: number } | { ok: false; reason: TurnRefusal };

/**
 * One conversational turn — the question, the reply, and what they point at.
 *
 * ## Why this is one database call and not four inserts
 *
 * A transcript with a question and no answer reads as an answer that never
 * came; one with an answer and no question reads as Nova volunteering
 * something. They are one write, and `append_nova_conversation_turn` is where
 * that write is atomic.
 *
 * It is also the only way a `nova` message can be written at all from a
 * founder's session: `nova_messages`' insert policy pins `authenticated` to
 * `author = 'founder'`, deliberately, and the restructure audit's §C.8
 * forecloses the service-role client for this layer by name. The function is
 * `security definer` and re-checks ownership against `auth.uid()` inside
 * itself — the same shape `resolve_founder_input_request` uses.
 *
 * ## Why it returns a refusal rather than throwing one
 *
 * Four of the function's five `raise`s are things a founder can cause by
 * pressing a button twice or asking in a thread they archived in another tab,
 * and a 500 is the wrong answer to any of them. They come back as a
 * {@link TurnRefusal} the command turns into a sentence; anything else is a
 * real database error and still throws, because a caller cannot do anything
 * useful with one and hiding it would lose it.
 *
 * Returns the founder message's sequence, so a caller can say how far the
 * thread has moved without reading it back.
 */
export async function appendConversationTurn(
  supabase: SupabaseClient,
  params: {
    threadId: string;
    question: string;
    reply: string;
    artifact?: { kind: ArtifactKind; ref: string | null } | null;
    actionId?: NovaActionId | null;
    contextVersion?: string | null;
    contextHash?: string | null;
  },
): Promise<AppendTurnResult> {
  const { data, error } = await supabase.rpc("append_nova_conversation_turn", {
    p_thread_id: params.threadId,
    p_question: params.question,
    p_reply: params.reply,
    p_artifact_kind: params.artifact?.kind ?? null,
    p_artifact_ref: params.artifact?.ref ?? null,
    p_action_id: params.actionId ?? null,
    p_context_version: params.contextVersion ?? null,
    p_context_hash: params.contextHash ?? null,
  });

  if (error) {
    const refusal = TURN_REFUSALS.find((reason) => (error.message ?? "").includes(reason));
    if (refusal) return { ok: false, reason: refusal };
    throw error;
  }

  return { ok: true, sequence: typeof data === "number" ? data : 0 };
}

/**
 * How many questions the founder has asked in this thread.
 *
 * `count: "exact", head: true` transfers no rows, so this is a bound check
 * rather than a read of the conversation — which matters because it runs before
 * every question and the thread it counts is the one growing.
 */
export async function countFounderQuestions(
  supabase: SupabaseClient,
  params: { threadId: string },
): Promise<number> {
  const { count, error } = await supabase
    .from(MESSAGES)
    .select("id", { count: "exact", head: true })
    .eq("thread_id", params.threadId)
    .eq("author", "founder");

  if (error) throw error;
  return count ?? 0;
}

/** The same, across one account's projects within a window. */
export async function countFounderQuestionsSince(
  supabase: SupabaseClient,
  params: { userId: string; since: string },
): Promise<number> {
  const { count, error } = await supabase
    .from(MESSAGES)
    .select("id", { count: "exact", head: true })
    .eq("user_id", params.userId)
    .eq("author", "founder")
    .gte("created_at", params.since);

  if (error) throw error;
  return count ?? 0;
}
