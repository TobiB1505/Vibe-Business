# Sentry setup

Vibe Business initializes Sentry in the browser, Node.js, and Edge runtimes. The code is safe to build without credentials; event delivery and source-map upload start only after the environment variables below are configured.

## Sentry project

Create or select one Sentry **Next.js** project for Vibe Business. Use the same project DSN for all three runtimes:

- `NEXT_PUBLIC_SENTRY_DSN` — browser DSN (public by design)
- `SENTRY_DSN` — server/Edge DSN; normally the same value
- `NEXT_PUBLIC_SENTRY_ENVIRONMENT` — `development`, `preview`, or `production`

Never put an auth token in a `NEXT_PUBLIC_*` variable.

## Source maps and releases

Production builds need:

- `SENTRY_AUTH_TOKEN` — secret build token with release/source-map permissions
- `SENTRY_ORG` — organization slug
- `SENTRY_PROJECT` — project slug
- `SENTRY_RELEASE` — optional exact release; on Vercel the Git commit SHA is the fallback

Configure these as Vercel Environment Variables. Give `SENTRY_AUTH_TOKEN` only to environments that should upload artifacts. The SDK deletes generated client source maps after an authenticated upload rather than serving them publicly.

## Verification

Verification must exercise the real Next.js application, not a standalone script:

1. Start the application with a real DSN.
2. Add a temporary route that throws a uniquely named error.
3. Request that route through Next.js.
4. Confirm the exact issue and readable source frame in Sentry.
5. Remove the temporary route.

The setup is not considered end-to-end verified until the event is observed in Sentry. See [ADR 0022](../decisions/0022-sentry-observability.md).
