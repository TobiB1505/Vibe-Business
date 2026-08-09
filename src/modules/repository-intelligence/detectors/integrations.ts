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
};

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

  // Monitoring
  { id: "sentry", name: "Sentry", category: "monitoring", dependencies: ["@sentry/nextjs", "@sentry/node", "@sentry/react", "@sentry/browser"], manifestToken: "sentry-sdk" },
];

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
