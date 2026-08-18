import { describe, expect, it } from "vitest";
import { agentSubprocessEnv } from "./adapter";

/**
 * The agent subprocess environment (EXECUTION CORE-4 §7, §13, §50).
 *
 * ## Why this is a test and not a comment
 *
 * The Claude Agent SDK's `env` option **replaces** the subprocess environment
 * rather than merging with it — so omitting the option means the subprocess
 * inherits everything this process holds: the Supabase service-role key, the
 * GitHub App private key, the Stripe secret, the Sentry auth token, the
 * Browserbase key.
 *
 * That inheritance would not fail loudly. It would work perfectly, forever,
 * until something in that subprocess did something with one of them. A test is
 * the only thing that notices a default nobody typed.
 *
 * ## Why an allowlist rather than a denylist
 *
 * A denylist has to enumerate every secret this application will ever hold, and
 * gets it wrong the first time somebody adds one. The `EXTRA` fixture below is
 * that argument made concrete: it includes a variable nobody has invented yet.
 */

const REAL_SECRETS = {
  SUPABASE_SERVICE_ROLE_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.service-role",
  GITHUB_APP_PRIVATE_KEY: "-----BEGIN RSA PRIVATE KEY-----\nMIIEow...",
  GITHUB_APP_CLIENT_SECRET: "client-secret",
  STRIPE_SECRET_KEY: "sk_live_realmoney",
  STRIPE_WEBHOOK_SECRET: "whsec_real",
  BROWSERBASE_API_KEY: "bb-real",
  SENTRY_AUTH_TOKEN: "sntrys_real",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  // A secret that does not exist yet. An allowlist excludes it for free; a
  // denylist would have to be edited on the day it is added.
  SOME_FUTURE_PROVIDER_SECRET: "not-invented-yet",
};

describe("§13 — the subprocess receives no secret but its own", () => {
  it("passes through only the allowlisted variables", () => {
    const env = agentSubprocessEnv({
      PATH: "/usr/bin",
      HOME: "/home/vibe",
      ANTHROPIC_API_KEY: "sk-ant-the-agent-needs-this",
      ...REAL_SECRETS,
    });

    // The agent's own credential is present: the subprocess is the thing making
    // the inference call, and it sits inside the trusted boundary.
    expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-the-agent-needs-this");
    expect(env.PATH).toBe("/usr/bin");

    for (const key of Object.keys(REAL_SECRETS)) {
      expect(env, key).not.toHaveProperty(key);
    }
  });

  it("leaks nothing through a value, either", () => {
    const env = agentSubprocessEnv({ PATH: "/usr/bin", ...REAL_SECRETS });
    const serialized = JSON.stringify(env);

    for (const secret of Object.values(REAL_SECRETS)) {
      expect(serialized, secret).not.toContain(secret);
    }
  });

  it("omits an allowlisted variable that is genuinely unset", () => {
    const env = agentSubprocessEnv({ PATH: "/usr/bin" });

    // Present-but-undefined and absent are different things to a subprocess
    // environment, and the second is the honest one.
    expect(env).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(env).not.toHaveProperty("HOME");
  });

  it("marks the run non-interactive and identifies the integration", () => {
    const env = agentSubprocessEnv({ PATH: "/usr/bin" });

    expect(env.CI).toBe("1");
    // A User-Agent marker, not a credential.
    expect(env.CLAUDE_AGENT_SDK_CLIENT_APP).toBe("vibe-business-execution/1");
  });
});
