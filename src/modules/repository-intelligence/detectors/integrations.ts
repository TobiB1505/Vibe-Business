import { hasNodeDependency, nodeDependencySource, textManifestMentions, type DetectionContext } from "../context";
import type { Evidence, IntegrationSignal, SignalCategory } from "../schema";

/**
 * Infrastructure / integration signal detection (Sprint 2 §13).
 *
 * These are deliberately *signals*, not configuration claims. A Stripe
 * dependency proves the SDK is installed — it does not prove payments
 * are live, keys are set, or checkout works. The schema type is named
 * IntegrationSignal and the UI phrases it as "detected integration
 * signal" for exactly that reason.
 */

type SignalRule = {
  id: string;
  name: string;
  category: SignalCategory;
  /** Node dependency names, any of which is strong evidence. */
  dependencies?: string[];
  /** Config-file basenames (regex on basename) that corroborate. */
  configPattern?: RegExp;
  /** Exact repository paths that corroborate. */
  paths?: string[];
  /** Lowercase token searched for in non-Node dependency manifests. */
  manifestToken?: string;
  /**
   * Anchored regex matched against a whole repository path, for signals that
   * live in a directory rather than under a fixed basename. `.github/workflows`
   * holds arbitrarily named files, so no basename rule can see it.
   *
   * Every pattern here must be anchored at both ends and must not let `/` into
   * a segment wildcard, for the same reason `path-policy.ts` matches segments
   * rather than substrings.
   */
  pathPattern?: RegExp;
};

/**
 * How many paths one `pathPattern` rule contributes as evidence.
 *
 * A repository with thirty workflow files should not put thirty rows into a
 * snapshot that is stored, rendered and handed to a model. Three is enough to
 * show a reader where to look; the signal is "GitHub Actions is used here", and
 * that is fully carried by the first match.
 */
const MAX_PATH_EVIDENCE = 3;

