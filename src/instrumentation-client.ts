import * as Sentry from "@sentry/nextjs";
import { scrubErrorEvent } from "@/lib/observability/scrub";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,

  // Error monitoring plus Sentry's recommended tracing baseline. Additional
  // signals (Replay, Logs, Profiling, Metrics) require a separate decision.
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1 : 0.1,

  // Browser events may contain useful technical context, but Sentry must not
  // receive user-identifying data merely because the SDK was installed.
  sendDefaultPii: false,

  // VB-021. `sendDefaultPii: false` stops Sentry *adding* identifying
  // data; it does nothing about what an exception already carries — a URL
  // with a token in it, a Server Action's form payload, a session cookie.
  // This is the boundary that decides what leaves the process, and it
  // fails closed: a scrubbing failure drops the event.
  beforeSend: (event) => scrubErrorEvent(event),

  // Third-party noise, not ours to fix. Meta's pixel (ADR 0041) loads
  // `fbevents.js` cross-origin from connect.facebook.net, which itself loads
  // further feature modules under a `signals/` path (VIBE-BUSINESS-PROJECT-4:
  // "getBoundingClientRect is not a function", 206 events, no first-party
  // frames). Cross-origin script errors report opaquely, so these frequently
  // surface with a synthetic `app:///signals/...` path rather than the real
  // origin — matching both forms keeps this scoped to Meta's script rather
  // than silencing errors broadly.
  denyUrls: [/connect\.facebook\.net/, /^app:\/\/\/signals\//],
});

// Required by the App Router so client navigations continue the active trace.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
