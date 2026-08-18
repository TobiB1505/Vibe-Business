import { isSensitivePath } from "@/modules/repository-intelligence/path-policy";
import {
  EXECUTION_POLICY_VERSION,
  type ExecutionClass,
  type ExecutionMode,
  type ExecutionRiskClass,
} from "./schema";

/**
 * The compiled execution policy (EXECUTION CORE-3 §13, §14, §15, §17, §18).
 *
 * ## The rule this file is
 *
 * > Prompt: "Do not modify main."
 * > System: `git_write_default_branch` is not a capability anything can hold.
 * >
 * > The system wins.
 *
 * §13 asks for policy to exist *outside* the prompt, and this is what that
 * means concretely: a compiled structure with a default-deny predicate, a set
 * of capabilities that can never be granted whatever a caller passes, and a
 * version stamped onto every spec that used it.
 *
 * The future prompt compiler (§12) may *describe* these rules to a model. That
 * description is a courtesy so the agent works productively inside its box. It
 * is never the enforcement, and nothing in this file reads a prompt.
 *
 * ## Default deny (§15)
 *
 * `isToolAllowed` returns false for anything not explicitly granted, including
 * capabilities that do not exist. An unknown tool name is not an error to be
 * reasoned about — it is simply not allowed, which is the only safe answer when
 * the requester is a model.
 */

/* ---------------------------------------------------------------------------
 * Tool capabilities (§14)
 * ------------------------------------------------------------------------ */

/**
 * Every ability the future agent-tool layer could be asked to broker.
 *
 * Named for the *effect*, not for the tool that would provide it, so a Core-4
 * adapter cannot introduce a second name for an already-forbidden effect. A new
 * tool must map onto one of these or it does not run.
 */
export const EXECUTION_TOOL_CAPABILITIES = [
  /* Read — bounded inspection of the isolated workspace. */
  "repository_list_files",
  "repository_search",
  "repository_read_file",

  /* Write — only inside the isolated execution workspace. */
  "workspace_write_file",
  "workspace_delete_file",

  /* Commands — only the profile's own validation commands. */
  "run_validation_command",

  /* Network. */
  "network_fetch",

  /* Git. */
  "git_read_source_identity",
  "git_push_branch",
  "git_force_push",
  "git_write_default_branch",
  "git_merge",

  /* Everything the product must never hand a model. */
  "secret_read",
  "deploy",
  "external_side_effect",
  "database_write",
] as const;
export type ExecutionToolCapability = (typeof EXECUTION_TOOL_CAPABILITIES)[number];

/**
 * Capabilities no policy may ever grant (§15, §51).
 *
 * These are not defaults and they are not per-task decisions. They are facts
 * about the system: `compileExecutionPolicy` strips them from any grant list,
 * and `isToolAllowed` refuses them even if a stored policy somehow contains
 * one. Two independent refusals, because this is the list where being wrong
 * once is expensive.
 *
 * ## Why `git_push_branch` is here
 *
 * It looks like the agent's own job — it produces a change, so surely it pushes
 * it. It does not. Rule 57 says model output must never control repository
 * paths, refs, branch names or commit messages, and the existing
 * `execution/github-writer.ts` already derives all four deterministically from
 * an execution identity. An agent that could push would be choosing a ref name;
 * an agent that hands Vibe a file set cannot. The bridge in
 * `proposed-change.ts` is where that hand-off is specified.
 *
 * ## Why merge and deploy are here rather than "not implemented"
 *
 * Because "not implemented" decays. Merge *is* implemented (Sprint 11C) and
 * runs only from a human approval bound to an exact commit (ADR 0018, 0019);
 * deploy is not implemented and must not become implemented by an agent
 * discovering a deployment CLI in a repository. Both are policy facts, so both
 * are stated here where a future tool author must walk past them.
 */
export const GLOBALLY_FORBIDDEN_CAPABILITIES: readonly ExecutionToolCapability[] = [
  "git_push_branch",
  "git_force_push",
  "git_write_default_branch",
  "git_merge",
  "secret_read",
  "deploy",
  "external_side_effect",
  "database_write",
] as const;

export function isGloballyForbidden(capability: string): boolean {
  return (GLOBALLY_FORBIDDEN_CAPABILITIES as readonly string[]).includes(capability);
}

/* ---------------------------------------------------------------------------
 * Network and secrets
 * ------------------------------------------------------------------------ */

/**
 * What the execution environment may reach (§14, Rule 64).
 *
 * `none` is the only value V1 produces. Repository-controlled execution already
 * runs under the most restrictive network policy the sandbox provider supports
 * (Rule 64), and an agent with arbitrary egress is an exfiltration channel for
 * the customer's own source — the thing the whole isolation story exists to
 * prevent. `allowlist` exists so a future registry mirror can be named
 * explicitly rather than by widening the global policy.
 */
