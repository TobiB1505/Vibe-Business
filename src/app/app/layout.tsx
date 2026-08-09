import type { ReactNode } from "react";
import { requireSession } from "@/modules/auth/session";

/**
 * Auth gate for every page under /app (Sprint 1 §2). Route Handlers and
 * Server Actions under this same path segment do NOT inherit this layout
 * — they call requireSession() themselves. See
 * src/modules/auth/session.ts.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  await requireSession();
  return children;
}