const SIGNAL_RULES: SignalRule[] = [
  // Deployment / hosting
  { id: "vercel", name: "Vercel", category: "deployment", configPattern: /^vercel\.json$/i, dependencies: ["@vercel/analytics", "@vercel/speed-insights"] },
  { id: "netlify", name: "Netlify", category: "deployment", configPattern: /^netlify\.toml$/i },
  { id: "render", name: "Render", category: "deployment", configPattern: /^render\.yaml$/i },
  { id: "railway", name: "Railway", category: "deployment", configPattern: /^railway\.(json|toml)$/i },
  { id: "flyio", name: "Fly.io", category: "deployment", configPattern: /^fly\.toml$/i },
  { id: "docker", name: "Docker", category: "deployment", configPattern: /^(dockerfile|docker-compose(\.[\w-]+)?\.(yml|yaml))$/i },
  { id: "heroku", name: "Heroku", category: "deployment", configPattern: /^procfile$/i },

  // Database / backend
  { id: "supabase", name: "Supabase", category: "database", dependencies: ["@supabase/supabase-js", "@supabase/ssr"], paths: ["supabase/config.toml"] },
  { id: "firebase", name: "Firebase", category: "database", dependencies: ["firebase", "firebase-admin"] },
  { id: "prisma", name: "Prisma", category: "database", dependencies: ["prisma", "@prisma/client"], paths: ["prisma/schema.prisma"] },
  { id: "drizzle", name: "Drizzle", category: "database", dependencies: ["drizzle-orm"], configPattern: /^drizzle\.config\./i },
  { id: "postgres", name: "PostgreSQL", category: "database", dependencies: ["pg", "postgres"], manifestToken: "psycopg" },
  { id: "mongodb", name: "MongoDB", category: "database", dependencies: ["mongodb", "mongoose"] },
  { id: "sqlite", name: "SQLite", category: "database", dependencies: ["better-sqlite3", "sqlite3"] },

  // Auth
  // `@supabase/ssr` exists specifically to manage Supabase Auth sessions
  // via cookies, so it is direct evidence of Supabase Auth — not merely
  // of the Supabase client.
  { id: "supabase_auth", name: "Supabase Auth", category: "auth", dependencies: ["@supabase/ssr", "@supabase/auth-helpers-nextjs", "@supabase/auth-ui-react"] },
  { id: "clerk", name: "Clerk", category: "auth", dependencies: ["@clerk/nextjs", "@clerk/clerk-react", "@clerk/backend"] },
  { id: "authjs", name: "Auth.js / NextAuth", category: "auth", dependencies: ["next-auth", "@auth/core"] },
  { id: "firebase_auth", name: "Firebase Auth", category: "auth", dependencies: ["@firebase/auth"] },
  { id: "lucia", name: "Lucia", category: "auth", dependencies: ["lucia"] },

  // Payments
  { id: "stripe", name: "Stripe", category: "payments", dependencies: ["stripe", "@stripe/stripe-js", "@stripe/react-stripe-js"], manifestToken: "stripe" },
  { id: "paddle", name: "Paddle", category: "payments", dependencies: ["@paddle/paddle-js", "@paddle/paddle-node-sdk"] },
  { id: "lemonsqueezy", name: "Lemon Squeezy", category: "payments", dependencies: ["@lemonsqueezy/lemonsqueezy.js"] },

  // Analytics
  { id: "posthog", name: "PostHog", category: "analytics", dependencies: ["posthog-js", "posthog-node"] },
  { id: "plausible", name: "Plausible", category: "analytics", dependencies: ["next-plausible", "plausible-tracker"] },
  { id: "google_analytics", name: "Google Analytics", category: "analytics", dependencies: ["react-ga4", "@next/third-parties"] },
  { id: "vercel_analytics", name: "Vercel Analytics", category: "analytics", dependencies: ["@vercel/analytics"] },

  // Test tooling — what execution needs to know before it spends money on a
  // change nothing can verify (rule 78).
  { id: "vitest", name: "Vitest", category: "testing", dependencies: ["vitest", "@vitest/coverage-v8"], configPattern: /^vitest\.config\./i },
  { id: "jest", name: "Jest", category: "testing", dependencies: ["jest", "ts-jest", "@jest/globals", "babel-jest"], configPattern: /^jest\.config\./i },
  { id: "playwright", name: "Playwright", category: "testing", dependencies: ["@playwright/test"], configPattern: /^playwright\.config\./i },
  { id: "cypress", name: "Cypress", category: "testing", dependencies: ["cypress"], configPattern: /^cypress\.config\./i },
  { id: "mocha", name: "Mocha", category: "testing", dependencies: ["mocha"], configPattern: /^\.mocharc\./i },
  { id: "jasmine", name: "Jasmine", category: "testing", dependencies: ["jasmine", "jasmine-core"] },
  { id: "ava", name: "AVA", category: "testing", dependencies: ["ava"] },
  { id: "karma", name: "Karma", category: "testing", dependencies: ["karma"], configPattern: /^karma\.conf\./i },
  { id: "testing_library", name: "Testing Library", category: "testing", dependencies: ["@testing-library/react", "@testing-library/dom", "@testing-library/vue", "@testing-library/svelte", "@testing-library/angular"] },
  { id: "pytest", name: "pytest", category: "testing", manifestToken: "pytest" },
  { id: "rspec", name: "RSpec", category: "testing", manifestToken: "rspec" },

  // Continuous integration.
  //
  // Existence only, deliberately. Saying *which* workflows run on a push to the
  // default branch — the fact rule 74 wants said before a merge click — needs
  // the `on:` block, which needs a YAML parser this repository does not have and
  // will not gain without its own decision. A count of workflow files is a fact;
  // "this will deploy your site" would be a guess dressed as one.
  { id: "github_actions", name: "GitHub Actions", category: "ci", pathPattern: /^\.github\/workflows\/[^/]+\.ya?ml$/i },
  { id: "gitlab_ci", name: "GitLab CI", category: "ci", configPattern: /^\.gitlab-ci\.ya?ml$/i },
  { id: "circleci", name: "CircleCI", category: "ci", pathPattern: /^\.circleci\/config\.ya?ml$/i },
  { id: "jenkins", name: "Jenkins", category: "ci", configPattern: /^jenkinsfile$/i },
  { id: "azure_pipelines", name: "Azure Pipelines", category: "ci", configPattern: /^azure-pipelines\.ya?ml$/i },
  { id: "travis_ci", name: "Travis CI", category: "ci", configPattern: /^\.travis\.ya?ml$/i },
  { id: "bitbucket_pipelines", name: "Bitbucket Pipelines", category: "ci", configPattern: /^bitbucket-pipelines\.ya?ml$/i },
  { id: "drone_ci", name: "Drone CI", category: "ci", configPattern: /^\.drone\.ya?ml$/i },
  { id: "woodpecker_ci", name: "Woodpecker CI", category: "ci", configPattern: /^\.woodpecker\.ya?ml$/i },

  // E-mail sending
  { id: "resend", name: "Resend", category: "email", dependencies: ["resend"] },
  { id: "sendgrid", name: "SendGrid", category: "email", dependencies: ["@sendgrid/mail", "@sendgrid/client"], manifestToken: "sendgrid" },
  { id: "nodemailer", name: "Nodemailer", category: "email", dependencies: ["nodemailer"] },
  { id: "postmark", name: "Postmark", category: "email", dependencies: ["postmark"] },
  { id: "mailgun", name: "Mailgun", category: "email", dependencies: ["mailgun.js", "mailgun-js"] },
  { id: "amazon_ses", name: "Amazon SES", category: "email", dependencies: ["@aws-sdk/client-ses", "@aws-sdk/client-sesv2"] },
  { id: "react_email", name: "React Email", category: "email", dependencies: ["react-email", "@react-email/components"] },

  // Feature flagging
  { id: "launchdarkly", name: "LaunchDarkly", category: "feature_flags", dependencies: ["launchdarkly-js-client-sdk", "launchdarkly-node-server-sdk", "@launchdarkly/node-server-sdk"] },
  { id: "vercel_flags", name: "Vercel Flags", category: "feature_flags", dependencies: ["flags", "@vercel/flags"] },
  { id: "flagsmith", name: "Flagsmith", category: "feature_flags", dependencies: ["flagsmith", "flagsmith-nodejs"] },
  { id: "unleash", name: "Unleash", category: "feature_flags", dependencies: ["unleash-client", "@unleash/proxy-client-react"] },
  { id: "statsig", name: "Statsig", category: "feature_flags", dependencies: ["statsig-js", "statsig-node"] },
  { id: "split_io", name: "Split", category: "feature_flags", dependencies: ["@splitsoftware/splitio", "@splitsoftware/splitio-react"] },
  { id: "configcat", name: "ConfigCat", category: "feature_flags", dependencies: ["configcat-js", "configcat-node"] },
  { id: "growthbook", name: "GrowthBook", category: "feature_flags", dependencies: ["@growthbook/growthbook", "@growthbook/growthbook-react"] },

  // Monitoring
  { id: "sentry", name: "Sentry", category: "monitoring", dependencies: ["@sentry/nextjs", "@sentry/node", "@sentry/react", "@sentry/browser"], manifestToken: "sentry-sdk" },
];

