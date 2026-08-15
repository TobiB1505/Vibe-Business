import type { ReactNode } from "react";

/**
 * The pre-UI-0 page frame.
 *
 * Still used by the project screen and the GitHub connect flow, which have not
 * been migrated yet. Its colours were moved onto the design tokens so those
 * screens sit on the same ground as the migrated ones rather than on a
 * different near-black; their internal styling is still the old `zinc` palette
 * and is migrated per screen, not here.
 *
 * New screens should use `AppShell`, `AuthShell`, `MarketingShell` or
 * `ProjectShell`. This exists to be deleted.
 */
export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="bg-app text-fg-body flex min-h-screen flex-col">
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-16">{children}</div>
    </div>
  );
}
