import { describe, expect, it, beforeEach } from "vitest";
import { __resetGithubEnvCacheForTests, getGithubEnv } from "./github";

const validSource = {
  GITHUB_APP_ID: "123456",
  GITHUB_APP_SLUG: "vibe-business-dev",
  GITHUB_APP_CLIENT_ID: "Iv1.abc123",
  GITHUB_APP_CLIENT_SECRET: "client-secret-value",
  GITHUB_APP_PRIVATE_KEY: "-----BEGIN RSA PRIVATE KEY-----\\nabc123\\n-----END RSA PRIVATE KEY-----",
};

describe("getGithubEnv", () => {
  beforeEach(() => {
    __resetGithubEnvCacheForTests();
  });

  it("returns parsed values when configuration is valid", () => {
    const env = getGithubEnv(validSource);
    expect(env.GITHUB_APP_ID).toBe("123456");
    expect(env.GITHUB_APP_SLUG).toBe("vibe-business-dev");
  });

  it("converts literal \\n escape sequences in the private key to real newlines", () => {
    const env = getGithubEnv(validSource);
    expect(env.GITHUB_APP_PRIVATE_KEY).toBe(
      "-----BEGIN RSA PRIVATE KEY-----\nabc123\n-----END RSA PRIVATE KEY-----",
    );
  });

  it("leaves a private key with real newlines unchanged", () => {
    const env = getGithubEnv({
      ...validSource,
      GITHUB_APP_PRIVATE_KEY: "-----BEGIN RSA PRIVATE KEY-----\nabc123\n-----END RSA PRIVATE KEY-----",
    });
    expect(env.GITHUB_APP_PRIVATE_KEY).toBe(
      "-----BEGIN RSA PRIVATE KEY-----\nabc123\n-----END RSA PRIVATE KEY-----",
    );
  });

  it("throws a descriptive error when a required variable is missing", () => {
    expect(() =>
      getGithubEnv({ ...validSource, GITHUB_APP_ID: undefined }),
    ).toThrow(/GITHUB_APP_ID/);
  });

  it("throws a descriptive error when the private key does not look like a PEM key", () => {
    expect(() =>
      getGithubEnv({ ...validSource, GITHUB_APP_PRIVATE_KEY: "not-a-key" }),
    ).toThrow(/PEM private key/);
  });

  /**
   * The regression this exists for, from a real local setup: a multiline PEM
   * pasted into `.env.local` without surrounding quotes. The env parser keeps
   * only the first line, the BEGIN check passes on it, and the failure surfaces
   * much later as an unexplained "GitHub access unavailable" on the project
   * screen. Validation has to reject it here, where the message can name the
   * cause.
   */
  it("rejects a private key truncated to its BEGIN line", () => {
    expect(() =>
      getGithubEnv({
        ...validSource,
        GITHUB_APP_PRIVATE_KEY: "-----BEGIN RSA PRIVATE KEY-----",
      }),
    ).toThrow(/truncated/);
  });

  it("tells the reader how to store a multiline PEM correctly", () => {
    // An error that only says "invalid" leaves the same person stuck. The
    // message has to carry the fix, because the mistake is in a file the
    // application cannot see.
    expect(() =>
      getGithubEnv({
        ...validSource,
        GITHUB_APP_PRIVATE_KEY: "-----BEGIN RSA PRIVATE KEY-----",
      }),
    ).toThrow(/double quotes/);
  });

  it("accepts a key whose END line names a different key type", () => {
    // PKCS#8 keys say "BEGIN PRIVATE KEY", PKCS#1 "BEGIN RSA PRIVATE KEY".
    // Both are legitimate; the check is for a footer, not for one algorithm.
    const env = getGithubEnv({
      ...validSource,
      GITHUB_APP_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----",
    });
    expect(env.GITHUB_APP_PRIVATE_KEY).toContain("END PRIVATE KEY");
  });

  it("caches the result across calls", () => {
    const first = getGithubEnv(validSource);
    const second = getGithubEnv({ ...validSource, GITHUB_APP_ID: "other" });
    expect(second).toBe(first);
  });
});
