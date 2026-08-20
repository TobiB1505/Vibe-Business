"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import type { PickableRepository } from "@/modules/projects/connected-repositories";
import { selectRepository, type SelectRepositoryResult } from "./actions";

const initialState: SelectRepositoryResult | null = null;

export function RepositoryPicker({
  repositories,
  installationRowId,
  canSelect,
}: {
  repositories: PickableRepository[];
  installationRowId: string;
  canSelect: boolean;
}) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [state, formAction, pending] = useActionState(selectRepository, initialState);

  const filtered = repositories.filter((repo) =>
    repo.fullName.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="installationRowId" value={installationRowId} />

      {repositories.length > 5 && (
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search repositories…"
          className="border-line-strong bg-field text-fg-body placeholder:text-fg-meta focus:border-mint/60 focus:ring-mint/10 rounded-md border px-3 py-2 text-sm focus:ring-4 focus:outline-none"
        />
      )}

      <ul className="border-line-2 divide-line-2 overflow-hidden rounded-xl border divide-y">
        {filtered.map((repo) => (
          <li key={repo.githubRepositoryId}>
            {/* Already-connected repositories stay visible but
                unselectable, so it is obvious why they cannot be picked
                again rather than them silently disappearing. */}
            <label
              className={
                repo.alreadyConnected
                  ? "flex items-center gap-3 px-4 py-3 opacity-50"
                  : "hover:bg-surface-hover flex cursor-pointer items-center gap-3 px-4 py-3"
              }
            >
              <input
                type="radio"
                name="githubRepositoryId"
                value={repo.githubRepositoryId}
                checked={selectedId === repo.githubRepositoryId}
                onChange={() => setSelectedId(repo.githubRepositoryId)}
                disabled={repo.alreadyConnected}
                className="shrink-0"
              />
              <span className="min-w-0 flex-1">
                <span className="text-fg-body block truncate text-sm font-medium">{repo.fullName}</span>
                <span className="text-fg-meta block text-xs">
                  {repo.private ? "Private" : "Public"} · default branch {repo.defaultBranch}
                </span>
              </span>
              {repo.alreadyConnected && (
                <span className="text-fg-meta shrink-0 text-xs">Already connected</span>
              )}
            </label>
          </li>
        ))}
      </ul>

      {filtered.length === 0 && <p className="text-fg-meta text-sm">No repositories match your search.</p>}

      {state && !state.ok && <p className="text-coral text-sm">{state.error}</p>}

      <div>
        <Button
          type="submit"
          disabled={pending || selectedId === null || !canSelect}
          busy={pending}
        >
          {pending ? "Connecting…" : "Connect repository"}
        </Button>
      </div>
    </form>
  );
}
