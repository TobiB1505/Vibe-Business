"use client";

import { disconnectProjectAction } from "./actions";
import { TextAction } from "@/components/ui/button";

/** Native `confirm()` — explicit confirmation (Sprint 1 §11) without a new dependency. */
export function DisconnectButton({ projectId }: { projectId: string }) {
  const action = disconnectProjectAction.bind(null, projectId);

  return (
    <form
      action={action}
      onSubmit={(event) => {
        const confirmed = window.confirm(
          "Disconnect this project? Vibe Business will stop tracking this repository. This does not uninstall the GitHub App or change your repository.",
        );
        if (!confirmed) {
          event.preventDefault();
        }
      }}
    >
      <TextAction type="submit" tone="danger" className="text-sm">
        Disconnect project
      </TextAction>
    </form>
  );
}
