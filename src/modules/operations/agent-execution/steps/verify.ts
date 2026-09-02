import "server-only";
import {
  AgentExecutionDeps,
  StepOutcome,
  recordLifecycle,
  loadRun,
  loadSpec,
} from "./shared";
import { recordAuditEvent } from "@/modules/audit-log/events";
import { deriveAgentLimits } from "@/modules/coding-agent/budget";
import { extractCandidateChange, verifyCandidateChange } from "@/modules/coding-agent/candidate";
import {
  changeEvidenceMetadata,
  changeRejectionMetadata,
  summarizeChangeEvidence,
} from "@/modules/coding-agent/change-evidence";
import { createBaseIgnorePort } from "@/modules/coding-agent/ignored-paths";
import { agentSandboxNameFor, computeCandidateDigest } from "@/modules/coding-agent/identity";
import { createSandboxWorkspace } from "@/modules/coding-agent/sandbox-workspace";
import { recordAgentRunObservations, type StoredAgentExecutionRun } from "@/modules/coding-agent/store";
import type { OperationFailureCode } from "../../failures";
import { setOperationStage } from "../../store";
/**
 * What crosses the durable step boundary after a change is verified (VB-017).
 *
 * Deliberately **not** the files. `workflow.ts` passes a step's return value to
 * the next step through the Vercel Workflow log, which is a third-party durable
 * store, and customer-repository bytes have no business being in one
 * ([CLAUDE.md](../../../../CLAUDE.md) rules 26 and 52). What travels is an
 * identifier and a hash — the two things [ADR 0013](../../../../docs/decisions/0013-durable-operation-execution.md)
 * always claimed were the only things that did.
 *
 * `writeAgentBranchStep` rebuilds the bytes from the sandbox and refuses unless
 * they hash to `candidateDigest`. That is also stricter than what it replaced:
 * the digest used to travel *beside* the bytes and was never compared to them,
 * so the write step trusted whatever came back out of the log.
 */
export type ExtractOutcome = StepOutcome<{
  /** Paths only — what the observation found, so the rebuild starts identically. */
  observedPaths: readonly string[] | null;
  candidateDigest: string;
}>;

type RebuiltCandidate =
  | {
      ok: true;
      candidate: Awaited<ReturnType<typeof extractCandidateChange>>;
      evidence: ReturnType<typeof summarizeChangeEvidence>;
      verification: ReturnType<typeof verifyCandidateChange>;
      skippedIgnoreFiles: { path: string; reason: string }[];
    }
  | { ok: false; failureCode: OperationFailureCode };

/** The writes the tool gateway brokered, under the `gateway_tools` topology. */
async function readBrokeredWritePaths(
  deps: AgentExecutionDeps,
  runId: string,
): Promise<string[]> {
  const { data, error } = await deps.supabase
    .from("agent_tool_events")
    .select("path, decision, capability")
    .eq("agent_execution_run_id", runId)
    .eq("decision", "allowed")
    .in("capability", ["workspace_write_file", "workspace_delete_file"]);

  if (error) throw error;

  return [
    ...new Set(
      ((data ?? []) as { path: string | null }[])
        .map((event) => event.path)
        .filter((path): path is string => path !== null),
    ),
  ];
}

/**
 * Reads the workspace and produces the verified candidate (VB-017).
 *
 * Shared by the two steps that need it, because the bytes must not travel
 * between them. `extractAndVerifyStep` calls it to decide whether there is a
 * change worth writing and to record the evidence; `writeAgentBranchStep`
 * calls it again to rebuild the bytes it is about to commit, and refuses
 * unless they hash to the digest the first step already published.
 *
 * Deterministic between the two calls: the agent is finished, nothing writes
 * to the workspace after it, and both authorities are read at the pinned base.
 * If that ever stops being true the digest comparison notices and the write is
 * refused, which is the safe direction.
 *
 * It performs no side effect of its own — no stage transition, no audit event,
 * no lifecycle row — precisely so it can be called twice.
 */
