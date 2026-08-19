import type { Metadata } from "next";
import type { ReactNode } from "react";
import { requireSession } from "@/modules/auth/session";

/**
 * Auth gate for every page under /app (Sprint 1 §2). Route Handlers and
 * Server Actions under this same path segment do NOT inherit this layout
 * — they call requireSession() themselves. See
 * src/modules/auth/session.ts.
 */

// Every route under /app requires a session (see requireSession() above), so
// none of it belongs in a search index. Overrides the root layout's indexable
// default for this whole subtree.
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default async function AppLayout({ children }: { children: ReactNode }) {
  await requireSession();
  return children;
}
