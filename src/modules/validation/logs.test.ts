import { describe, expect, it } from "vitest";
import { SANDBOX_BUDGETS } from "./budgets";
import { sanitizeCommandOutput } from "./logs";

/**
 * Bounded, safe storage of untrusted build output (Sprint 10A §15, §38).
 *
 * Every byte tested here was produced by code Vibe did not write. The UI lands
 * in 10B, but storage has to be safe now — a sanitizer added later cannot
 * clean rows written earlier.
 */

describe("bounds (§14, §38)", () => {
  it("truncates enormous output and says so", () => {
    const result = sanitizeCommandOutput("x".repeat(5_000_000));

    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(SANDBOX_BUDGETS.maxStoredOutputChars);
  });

  it("keeps the tail, because that is where the error is", () => {
    const lines = Array.from({ length: 5000 }, (_, index) => `step ${index}`);
    const result = sanitizeCommandOutput([...lines, "Error: the actual reason"].join("\n"));

    expect(result.text).toContain("Error: the actual reason");
    expect(result.text).not.toContain("step 0");
  });

  it("caps the number of stored lines", () => {
    const result = sanitizeCommandOutput(Array.from({ length: 900 }, (_, i) => `line ${i}`).join("\n"));

    expect(result.text.split("\n").length).toBeLessThanOrEqual(SANDBOX_BUDGETS.maxStoredOutputLines);
    expect(result.truncated).toBe(true);
  });

  it("truncates a single enormous line rather than storing it", () => {
    // One 40 MB line is a denial of service against the database and every
    // renderer downstream.
    const result = sanitizeCommandOutput(`prefix ${"y".repeat(100_000)}`);

    expect(result.text.length).toBeLessThanOrEqual(SANDBOX_BUDGETS.maxStoredOutputChars);
    expect(result.text).toContain("[truncated]");
  });

  it("leaves short ordinary output untouched", () => {
    expect(sanitizeCommandOutput("Compiled successfully")).toEqual({
      text: "Compiled successfully",
      truncated: false,
    });
  });
});

describe("control sequences (§15, §38)", () => {
  it("strips ANSI colour codes", () => {
    const result = sanitizeCommandOutput("[31mFAILED[0m tests");

    expect(result.text).toBe("FAILED tests");
    expect(result.text).not.toContain("");
  });

  it("strips OSC hyperlink sequences", () => {
    // OSC 8 can render text that links somewhere entirely different — a
    // phishing primitive inside a build log.
    const result = sanitizeCommandOutput("]8;;https://evil.testclick me]8;;");

    expect(result.text).not.toContain("evil.test");
    expect(result.text).toContain("click me");
  });

  it("removes carriage returns, bells and NULs", () => {
    const result = sanitizeCommandOutput("progress\r\u0007\u0000done");

    expect(result.text).toBe("progressdone");
  });

  it("does not treat one stray control byte as a binary dump", () => {
    // A ratio-only heuristic misfires here: one NUL in a short line is 7%.
    // Stripping the byte is the correct handling, not discarding the message.
    expect(sanitizeCommandOutput("Error:\u0000 build failed").text).toBe("Error: build failed");
  });

  it("preserves tabs and newlines, which carry real structure", () => {
    expect(sanitizeCommandOutput("a\tb\nc").text).toBe("a\tb\nc");
  });
});

describe("binary output (§38)", () => {
  it("describes binary output instead of storing it", () => {
    const binary = "\u0000\u0000\u0000\u0000".repeat(200);
    const result = sanitizeCommandOutput(binary);

    expect(result.text).toBe("[binary output omitted]");
    expect(result.truncated).toBe(true);
  });

  it("does not mistake ordinary text for binary", () => {
    expect(sanitizeCommandOutput("Building...\nDone in 12s").text).toContain("Done in 12s");
  });
});

describe("secret redaction (§15)", () => {
  it.each([
    ["a GitHub token", "leaked ghp_abcdefghijklmnopqrstuvwxyz0123456789 here"],
    ["a GitHub server token", "ghs_abcdefghijklmnopqrstuvwxyz0123"],
    ["a fine-grained PAT", "github_pat_11ABCDEFG0abcdefghijklmnop"],
    ["an Anthropic key", "sk-ant-api03-abcdefghijklmnopqrstuvwxyz"],
    ["an AWS access key", "AKIAIOSFODNN7EXAMPLE"],
  ])("redacts %s printed by a build", (_label, output) => {
    // A safety net, not the control: the sandbox holds no Vibe secret in the
    // first place. This exists because the *customer's* build may print theirs,
    // and storing it would make Vibe's database a secondary breach surface.
    const result = sanitizeCommandOutput(output);

    expect(result.text).toContain("[redacted]");
    expect(result.text).not.toMatch(/ghp_a|ghs_a|github_pat_11A|sk-ant-api03-a|AKIAIOSFODNN7/);
  });

  it("redacts a JWT-shaped value", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";

    expect(sanitizeCommandOutput(`token: ${jwt}`).text).not.toContain("eyJhbGciOiJIUzI1NiJ9");
  });

  it("leaves ordinary long identifiers alone", () => {
    // Redaction that eats commit shas and package versions would make failure
    // output useless.
    const result = sanitizeCommandOutput("built 2f05958e3410deaeb97029861abc05889139b4a7 in 4.2s");

    expect(result.text).toContain("2f05958e3410deaeb97029861abc05889139b4a7");
  });
});

describe("markup (§15)", () => {
  it("stores HTML as text without executing anything", () => {
    // 10B will render this. Storage keeps it inert and escaping remains the
    // renderer's job — two layers, because one is a single point of failure.
    const result = sanitizeCommandOutput('<script>alert("x")</script>');

    expect(result.text).toBe('<script>alert("x")</script>');
  });
});

describe("empty output", () => {
  it("handles an empty string", () => {
    expect(sanitizeCommandOutput("")).toEqual({ text: "", truncated: false });
  });
});