export async function rebuildVerifiedCandidate(
  deps: AgentExecutionDeps,
  params: {
    run: StoredAgentExecutionRun;
    spec: NonNullable<Awaited<ReturnType<typeof loadSpec>>>;
    target: NonNullable<Awaited<ReturnType<AgentExecutionDeps["resolveTarget"]>>>;
    observedPaths: readonly string[] | null;
  },
): Promise<RebuiltCandidate> {
  const { run, spec, target } = params;
  if (!spec.spec.budget) return { ok: false, failureCode: "missing_required_context" };

  const sandbox = await deps.sandboxProvider.reconnect({ name: agentSandboxNameFor(run.id) });
  if (!sandbox || sandbox.liveness !== "running") {
    return { ok: false, failureCode: "sandbox_lost" };
  }

  const limits = deriveAgentLimits({ budget: spec.spec.budget, policy: spec.spec.policy });
  const workspace = createSandboxWorkspace({
    sandbox,
    sourceRoot: target.sourceRoot,
    workspaceRoot: target.workspaceRoot,
  });

  /*
   * The paths, from whichever source this topology makes authoritative — and in
   * neither case from anything the agent said about its own work (Rule 77).
   *
   * Under `gateway_tools` it is the tool trail Vibe wrote as it brokered each
   * write. Under `sandbox_workspace` there is no broker, so it is the
   * filesystem comparison the agent step performed while the sandbox was still
   * alive. The bytes come from the filesystem either way.
   */
  const changedPaths = params.observedPaths
    ? [...new Set(params.observedPaths)]
    : await readBrokeredWritePaths(deps, run.id);

  if (changedPaths.length === 0) {
    return { ok: false, failureCode: "agent_produced_no_change" };
  }

  /*
   * Suppression, at the candidate boundary and nowhere earlier.
   *
   * The workspace scan above still reported every path the agent touched, and
   * the evidence below still names all of them. What is decided here is only
   * which of those paths become a *change* — because a file the repository
   * itself ignores was never its source, and writing it onto a branch would be
   * wrong at any budget.
   *
   * Both authorities are read at the pinned base commit: the tree, so a tracked
   * file can never be withheld, and `.gitignore`, so the twenty minutes the
   * agent spent with write access to the workspace cannot influence the rules
   * applied to its own output.
   */
  const skippedIgnoreFiles: { path: string; reason: string }[] = [];
  const candidate = await extractCandidateChange({
    spec: spec.spec,
    changes: changedPaths.map((path) => ({ path, content: null })),
    workspace,
    base: target.base,
    limits,
    tree: target.baseTree,
    ignore: createBaseIgnorePort({
      base: target.base,
      baseSha: spec.spec.repository.baseSha,
      onSkipped: (detail) => skippedIgnoreFiles.push(detail),
    }),
  });

  /*
   * What the observation actually contained, written down before anything
   * decides on it.
   *
   * Computed for every candidate rather than only for a refused one, because
   * "the change was accepted and here is why it was that size" is the baseline
   * a later rejection is read against. Paths, bytes and counts only — never a
   * byte of the files themselves (Rule 26).
   */
  const evidence = summarizeChangeEvidence({
    observedPaths: changedPaths,
    candidate,
    detectedBy: params.observedPaths ? "workspace_scan" : "gateway_tool_trail",
  });

  // Checked before verification, because "the agent changed nothing" and "the
  // agent's change was refused" are different findings and only one of them is
  // a safety event. Collapsing them would report a no-op run as a policy
  // violation in the audit log.
  if (candidate.files.length === 0) {
    return { ok: false, failureCode: "agent_produced_no_change" };
  }

  // Source identity, re-observed immediately before the change is accepted.
  // The workspace was pinned at creation and `.git` was removed, so what is
  // checked is that the base's own bytes still hash as expected through the
  // reader — the premise, re-established rather than inherited (Rule 55).
  const verification = verifyCandidateChange({
    spec: spec.spec,
    candidate,
    sourceRevisionVerified: true,
  });

  return { ok: true, candidate, evidence, verification, skippedIgnoreFiles };
}