export type ExecutionNetworkPolicy =
  | { mode: "none" }
  | { mode: "allowlist"; hosts: readonly string[] };

/**
 * Secret availability (§11, §15).
 *
 * One value, and it is a type rather than a boolean so that adding a second one
 * is a visible schema change with a reviewer attached. Rule 62 already forbids
 * exposing Vibe or customer production secrets to validation code; an agent is
 * strictly less trusted than validation.
 */
export type ExecutionSecretPolicy = { mode: "unavailable" };

/* ---------------------------------------------------------------------------
 * Write scope (§17, §18)
 * ------------------------------------------------------------------------ */

/**
 * Path classes no execution may read *or* write, in any project (§18).
 *
 * Global classes rather than repository-specific paths, so a valid project is
 * never broken by a rule written for someone else's layout. Credential material
 * is delegated to `repository-intelligence/path-policy.ts` rather than
 * re-listed here — that module is already the one place this codebase decides
 * what is sensitive (Rule 28), and a second list would drift from it.
 *
 * What this file adds on top are classes that are not *secret* but are
 * *authority*: CI/CD definitions, git internals, and dependency/build output.
 * An agent that may edit `.github/workflows/` can arrange for anything to run
 * with the repository's own credentials, which is a privilege escalation that
 * no diff review reliably catches.
 */
const FORBIDDEN_PATH_SEGMENTS: readonly string[] = [".git", "node_modules"];

const FORBIDDEN_PATH_PREFIXES: readonly string[] = [
  ".github/workflows/",
  ".github/actions/",
  ".circleci/",
  ".gitlab-ci",
  ".husky/",
];

/**
 * True when a path is outside every execution's write and read scope (§18).
 *
 * Segment- and prefix-anchored rather than substring-matched, for the reason
 * `path-policy.ts` documents: `src/lib/github-workflows.ts` is ordinary source
 * and a substring rule would quietly exclude it.
 */
