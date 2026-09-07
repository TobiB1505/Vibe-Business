import type { ReactNode } from "react";
import { AppFrame } from "@/components/layout/app-frame";
import { requireSession } from "@/modules/auth/session";

/**
 * Auth gate for every page under /app (Sprint 1 §2), and the frame that holds
 * the product's one navigation rail (UI-13).
 *
 * Route Handlers and Server Actions under this same path segment do NOT
 * inherit this layout — they call requireSession() themselves. See
 * src/modules/auth/session.ts.
 *
 * ## The `rail` slot
 *
 * `@rail` is a parallel route: it matches the same URL this layout is
 * rendering and delivers the navigation for whichever area that URL belongs
 * to. The point is what it does *not* do — the `<aside>` itself is rendered
 * here, once, and stays mounted while a founder moves between a product and
 * Settings. Only its contents change.
 *
 * Nothing is fetched here. Two areas need two different sets of rows and two
 * different reads to produce them; a layout that fetched both would make every
 * route pay for the rail it is not showing. Each `@rail` route loads its own,
 * and `onboarding/` and `connect/github/` load none because their slot is
 * empty — see `app-frame.tsx`.
 */
export default async function AppLayout({
  children,
  rail,
}: {
  children: ReactNode;
  rail: ReactNode;
}) {
  await requireSession();
  return <AppFrame rail={rail}>{children}</AppFrame>;
}
