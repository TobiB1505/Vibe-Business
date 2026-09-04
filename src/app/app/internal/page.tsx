import { notFound } from "next/navigation";
import { loadConsoleSnapshot } from "@/modules/internal-console/service";
import { OperatorConsole } from "./console";

/**
 * The internal operator console ([ADR 0084](../../../../docs/decisions/0084-the-internal-operator-console.md)).
 *
 * ## Why `notFound()` rather than a refusal
 *
 * A 403 tells whoever asked that the route exists and that they are simply not
 * allowed in. For a surface that reads every tenant's rows, the existence of
 * the door is itself worth not confirming.
 *
 * ## Why this renders nothing dynamic itself
 *
 * The page hands the client one snapshot and steps out of the way. Everything
 * after that is the client polling `refreshConsoleAction`, which re-checks the
 * allowlist on every call — so authorization is never something this render
 * granted once.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Internal console",
  robots: { index: false, follow: false },
};

export default async function InternalConsolePage() {
  const access = await loadConsoleSnapshot("24h");
  if (!access.ok) notFound();

  return <OperatorConsole initial={access.snapshot} />;
}