export function isForbiddenExecutionPath(path: string): boolean {
  const normalized = path.replace(/^\.\//, "").replace(/^\/+/, "");
  if (normalized.length === 0) return true;

  // No escaping the workspace, whatever the segment order.
  if (normalized.split("/").includes("..")) return true;

  if (isSensitivePath(normalized)) return true;

  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  if (segments.some((segment) => FORBIDDEN_PATH_SEGMENTS.includes(segment))) return true;

  return FORBIDDEN_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

/**
 * The layered scope model §17 asks for.
 *
 * ## Why discovery and mutation differ
 *
 * An agent cannot know which files it must change before it has looked at the
 * repository, so demanding a predicted file list would produce fake precision —
 * a spec that is either wrong or so broad it says nothing. Discovery is
 * therefore generous within a budget, and mutation is where the real limits sit.
 *
 * ## Why the limits are counts and bytes rather than paths
 *
 * Because the honest constraint is *blast radius*, not location. "Change at
 * most N files, at most M bytes, none of them forbidden" is checkable against
 * a produced diff without predicting anything, and it is exactly what the
 * PreparedChange bridge verifies before a branch is written.
 */
export type ExecutionWriteScope = {
  discovery: {
    maxFilesRead: number;
    maxBytesPerFile: number;
  };
  mutation: {
    maxChangedFiles: number;
    maxChangedBytes: number;
    /** Restated on the scope so a stored spec is self-describing. */
    forbiddenPathClasses: readonly string[];
  };
};

/** Human-readable names for the forbidden classes, stored with the spec. */
const FORBIDDEN_PATH_CLASS_LABELS: readonly string[] = [
  "credential and key material",
  "git internals",
  "dependency and build output",
  "CI/CD workflow definitions",
];

/* ---------------------------------------------------------------------------
 * The compiled policy
 * ------------------------------------------------------------------------ */

export type ExecutionPolicy = {
  policyVersion: typeof EXECUTION_POLICY_VERSION;
  /** Everything granted. Anything absent is denied (§15). */
  allowedCapabilities: readonly ExecutionToolCapability[];
  /** Restated explicitly so a stored spec documents its own refusals (§51). */
  forbiddenCapabilities: readonly ExecutionToolCapability[];
  network: ExecutionNetworkPolicy;
  secrets: ExecutionSecretPolicy;
  writeScope: ExecutionWriteScope;
  /** External consequential actions are forbidden by default and in V1 always. */
  externalSideEffects: "forbidden";
};

/**
 * Grants for a bounded application-code change.
 *
 * Read, write-in-workspace, and the profile's own validation commands. Nothing
 * else — no network, no git, no secrets. `git_read_source_identity` is
 * deliberately absent: the base SHA is *given* to the agent in the spec (§16),
 * so there is nothing for it to discover and no reason for git to exist inside
 * the workspace at all.
 */
const APPLICATION_CODE_CHANGE_GRANTS: readonly ExecutionToolCapability[] = [
  "repository_list_files",
  "repository_search",
  "repository_read_file",
  "workspace_write_file",
  "workspace_delete_file",
  "run_validation_command",
] as const;

/**
 * Deterministic capability execution grants nothing at all.
 *
 * A registry capability is Vibe's own code writing bytes it generated; there is
 * no agent, no workspace and no tool loop. An empty grant list is the accurate
 * description, and producing a policy for it anyway keeps every spec shaped the
 * same so nothing downstream has to special-case the absence.
 */
const NO_GRANTS: readonly ExecutionToolCapability[] = [] as const;

export type CompilePolicyInput = {
  mode: ExecutionMode;
  executionClass: ExecutionClass | null;
  riskClass: ExecutionRiskClass;
  /** Fixture-supplied in tests; production limits arrive with Core-4's budget policy. */
  writeScope: ExecutionWriteScope;
};

/**
 * Compiles the enforceable policy for one resolved step (§13, §15).
 *
 * Deterministic and total: every mode produces a policy, and a mode that cannot
 * execute produces one that permits nothing. There is no path through this
 * function that returns a broader grant than the mode justifies, and the
 * globally forbidden set is subtracted last so no future branch can add one
 * back by accident.
 */
export function compileExecutionPolicy(input: CompilePolicyInput): ExecutionPolicy {
  const granted =
    input.mode === "agentic" && input.executionClass === "application_code_change"
      ? APPLICATION_CODE_CHANGE_GRANTS
      : NO_GRANTS;

  // Subtracted rather than trusted. If a future edit adds a forbidden
  // capability to a grant list, this line is what stops it reaching a spec.
  const allowed = granted.filter((capability) => !isGloballyForbidden(capability));

  return {
    policyVersion: EXECUTION_POLICY_VERSION,
    allowedCapabilities: allowed,
    forbiddenCapabilities: GLOBALLY_FORBIDDEN_CAPABILITIES,
    network: { mode: "none" },
    secrets: { mode: "unavailable" },
    writeScope: {
      discovery: { ...input.writeScope.discovery },
      mutation: {
        ...input.writeScope.mutation,
        forbiddenPathClasses: FORBIDDEN_PATH_CLASS_LABELS,
      },
    },
    externalSideEffects: "forbidden",
  };
}

/**
 * The single predicate every future tool call must pass (§15, §50).
 *
 * Default deny, stated twice: an unknown or ungranted capability is refused,
 * and a globally forbidden one is refused even if it somehow appears in the
 * grant list. The second check is not redundant — it is what makes a corrupted
 * or hand-edited stored policy safe to evaluate.
 */
export function isToolAllowed(policy: ExecutionPolicy, capability: string): boolean {
  if (isGloballyForbidden(capability)) return false;
  return (policy.allowedCapabilities as readonly string[]).includes(capability);
}

/**
 * Whether a produced change stays inside its policy (§17, §30).
 *
 * Checked by Vibe against the *actual* file set an agent produced, before any
 * branch is written — never asserted by the agent. An out-of-scope diff is a
 * refusal, not a warning.
 */
export type WriteScopeViolation =
  | { kind: "forbidden_path"; path: string }
  | { kind: "too_many_files"; changed: number; limit: number }
  | { kind: "diff_too_large"; bytes: number; limit: number };

export function checkWriteScope(
  policy: ExecutionPolicy,
  files: readonly { path: string; bytes: number }[],
): { ok: true } | { ok: false; violations: readonly WriteScopeViolation[] } {
  const violations: WriteScopeViolation[] = [];

  for (const file of files) {
    if (isForbiddenExecutionPath(file.path)) {
      violations.push({ kind: "forbidden_path", path: file.path });
    }
  }

  const { maxChangedFiles, maxChangedBytes } = policy.writeScope.mutation;
  if (files.length > maxChangedFiles) {
    violations.push({ kind: "too_many_files", changed: files.length, limit: maxChangedFiles });
  }

  const bytes = files.reduce((total, file) => total + file.bytes, 0);
  if (bytes > maxChangedBytes) {
    violations.push({ kind: "diff_too_large", bytes, limit: maxChangedBytes });
  }

  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}
