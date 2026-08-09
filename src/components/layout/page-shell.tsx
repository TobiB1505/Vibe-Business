import type { ReactNode } from "react";

export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-50">
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-16">{children}</div>
    </div>
  );
}
