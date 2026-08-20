"use client";

import AppError from "@/app/app/error";

/**
 * The signed-in error boundary, rendered for the browser suite.
 *
 * A client wrapper exists for one reason: `error.tsx` takes a `reset` callback,
 * and a server component cannot pass a function to a client component. The
 * `reset` here is a no-op — the suite asserts the control is a real, reachable
 * button, not what Next.js does when it fires, which is Next's behaviour rather
 * than this product's.
 *
 * The component under test is the **actual** `src/app/app/error.tsx`, imported
 * rather than reimplemented, so a change to the screen changes what the browser
 * sees instead of leaving a fixture behind.
 */
export function AppErrorPreview({ digest }: { digest?: string }) {
  const error = Object.assign(
    // The real shape: a PostgREST failure that escaped a Server Component. The
    // message is deliberately the raw one, because the load-bearing assertion
    // is that the screen does **not** show it.
    new Error('{"code":"PGRST303","details":null,"hint":null,"message":"JWT issued at future"}'),
    digest ? { digest } : {},
  );

  return <AppError error={error} reset={() => {}} />;
}
