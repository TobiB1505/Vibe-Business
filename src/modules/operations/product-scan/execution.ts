import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { inspectLiveProduct } from "@/modules/live-product-intelligence/service";
import { appendProductScanEvent, appendProductScanEvents } from "@/modules/product-scan/store";
import { liveProductFindingEvents, repositoryFindingEvents } from "@/modules/product-scan/findings";
import { getProfileById } from "@/modules/product-understanding/store";
import { inspectRepository } from "@/modules/repository-intelligence/service";
import type { OperationFailureCode } from "../failures";
import { getProjectOperationRunById, setOperationStage, type ProjectOperationRun } from "../store";
import { completeOperationStep, failOperationStep, type ExecutionDeps, type StepOutcome } from "../product-understanding/execution";

async function loadProductScan(
  supabase: SupabaseClient,
  operationId: string,
): Promise<StepOutcome<{ operation: ProjectOperationRun }>> {
  const operation = await getProjectOperationRunById(supabase, operationId);
  if (!operation || operation.operationType !== "product_scan") {
    return { ok: false, failureCode: "operation_not_found" };
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id, user_id")
    .eq("id", operation.projectId)
    .eq("user_id", operation.userId)
    .maybeSingle();
  if (!project) return { ok: false, failureCode: "project_not_found" };
  return { ok: true, operation };
}

async function append(
  deps: ExecutionDeps,
  operation: ProjectOperationRun,
  event: Parameters<typeof appendProductScanEvent>[1]["event"],
) {
  await appendProductScanEvent(deps.supabase, {
    operationId: operation.id,
    projectId: operation.projectId,
    userId: operation.userId,
    event,
  });
}

/**
 * A run of findings, in one pass (PERF-008).
 *
 * The finding lists below are appended as a group, and appending them one at a
 * time cost four round trips each — up to 96 inside a step, while the browser
 * polls the same operation every 1.8 seconds.
 */
async function appendAll(
  deps: ExecutionDeps,
  operation: ProjectOperationRun,
  events: readonly Parameters<typeof appendProductScanEvent>[1]["event"][],
) {
  await appendProductScanEvents(deps.supabase, {
    operationId: operation.id,
    projectId: operation.projectId,
    userId: operation.userId,
    events,
  });
}

/** A source failure is visible and partial; it is not allowed to erase the other source. */
export async function scanRepositoryStep(
  deps: ExecutionDeps,
  operationId: string,
): Promise<StepOutcome<{ continued: true }>> {
  const loaded = await loadProductScan(deps.supabase, operationId);
  if (!loaded.ok) return loaded;
  const { operation } = loaded;

  await setOperationStage(deps.supabase, { operationId, stage: "reading_code", markRunning: true });
  await append(deps, operation, {
    eventKey: "scan.started",
    type: "scan_started",
    phase: "code",
    source: "system",
    title: "Product Scan started",
    detail: "Vibe is reading the connected sources in a bounded, durable run.",
  });
  await append(deps, operation, {
    eventKey: "repository.started",
    type: "source_started",
    phase: "code",
    source: "repository",
    title: "Reading the connected repository",
  });

  const result = await inspectRepository(
    deps.supabase,
    { projectId: operation.projectId, userId: operation.userId },
    { force: true },
  );

  if (!result.ok) {
    await append(deps, operation, {
      eventKey: "repository.unavailable",
      type: "source_unavailable",
      phase: "code",
      source: "repository",
      findingKey: `repository_failure.${result.error}`,
      title: "Repository could not be refreshed",
      detail: "The scan will continue with any other usable evidence already available.",
    });
    return { ok: true, continued: true };
  }

  await append(deps, operation, {
    eventKey: "repository.ready",
    type: "source_ready",
    phase: "code",
    source: "repository",
    title: "Repository structure mapped",
    detail: result.reused ? "The current repository reading was still current." : "A fresh bounded repository reading completed.",
    referenceId: result.snapshot.id,
  });

  if (result.snapshot.result) {
    await appendAll(deps, operation, repositoryFindingEvents(result.snapshot.result, result.snapshot.id));
  }
  return { ok: true, continued: true };
}

export async function scanLiveProductStep(
  deps: ExecutionDeps,
  operationId: string,
): Promise<StepOutcome<{ continued: true }>> {
  const loaded = await loadProductScan(deps.supabase, operationId);
  if (!loaded.ok) return loaded;
  const { operation } = loaded;

  await setOperationStage(deps.supabase, { operationId, stage: "reading_public_product" });

  const { data: project } = await deps.supabase
    .from("projects")
    .select("id, production_url")
    .eq("id", operation.projectId)
    .eq("user_id", operation.userId)
    .maybeSingle();
  if (!project) return { ok: false, failureCode: "project_not_found" };

  if (!project.production_url) {
    await append(deps, operation, {
      eventKey: "live.unavailable.no_url",
      type: "source_unavailable",
      phase: "public_product",
      source: "live_product",
      findingKey: "live_product.no_url",
      title: "No public product was provided",
      detail: "Vibe will build the product picture from the other connected evidence.",
    });
    return { ok: true, continued: true };
  }

  await append(deps, operation, {
    eventKey: "live.started",
    type: "source_started",
    phase: "public_product",
    source: "live_product",
    title: "Visiting the public product",
  });

  const result = await inspectLiveProduct(
    deps.supabase,
    { projectId: operation.projectId, userId: operation.userId },
    { force: true },
  );
  if (!result.ok) {
    await append(deps, operation, {
      eventKey: "live.unavailable",
      type: "source_unavailable",
      phase: "public_product",
      source: "live_product",
      findingKey: `live_failure.${result.error}`,
      title: "Public product could not be fully read",
      detail: "The repository findings remain available and the scan continues as partial.",
    });
    return { ok: true, continued: true };
  }

  await append(deps, operation, {
    eventKey: "live.ready",
    type: "source_ready",
    phase: "public_product",
    source: "live_product",
    title: "Public product mapped",
    detail: `${result.snapshot.result?.crawl.pagesInspected ?? 0} public pages were inspected within the scan budget.`,
    referenceId: result.snapshot.id,
  });

  if (result.snapshot.result) {
    await appendAll(deps, operation, liveProductFindingEvents(result.snapshot.result, result.snapshot.id));
  }
  return { ok: true, continued: true };
}

export async function recordProfileReadyStep(
  deps: ExecutionDeps,
  operationId: string,
  profileId: string,
): Promise<StepOutcome<{ continued: true }>> {
  const loaded = await loadProductScan(deps.supabase, operationId);
  if (!loaded.ok) return loaded;
  const profile = await getProfileById(deps.supabase, profileId);
  if (!profile || profile.projectId !== loaded.operation.projectId || profile.status !== "completed" || !profile.result) {
    return { ok: false, failureCode: "understanding_failed" };
  }

  await append(deps, loaded.operation, {
    eventKey: "profile.ready",
    type: "profile_ready",
    phase: "understanding",
    source: "product_profile",
    title: "Product picture assembled",
    detail: `${profile.result.capabilities.length} grounded product capabilities are ready to review.`,
    referenceId: profileId,
  });
  return { ok: true, continued: true };
}

export async function completeProductScanStep(
  deps: ExecutionDeps,
  operationId: string,
  profileId: string,
): Promise<void> {
  await completeOperationStep(deps, operationId, profileId);
  const loaded = await loadProductScan(deps.supabase, operationId);
  if (!loaded.ok) return;
  await append(deps, loaded.operation, {
    eventKey: "scan.completed",
    type: "scan_completed",
    phase: "finished",
    source: "system",
    title: "Product Scan complete",
    detail: "The Product Profile and every durable discovery are ready.",
    referenceId: profileId,
  });
}

export async function failProductScanStep(
  deps: ExecutionDeps,
  operationId: string,
  failureCode: OperationFailureCode,
): Promise<void> {
  const loaded = await loadProductScan(deps.supabase, operationId);
  if (loaded.ok) {
    await append(deps, loaded.operation, {
      eventKey: "scan.failed",
      type: "scan_failed",
      phase: "finished",
      source: "system",
      findingKey: `failure.${failureCode}`,
      title: "Product Scan could not finish",
      detail: "Any source readings that completed remain available; no raw source content was stored.",
    });
  }
  await failOperationStep(deps, operationId, failureCode);
}
