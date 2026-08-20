import type { Metadata } from "next";
import type { ReactNode } from "react";
import { requireSession } from "@/modules/auth/session";

/**
 * Every page under /app is signed-in only, so none of it should ever reach a
 * search index — overrides the root layout's crawlable default (see
 * src/app/layout.tsx) for this whole subtree. No route beneath this layout
 * sets its own `robots` field, so this is the value every one of them gets.
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
