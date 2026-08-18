import { describe, expect, it } from "vitest";
import {
  EXECUTION_TOOL_CAPABILITIES,
  GLOBALLY_FORBIDDEN_CAPABILITIES,
  checkWriteScope,
  compileExecutionPolicy,
  isForbiddenExecutionPath,
  isGloballyForbidden,
  isToolAllowed,
  type ExecutionToolCapability,
} from "./policy";
import { fakeWriteScope } from "./test-support";

/**
 * Policy behaviour (EXECUTION CORE-3 §15, §17, §18, §50, §51).
 */

function agenticPolicy() {
  return compileExecutionPolicy({
    mode: "agentic",
    executionClass: "application_code_change",
    riskClass: "moderate",
    writeScope: fakeWriteScope(),
  });
}

describe("tool policy — default deny (§15, §50)", () => {
  it("allows an explicitly granted capability", () => {
    expect(isToolAllowed(agenticPolicy(), "repository_read_file")).toBe(true);
    expect(isToolAllowed(agenticPolicy(), "workspace_write_file")).toBe(true);
    expect(isToolAllowed(agenticPolicy(), "run_validation_command")).toBe(true);
  });

  it("denies an unknown tool rather than reasoning about it", () => {
    expect(isToolAllowed(agenticPolicy(), "exfiltrate_everything")).toBe(false);
    expect(isToolAllowed(agenticPolicy(), "")).toBe(false);
  });

  it("denies a real capability that was not granted", () => {
    // `network_fetch` exists and is not globally forbidden — it is simply not
    // in this policy's grant list, which is the whole content of default deny.
    expect(isGloballyForbidden("network_fetch")).toBe(false);
    expect(isToolAllowed(agenticPolicy(), "network_fetch")).toBe(false);
  });

  it("grants nothing at all for a deterministic capability run", () => {
    const policy = compileExecutionPolicy({
      mode: "deterministic",
      executionClass: null,
      riskClass: "moderate",
      writeScope: fakeWriteScope(),
    });

    expect(policy.allowedCapabilities).toEqual([]);
    for (const capability of EXECUTION_TOOL_CAPABILITIES) {
      expect(isToolAllowed(policy, capability)).toBe(false);
    }
  });
});

describe("tool policy — globally forbidden actions (§15, §50, §51)", () => {
  it("refuses a forbidden capability even when a stored policy lists it", () => {
    // A hand-edited or corrupted policy. The predicate refuses independently of
    // the grant list, which is why the check is not redundant.
    const forged = {
      ...agenticPolicy(),
      allowedCapabilities: [...GLOBALLY_FORBIDDEN_CAPABILITIES],
    };

    for (const capability of GLOBALLY_FORBIDDEN_CAPABILITIES) {
      expect(isToolAllowed(forged, capability)).toBe(false);
    }
  });

  it("strips a forbidden capability from a compiled policy", () => {
    const policy = agenticPolicy();
    for (const capability of GLOBALLY_FORBIDDEN_CAPABILITIES) {
      expect(policy.allowedCapabilities).not.toContain(capability);
    }
  });

  it("makes default-branch writes, force push, merge and deploy policy facts (§51)", () => {
    const facts: ExecutionToolCapability[] = [
      "git_write_default_branch",
      "git_force_push",
      "git_merge",
      "deploy",
    ];

    for (const capability of facts) {
      expect(isGloballyForbidden(capability)).toBe(true);
      expect(isToolAllowed(agenticPolicy(), capability)).toBe(false);
    }
  });

  it("never grants secret access or external side effects", () => {
    const policy = agenticPolicy();
    expect(policy.secrets.mode).toBe("unavailable");
    expect(policy.externalSideEffects).toBe("forbidden");
    expect(isToolAllowed(policy, "secret_read")).toBe(false);
    expect(isToolAllowed(policy, "external_side_effect")).toBe(false);
    expect(isToolAllowed(policy, "database_write")).toBe(false);
  });

  it("never grants the agent its own push, so refs stay deterministic (Rule 57)", () => {
    expect(isToolAllowed(agenticPolicy(), "git_push_branch")).toBe(false);
  });
});

describe("network policy (§14, Rule 64)", () => {
  it("gives an agentic run no network at all", () => {
    expect(agenticPolicy().network).toEqual({ mode: "none" });
  });
});

describe("forbidden paths (§18)", () => {
  it("refuses credential material through the existing sensitive-path policy", () => {
    expect(isForbiddenExecutionPath(".env")).toBe(true);
    expect(isForbiddenExecutionPath(".env.production")).toBe(true);
    expect(isForbiddenExecutionPath("config/server.pem")).toBe(true);
    expect(isForbiddenExecutionPath("deploy/id_rsa")).toBe(true);
    expect(isForbiddenExecutionPath(".npmrc")).toBe(true);
  });

  it("refuses CI/CD definitions, which are execution authority", () => {
    expect(isForbiddenExecutionPath(".github/workflows/deploy.yml")).toBe(true);
    expect(isForbiddenExecutionPath(".github/actions/setup/action.yml")).toBe(true);
    expect(isForbiddenExecutionPath(".circleci/config.yml")).toBe(true);
  });

  it("refuses git internals and dependency output", () => {
    expect(isForbiddenExecutionPath(".git/config")).toBe(true);
    expect(isForbiddenExecutionPath("node_modules/left-pad/index.js")).toBe(true);
  });

  it("refuses any attempt to escape the workspace", () => {
    expect(isForbiddenExecutionPath("../secrets.txt")).toBe(true);
    expect(isForbiddenExecutionPath("src/../../etc/passwd")).toBe(true);
    expect(isForbiddenExecutionPath("")).toBe(true);
  });

  it("does not refuse ordinary source that merely mentions a forbidden word", () => {
    // A substring rule would break real projects. §18 asks for global classes,
    // not for arbitrary paths that happen to read badly.
    expect(isForbiddenExecutionPath("src/lib/github-workflows.ts")).toBe(false);
    expect(isForbiddenExecutionPath("src/components/EnvBanner.tsx")).toBe(false);
    expect(isForbiddenExecutionPath("docs/credentials-guide.md")).toBe(false);
    expect(isForbiddenExecutionPath("src/app/page.tsx")).toBe(false);
  });
});

describe("write scope (§17)", () => {
  it("accepts a change inside every ceiling", () => {
    const result = checkWriteScope(agenticPolicy(), [
      { path: "src/app/page.tsx", bytes: 800 },
      { path: "src/components/Login.tsx", bytes: 1200 },
    ]);

    expect(result).toEqual({ ok: true });
  });

  it("names the forbidden path rather than refusing anonymously", () => {
    const result = checkWriteScope(agenticPolicy(), [
      { path: "src/app/page.tsx", bytes: 100 },
      { path: ".github/workflows/release.yml", bytes: 100 },
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations).toContainEqual({
      kind: "forbidden_path",
      path: ".github/workflows/release.yml",
    });
  });

  it("refuses a change that exceeds the file ceiling", () => {
    const files = Array.from({ length: 16 }, (_, index) => ({
      path: `src/file-${index}.ts`,
      bytes: 10,
    }));

    const result = checkWriteScope(agenticPolicy(), files);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations).toContainEqual({ kind: "too_many_files", changed: 16, limit: 15 });
  });

  it("refuses a change that exceeds the byte ceiling", () => {
    const result = checkWriteScope(agenticPolicy(), [
      { path: "src/huge.ts", bytes: 200_001 },
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations.some((violation) => violation.kind === "diff_too_large")).toBe(true);
  });
});
