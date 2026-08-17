"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { OperationView } from "@/modules/operations/view";
import { getOperationStatusAction } from "../../projects/[projectId]/run-audit-action";

export function OperationWatcher({
  projectId,
  operation,
}: {
  projectId: string;
  operation: OperationView | null;
}) {
  const router = useRouter();
  const operationId = operation?.operationId;
  const shouldPoll = operation?.shouldPoll ?? false;

  useEffect(() => {
    if (!operationId || !shouldPoll) return;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      const result = await getOperationStatusAction(projectId, operationId);
      if (!cancelled && result.ok && !result.operation.shouldPoll) router.refresh();
    }, 2_500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [operationId, projectId, router, shouldPoll]);

  return null;
}