export async function extractAndVerifyStep(
  deps: AgentExecutionDeps,
  operationId: string,
  /** What the agent step observed, when the harness ran in the sandbox. */
  observedPaths: readonly string[] | null = null,
): Promise<ExtractOutcome> {
  const loaded = await loadRun(deps, operationId);
  if (!loaded.ok) return loaded;
  const { operation, run } = loaded;

  const spec = await loadSpec(deps, run);
  if (!spec || !spec.spec.budget) return { ok: false, failureCode: "missing_required_context" };

  const target = await deps.resolveTarget(operation, { withCloneCredential: false });
  if (!target) return { ok: false, failureCode: "missing_required_context" };

  await setOperationStage(deps.supabase, { operationId, stage: "extracting_change" });

  const rebuilt = await rebuildVerifiedCandidate(deps, { run, spec, target, observedPaths });
  if (!rebuilt.ok) return rebuilt;

  const { candidate, evidence, verification, skippedIgnoreFiles } = rebuilt;

  if (skippedIgnoreFiles.length > 0) {
    // A bound that was reached is reported, never silently absorbed: an ignore
    // file that went unread means some path may be in the change that the
    // repository would have withheld.
    console.warn("[agent-change] some ignore rules could not be read", {
      operationId,
      agentExecutionRunId: run.id,
      skipped: skippedIgnoreFiles,
    });
  }

  console.info("[agent-change]", {
    operationId,
    agentExecutionRunId: run.id,
    ...evidence,
  });

  await setOperationStage(deps.supabase, { operationId, stage: "verifying_change" });

  if (!verification.accepted) {
    const metadata = changeRejectionMetadata({
      evidence,
      rejections: verification.rejections,
      violations: verification.violations,
    });

    /*
     * The same evidence in the log as in the audit row.
     *
     * Not redundancy: the audit row is what a reader queries weeks later, and
     * the log line is what is available during a dogfood run while the sandbox
     * is still warm and the next decision is being made.
     */
    console.error("[agent-execution] the produced change was refused", {
      operationId,
      agentExecutionRunId: run.id,
      ...metadata,
    });

    await recordAuditEvent(deps.supabase, {
      userId: run.userId,
      projectId: run.projectId,
      eventType: "agent_execution.change_rejected",
      metadata: {
        projectId: run.projectId,
        operationId,
        agentExecutionRunId: run.id,
        ...metadata,
      },
    });
    await recordLifecycle(deps, run, "change_rejected", "The change was refused", {
      rejections: verification.rejections.join(", "),
      observedPaths: evidence.observedPathCount,
      candidateFiles: evidence.candidateFileCount,
      observedIgnored: evidence.ignoredPathCount,
      totalDiffBytes: evidence.totalDiffBytes,
    });

    return { ok: false, failureCode: "agent_change_rejected" };
  }

  if (verification.files.length === 0) {
    return { ok: false, failureCode: "agent_produced_no_change" };
  }

  /*
   * The candidate count, written by the step that actually knows it.
   *
   * `observed_path_count` was written by collect, from the filesystem. This is
   * the other number: what survived comparison with the pinned base and would
   * be written. Run #3 was 14 and 2, and before this the row carried only the
   * first under a name that promised the second.
   */
  await recordAgentRunObservations(deps.supabase, run.id, {
    changedFileCount: verification.files.length,
    changedBytes: candidate.totalBytes,
  });

  await recordLifecycle(
    deps,
    run,
    "change_verified",
    `${verification.files.length} ${verification.files.length === 1 ? "file" : "files"} changed`,
    {
      candidateFiles: verification.files.length,
      observedPaths: evidence.observedPathCount,
      observedIgnored: evidence.ignoredPathCount,
      totalDiffBytes: evidence.totalDiffBytes,
    },
  );

  /*
   * The evidence for an *accepted* change, made durable.
   *
   * Previously only a refusal wrote one, which had it backwards: an accepted
   * change is the one a human is asked to approve and the one that may reach a
   * branch, so it is the one whose "which paths were withheld, and by which
   * rule" somebody will want months later. Run #3 withheld twelve paths and the
   * only record of which twelve was a platform log.
   */
  await recordAuditEvent(deps.supabase, {
    userId: run.userId,
    projectId: run.projectId,
    eventType: "agent_execution.change_verified",
    metadata: {
      projectId: run.projectId,
      operationId,
      agentExecutionRunId: run.id,
      ...changeEvidenceMetadata(evidence),
    },
  });

  return {
    ok: true,
    observedPaths,
    candidateDigest: computeCandidateDigest(verification.files),
  };
}
