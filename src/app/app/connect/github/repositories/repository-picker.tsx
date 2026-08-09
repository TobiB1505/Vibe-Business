"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import type { RepositorySummary } from "@/modules/github/types";
import { selectRepository, type SelectRepositoryResult } from "./actions";

const initialState: SelectRepositoryResult | null = null;

export function RepositoryPicker({
  repositories,
  installationRowId,
}: {
  repositories: RepositorySummary[];
  installationRowId: string;
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
          className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-50 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
        />
      )}

      <ul className="divide-y divide-zinc-800 overflow-hidden rounded-md border border-zinc-800">
        {filtered.map((repo) => (
          <li key={repo.githubRepositoryId}>
            <label className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-zinc-900">
              <input
                type="radio"
                name="githubRepositoryId"
                value={repo.githubRepositoryId}
                checked={selectedId === repo.githubRepositoryId}
                onChange={() => setSelectedId(repo.githubRepositoryId)}
                className="shrink-0"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-zinc-50">{repo.fullName}</span>
                <span className="block text-xs text-zinc-500">
                  {repo.private ? "Private" : "Public"} · default branch {repo.defaultBranch}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>

      {filtered.length === 0 && <p className="text-sm text-zinc-500">No repositories match your search.</p>}

      {state && !state.ok && <p className="text-sm text-red-400">{state.error}</p>}

      <div>
        <Button type="submit" disabled={pending || selectedId === null}>
          {pending ? "Connecting…" : "Connect repository"}
        </Button>
      </div>
    </form>
  );
}
