import * as Sentry from "@sentry/nextjs";
import { scrubErrorEvent } from "@/lib/observability/scrub";

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment:
    process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1 : 0.1,
  sendDefaultPii: false,

  // VB-021. `sendDefaultPii: false` stops Sentry *adding* identifying
  // data; it does nothing about what an exception already carries — a URL
  // with a token in it, a Server Action's form payload, a session cookie.
  // This is the boundary that decides what leaves the process, and it
  // fails closed: a scrubbing failure drops the event.
  beforeSend: (event) => scrubErrorEvent(event),
});
