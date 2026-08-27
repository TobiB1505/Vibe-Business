import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Rule 53, enforced rather than remembered.
 *
 * > The service-role Supabase client is for durable execution only. It bypasses
 * > RLS … and only `src/modules/operations/` may use it.
 *
 * ## Why this test exists
 *
 * Because the rule was documentation-only, and two paths shipped without it.
 * The Core-4 website gate wrote an `ExecutionSpec`, a Credit reservation and an
 * agent run row with the *caller's* cookie-scoped client. All three tables carry
 * a select policy and no write policy, so all three writes were refused by
 * Postgres — one silently, two with `42501`. Nothing failed at build time,
 * nothing failed in CI, and the feature could never work.
 *
 * A grep cannot tell which client a store function was handed. What it can tell
 * — and what the rule is actually about — is **who is allowed to obtain one**.
 * Confining that to one directory is what keeps the blast radius of a mistake to
 * code that was written knowing RLS is off.
 *
 * ## What a failure here means
 *
 * Not "delete the import". It means a write that bypasses RLS is being set up
 * outside the module that owns durable execution, and the choice needs to be
 * either moved there or made deliberately, with an ADR — never resolved by
 * adding an insert policy that hands the same power to a browser holding the
 * public anon key.
 */

const SRC = join(process.cwd(), "src");
const SERVICE_MODULE = "@/lib/supabase/service";

/**
 * Durable execution. Rule 53's named home, and the bulk of the usage: workflow
 * steps run with no user session at all, so there is no other client to use.
 */
const ALLOWED_PREFIX = join("modules", "operations");

/**
 * The sites outside that directory, each reviewed and each documented where it
 * sits.
 *
 * This list is why the test is an allowlist rather than a single prefix check:
 * Rule 53 says "only `src/modules/operations/` may use it", and that has not
 * been literally true since Billing Core-2. Three paths legitimately need a
 * client with no session behind it, and every one of them establishes ownership
 * explicitly instead of relying on RLS.
 *
 * The rule's *substance* is what this file enforces: a service-role client is
 * obtained only at a reviewed site, and every entry below is one somebody
 * argued for. Adding a line here is the review.
 */
const REVIEWED_SITES: readonly { file: string; why: string }[] = [
  {
    file: join("app", "api", "billing", "stripe", "webhook", "route.ts"),
    why: "A Stripe webhook has no session at all — there is no cookie-scoped client to use.",
  },
  {
    file: join("app", "app", "(account)", "billing", "actions.ts"),
    why: "Every billing table has a select policy and no write policy (§64); ownership is session-derived.",
  },
  {
    file: join("app", "app", "connect", "github", "repositories", "actions.ts"),
    why: "The welcome Credit grant writes a billing table; the user id comes from the session, never the client.",
  },
  {
    file: join("modules", "auth", "throttle.ts"),
    why:
      "VB-053 / ADR 0060. record_auth_attempt is no longer callable by anon, because anon is " +
      "anyone holding the publishable key and eight forged failures held a known address out of " +
      "sign-in. The client's entire use is that one RPC — it reads no table, writes no table, and " +
      "auth_attempt_windows has no tenant column for ownership to be re-established on.",
  },
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

/** Files that legitimately name the module without obtaining a client. */
function isDiscussionOnly(source: string): boolean {
  // A probe or a comment may mention it; only an import can use it.
  return !new RegExp(String.raw`^\s*import\s[^;]*${SERVICE_MODULE}`, "m").test(source);
}

describe("only durable execution may obtain a service-role client", () => {
  it("is imported nowhere outside src/modules/operations", () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        if (!source.includes(SERVICE_MODULE)) return false;
        return !isDiscussionOnly(source);
      })
      .map((file) => relative(SRC, file))
      // The client's own definition, the module that owns durable execution,
      // and the individually reviewed sites.
      .filter((file) => file !== join("lib", "supabase", "service.ts"))
      .filter((file) => !file.startsWith(ALLOWED_PREFIX))
      .filter((file) => !REVIEWED_SITES.some((site) => site.file === file));

    expect(
      offenders,
      "a service-role client bypasses RLS — add the site to REVIEWED_SITES with a reason, " +
        "or move the write into src/modules/operations",
    ).toEqual([]);
  });

  /**
   * An allowlist that outlives its entries stops being a review and becomes
   * decoration. A file that no longer obtains the client must leave the list.
   */
  it("names no site that has stopped using it", () => {
    const stale = REVIEWED_SITES.filter(({ file }) => {
      const source = readFileSync(join(SRC, file), "utf8");
      return isDiscussionOnly(source);
    });

    expect(stale.map(({ file }) => file), "remove these from REVIEWED_SITES").toEqual([]);
  });

  /**
   * The complement: the rule is only meaningful while `operations/` actually
   * holds the writes. An empty allowed set would pass the test above while
   * meaning the boundary had been dissolved rather than respected.
   */
  it("is genuinely used inside src/modules/operations", () => {
    const users = sourceFiles(join(SRC, "modules", "operations")).filter((file) =>
      new RegExp(String.raw`^\s*import\s[^;]*${SERVICE_MODULE}`, "m").test(readFileSync(file, "utf8")),
    );

    expect(users.length).toBeGreaterThan(0);
  });
});
