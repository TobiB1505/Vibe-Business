import type { Metadata } from "next";
import type { ReactNode } from "react";
import { requireSession } from "@/modules/auth/session";

/**
 * Every page under /app requires a session and shows account-specific data,
 * so none of it should reach a search index. This replaces the `robots`
 * value the root layout sets for public pages — Next.js merges metadata per
 * top-level field, and no route under here defines its own.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

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