/**
 * What each integration id is a signal *of*.
 *
 * Derived from the catalogue above rather than written a second time. The
 * consumer that needs it is the execution risk gate, which must refuse a step
 * citing `repo.integration.stripe` as payment work — and a hand-kept copy of
 * this list would mean the next payments provider added above silently arrives
 * unclassified, which is the one direction that failure must never run.
 */
export const INTEGRATION_CATEGORY_BY_ID: Readonly<Record<string, SignalCategory>> =
  Object.freeze(
    Object.fromEntries(SIGNAL_RULES.map((rule) => [rule.id, rule.category])),
  );

function evidence(kind: Evidence["kind"], path: string, detail?: string): Evidence {
  return detail === undefined ? { kind, path } : { kind, path, detail };
}

export function detectIntegrationSignals(context: DetectionContext): IntegrationSignal[] {
  const signals: IntegrationSignal[] = [];

  for (const rule of SIGNAL_RULES) {
    const items: Evidence[] = [];

    for (const dependency of rule.dependencies ?? []) {
      if (!hasNodeDependency(context, dependency)) continue;
      const path = nodeDependencySource(context, dependency);
      if (path) items.push(evidence("manifest_dependency", path, dependency));
    }
    const hasDependency = items.length > 0;

    let hasConfig = false;
    if (rule.configPattern) {
      const configPath = context.findByBasename(rule.configPattern)[0];
      if (configPath) {
        items.push(evidence("config_file", configPath));
        hasConfig = true;
      }
    }

    for (const path of rule.paths ?? []) {
      if (context.hasPath(path)) {
        items.push(evidence("config_file", path));
        hasConfig = true;
      }
    }

    if (rule.pathPattern) {
      // Sorted so a repository with several matching files always produces the
      // same evidence rows: a snapshot is stored, reused by hash, and compared
      // across runs, so tree order must not decide what it says.
      const matches = context.sourcePaths
        .filter((path) => rule.pathPattern!.test(path))
        .sort()
        .slice(0, MAX_PATH_EVIDENCE);
      for (const path of matches) {
        items.push(evidence("file_path", path));
        hasConfig = true;
      }
    }

    if (rule.manifestToken) {
      const manifestPath = textManifestMentions(context, rule.manifestToken);
      if (manifestPath) items.push(evidence("manifest_dependency", manifestPath, rule.manifestToken));
    }

    if (items.length === 0) continue;

    // A declared dependency is the strongest single signal; a lone config
    // file could be a leftover, so it reads as medium on its own.
    const confidence = hasDependency && hasConfig ? "high" : hasDependency ? "high" : "medium";

    signals.push({ id: rule.id, name: rule.name, category: rule.category, confidence, evidence: items });
  }

  return signals;
}

export function signalsByCategory(
  signals: IntegrationSignal[],
  category: SignalCategory,
): IntegrationSignal[] {
  return signals.filter((signal) => signal.category === category);
}
