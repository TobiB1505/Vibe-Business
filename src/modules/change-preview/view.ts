import {
  isPreviewExpired,
  type PreviewAvailability,
  type PreviewFailureCode,
  type PreviewSession,
  type PreviewStage,
} from "./schema";

/**
 * What a preview looks like to a user (Sprint 10B-3 §2, §3, §8, §14).
 *
 * ## Why this is a pure function on the server
 *
 * The panel has ten states and most of them look similar from a distance:
 * "there is no preview" is true of a change that has never been validated, one
 * whose artifact expired, one whose artifact was deleted, and one whose preview
 * failed — and the right sentence, and the right button, differ in every case.
 *
 * Deriving that in the component would mean the client inferring authority from
 * a handful of unrelated fields. It would be wrong in exactly the way that
 * matters: a stale client could offer **Start temporary preview** for an
 * artifact that no longer exists, and the user would pay for a failed sandbox
 * to find out.
 *
 * So the server decides, from persisted state, and the component renders what
 * it was given. Same discipline as `validation/view.ts`, for the same reason.
 *
 * ## Expiry is evaluated here, not in the browser
 *
 * A client clock can be wrong, paused by a sleeping laptop, or simply stale
 * because the tab has been open for twenty minutes. `expires_at` is compared on
 * the server on every read, so a preview past its deadline never renders an
 * **Open preview** button — whatever the browser believes (§13).
 *
 * ## No percentages, and no invented reassurance
 *
 * The stage copy names real work. A preview is tens of seconds, the phases have
 * different durations, and any progress number would be made up.
 */

export type PreviewCardState =
  /** The change has no commit to serve. */
  | "not_available"
  /**
   * No development server exists for this application's frameworks.
   *
   * Distinct from `not_available`, and the distinction is what a founder can do
   * about it: a change with no commit gets one when the agent finishes, while
   * this one is a property of the repository that will not change by waiting.
   */
  | "not_supported"
  /**
   * Vibe's read of the repository does not currently resolve an application to
   * serve — an outdated analysis, a missing lockfile, an unanswered question
   * about which app.
   *
   * Separate from `not_supported` because the founder's move is different and
   * the framework sentence would be false: nothing is wrong with the framework,
   * Vibe simply cannot say yet which directory it would run in.
   */
  | "repository_not_ready"
  | "ready_to_start"
  | "starting"
  | "running"
  /** Teardown has been claimed and handed to the durable workflow (§14). */
  | "stopping"
  | "failed"
  | "stopped"
  | "expired";

export type PreviewCard = {
  state: PreviewCardState;
  /** The session to act on, when there is one. Never a sandbox or snapshot id. */
  previewSessionId: string | null;
  /** The live operation, so the panel can poll without inventing an id. */
  operationRunId: string | null;
  stage: PreviewStage | null;
  failureCode: PreviewFailureCode | null;
  /** Safe copy for a failure. Never a provider message (§14). */
  failureMessage: string | null;
  expiresAt: string | null;
  readyAt: string | null;
};

/**
 * Stage copy for a starting preview (§7).
 *
 * A `Record` over the closed stage union: adding a stage without copy becomes a
 * type error rather than a blank line while a user waits.
 */
export const PREVIEW_STAGE_LABELS: Record<PreviewStage, string> = {
  preflight: "Checking preview eligibility",
  acquiring_source: "Getting your code",
  installing: "Installing dependencies",
  starting_dev_server: "Starting your application",
  checking_preview: "Waiting for the first page to build",
  completed: "Preview ready",
  // v1 stages. No new session reaches one; a row that recorded one still
  // renders a sentence rather than a blank.
  restoring_artifact: "Restoring validated artifact",
  verifying_artifact: "Verifying artifact integrity",
  starting_server: "Starting application",
};

