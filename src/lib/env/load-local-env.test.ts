import { describe, expect, it } from "vitest";
import { applyEnv, parseEnvFile } from "./load-local-env";

describe("parsing plain and quoted values", () => {
  it("parses a bare value", () => {
    expect(parseEnvFile("FOO=bar")).toEqual([{ key: "FOO", value: "bar" }]);
  });

  it("parses a double-quoted value, stripping the quotes", () => {
    expect(parseEnvFile('FOO="bar baz"')).toEqual([{ key: "FOO", value: "bar baz" }]);
  });

  it("parses a single-quoted value", () => {
    expect(parseEnvFile("FOO='bar baz'")).toEqual([{ key: "FOO", value: "bar baz" }]);
  });

  it("parses an empty quoted value", () => {
    expect(parseEnvFile('FOO=""')).toEqual([{ key: "FOO", value: "" }]);
  });

  it("trims a bare value but preserves internal spacing in a quoted one", () => {
    expect(parseEnvFile("FOO=  bar  ")).toEqual([{ key: "FOO", value: "bar" }]);
    expect(parseEnvFile('FOO="  bar  "')).toEqual([{ key: "FOO", value: "  bar  " }]);
  });

  it("skips comments and blank lines", () => {
    expect(parseEnvFile("# a comment\n\nFOO=bar\n  # indented comment\n")).toEqual([
      { key: "FOO", value: "bar" },
    ]);
  });

  it("skips a line with no key", () => {
    expect(parseEnvFile("=bar\nFOO=baz")).toEqual([{ key: "FOO", value: "baz" }]);
  });

  it("does not interpret \\\\n escapes inside a value", () => {
    // github.ts does this conversion itself; unescaping here would double it.
    expect(parseEnvFile('FOO="line1\\nline2"')).toEqual([{ key: "FOO", value: "line1\\nline2" }]);
  });
});

/**
 * The second production failure. A value opened with a quote and containing
 * real newlines — the shape `docs/setup/github-app.md` shows as valid for a
 * pasted PEM — was truncated to its first line by a version that split the
 * whole file on `\n` before parsing anything.
 */
describe("multiline quoted values", () => {
  const pem =
    'GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n' +
    "MIIEowIBAAKCAQEA...\n" +
    '-----END RSA PRIVATE KEY-----"\n' +
    "NEXT_STEP=value";

  it("captures every line up to the closing quote", () => {
    const parsed = parseEnvFile(pem);

    expect(parsed).toEqual([
      {
        key: "GITHUB_APP_PRIVATE_KEY",
        value: "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----",
      },
      { key: "NEXT_STEP", value: "value" },
    ]);
  });

  it("keeps parsing after a multiline value ends", () => {
    const parsed = parseEnvFile(pem);
    const next = parsed.find((entry) => entry.key === "NEXT_STEP");

    expect(next?.value).toBe("value");
  });

  it("produces a value that satisfies the PEM shape github.ts checks for", () => {
    const parsed = parseEnvFile(pem);
    const key = parsed.find((entry) => entry.key === "GITHUB_APP_PRIVATE_KEY");

    expect(key?.value).toContain("BEGIN");
    expect(key?.value).toMatch(/END[^\n]*PRIVATE KEY/);
  });

  it("does not lose content when the closing quote never appears", () => {
    // Malformed input should not throw or silently drop the value — it should
    // collect everything so the downstream validator can say what is wrong.
    const parsed = parseEnvFile('FOO="-----BEGIN RSA PRIVATE KEY-----\nMIIEow...');

    expect(parsed[0]?.value).toContain("BEGIN");
    expect(parsed[0]?.value).not.toContain('"');
  });
});

/**
 * The first production failure. A key already present in the environment as
 * an empty string is common — some tooling pre-declares `NEXT_PUBLIC_*` names
 * — and must not silently defeat the file.
 */
describe("applying entries without overwriting a real value", () => {
  it("sets a key that was entirely absent", () => {
    const env: Record<string, string | undefined> = {};
    applyEnv([{ key: "FOO", value: "from-file" }], env);

    expect(env.FOO).toBe("from-file");
  });

  it("overrides a key that was present but empty", () => {
    const env: Record<string, string | undefined> = { FOO: "" };
    applyEnv([{ key: "FOO", value: "from-file" }], env);

    expect(env.FOO).toBe("from-file");
  });

  it("leaves a key with a real value untouched", () => {
    const env: Record<string, string | undefined> = { FOO: "from-shell" };
    applyEnv([{ key: "FOO", value: "from-file" }], env);

    expect(env.FOO).toBe("from-shell");
  });

  it("applies every entry independently", () => {
    const env: Record<string, string | undefined> = { A: "kept", B: "" };
    applyEnv(
      [
        { key: "A", value: "ignored" },
        { key: "B", value: "overwritten" },
        { key: "C", value: "new" },
      ],
      env,
    );

    expect(env).toEqual({ A: "kept", B: "overwritten", C: "new" });
  });
});
