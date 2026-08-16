import * as Sentry from "@sentry/nextjs";

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
});

// Required by the App Router so client navigations continue the active trace.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