export type PreviewCardInput = {
  /**
   * Whether the change has a commit to serve.
   *
   * The whole precondition under `preview-policy-v2`. It used to be *a passing
   * validation whose captured artifact was still usable*, which is what made a
   * preview strictly later than a five-minute check (Sprint 0114).
   */
  prepared: boolean;
  /**
   * Whether a preview can start at all, and if not which of the two reasons.
   *
   * A project-level fact, resolved once by the caller rather than here: it
   * reads the repository snapshot, and asking per card is what the read-count
   * test on the workspace list measures.
   *
   * Without it this card offered `ready_to_start` for every prepared change in
   * every project — the founder clicked, confirmed publishing an unlisted
   * public URL, and only then learned no server exists. The confirmation is
   * load-bearing rather than a courtesy, which is exactly why asking for it on
   * behalf of something that cannot start is the wrong order.
   */
  availability: PreviewAvailability;
  /** The most recent preview session for this change, in any state. */
  session: PreviewSession | null;
  /** Safe copy for `session.failureCode`, resolved by the caller. */
  failureMessage: string | null;
};

export function buildPreviewCard(input: PreviewCardInput, now: Date = new Date()): PreviewCard {
  const empty = {
    previewSessionId: null,
    operationRunId: null,
    stage: null,
    failureCode: null,
    failureMessage: null,
    expiresAt: null,
    readyAt: null,
  } as const;

  // A claimed teardown outranks everything, including the deadline. The work is
  // already in flight, so reporting the session as expired would invite a second
  // stop for something being stopped.
  if (input.session?.status === "stopping") {
    return {
      ...empty,
      state: "stopping",
      previewSessionId: input.session.id,
      operationRunId: input.session.operationRunId,
      expiresAt: input.session.expiresAt,
    };
  }

  // A live session outranks everything below it, including artifact state. The
  // artifact is deleted at teardown, so a *running* preview whose artifact is
  // already gone is the normal case rather than an inconsistency — and reading
  // the artifact first would report it as `artifact_unavailable` while the user
  // is looking at a working preview.
  if (input.session && !isPreviewExpired(input.session, now)) {
    if (input.session.status === "starting") {
      return {
        ...empty,
        state: "starting",
        previewSessionId: input.session.id,
        operationRunId: input.session.operationRunId,
        stage: input.session.stage,
        expiresAt: input.session.expiresAt,
      };
    }

    if (input.session.status === "running") {
      return {
        ...empty,
        state: "running",
        previewSessionId: input.session.id,
        operationRunId: input.session.operationRunId,
        stage: input.session.stage,
        expiresAt: input.session.expiresAt,
        readyAt: input.session.readyAt,
      };
    }
  }

  // A commit to serve is the whole precondition. A preview no longer waits for
  // validation — that is the point of it (Sprint 0114).
  if (!input.prepared) return { ...empty, state: "not_available" };

  const terminal = terminalSession(input, now);
  if (terminal) return terminal;

  /*
   * Checked after the session states, deliberately.
   *
   * A session that ran is a fact, and a repository that later loses its server
   * — a framework removed, an application restructured — does not make the
   * session that already ran stop having run. Only the *offer* is withdrawn.
   */
  if (input.availability === "no_dev_server") return { ...empty, state: "not_supported" };
  if (input.availability === "repository_not_ready") {
    return { ...empty, state: "repository_not_ready" };
  }

  return { ...empty, state: "ready_to_start" };
}

/**
 * A finished session, and why it finished.
 *
 * Simpler than it was, because what it used to weigh has gone. Under v1 a
 * settled session was outranked by a still-usable artifact — previewed,
 * stopped, then re-validated was a real sequence, and reporting it as "Preview
 * stopped" left the user looking at history with a live artifact sitting there
 * already paid for.
 *
 * There is no artifact now, and starting again costs a fresh clone either way,
 * so a finished session is simply reported as finished and the card offers a
 * new one alongside it.
 */
function terminalSession(input: PreviewCardInput, now: Date): PreviewCard | null {
  const session = input.session;
  if (!session) return null;

  const base = {
    previewSessionId: session.id,
    operationRunId: session.operationRunId,
    stage: null,
    failureCode: session.failureCode,
    failureMessage: session.failureCode ? input.failureMessage : null,
    expiresAt: session.expiresAt,
    readyAt: session.readyAt,
  };

  if (session.status === "failed") return { ...base, state: "failed" };
  if (session.status === "stopped") return { ...base, state: "stopped" };
  if (session.status === "expired") return { ...base, state: "expired" };

  // `starting` or `running` past its deadline. The row has not converged yet —
  // an authorized read is what converges it — but the user must not be offered
  // a preview URL in the meantime (§13).
  if (isPreviewExpired(session, now)) return { ...base, state: "expired" };

  return null;
}
