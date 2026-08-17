# ADR 0022 — Sentry for error monitoring and baseline tracing

**Status:** Accepted
**Date:** 2026-08-16

## Context

`ARCHITECTURE.md` deliberately left the observability provider undecided. Vibe Business now has multiple runtime boundaries — browser, Next.js Node.js, Edge proxy, durable workflow functions, and provider adapters — where a swallowed or uncorrelated exception turns a real production failure into guesswork.

The application is one Next.js/Vercel deployment. Sentry provides one SDK that initializes in all three Next.js runtimes, captures unhandled request and render errors, continues traces across App Router navigation, and uploads source maps from the production build.

Observability data can itself be sensitive. Installing an SDK must not silently authorize broad user-data capture, browser recording, local-variable capture, logs, or AI payload monitoring.

## Decision

Use Sentry through `@sentry/nextjs` as Vibe Business's V0.1 application error-monitoring provider with the SDK's baseline tracing enabled.

- Initialize browser, Node.js, and Edge runtimes separately against the same Sentry project.
- Capture App Router request failures through `onRequestError` and root-boundary failures through `global-error.tsx`.
- Sample traces at 100% in development and 10% elsewhere.
- Set `sendDefaultPii: false` in every runtime. Do not enable local-variable capture.
- Do not enable Session Replay, Logs, Profiling, Metrics, User Feedback, Cron Monitoring, or AI/LLM Monitoring as part of this decision.
- Read DSNs from environment variables. The browser DSN is public by design; the Sentry auth token is a build-only secret.
- Wrap the existing Workflow Next.js configuration with `withSentryConfig`. Authenticated production builds upload source maps, create a release named by `SENTRY_RELEASE` or the Vercel Git commit SHA, and inject that same release into events.
- Builds without `SENTRY_AUTH_TOKEN` explicitly skip source-map upload so tests, local development, and unrelated CI do not require Sentry credentials.

## Consequences

**Good**

- Unhandled failures across all Next.js runtimes arrive in one issue system with correlated traces.
- Production stack traces can resolve to TypeScript source when the build token is configured.
- Releases identify the exact deployed commit, enabling regression tracking.
- The setup is inert when no DSN exists, so local builds and tests remain credential-free.

**Costs and limits**

- Error and trace metadata leaves Vibe Business for Sentry when a DSN is configured.
- Trace sampling creates ingestion volume and cost; 10% is an explicit starting policy, not a permanent entitlement.
- Source-map upload adds production build work and requires a narrowly scoped secret token.
- Sentry is operational telemetry, not the append-only business audit log. It must never replace `audit_events`.
- This ADR does not authorize adding additional Sentry signals or user identity. Those require an explicit privacy/cost decision.

## References

- [ADR 0007 — Postgres append-only audit log](0007-audit-log.md)
- [ADR 0008 — Secrets management](0008-secrets-management.md)
- [Sentry Next.js manual setup](https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/)
