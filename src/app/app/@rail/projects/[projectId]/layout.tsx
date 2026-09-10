import type { ReactNode } from "react";
import { RailBrand } from "@/components/layout/app-frame";
import { ProjectRailSlot } from "../../project-rail";
import { RailAccountFooter } from "../../rail-account-footer";

/**
 * The product's rail, as a layout rather than a page (UI-14).
 *
 * ## Why a layout, and why this is the whole fluency fix
 *
 * The rail's first shape was one catch-all page for the whole `/app` subtree,
 * on the reasoning that a route boundary is a remount boundary and one route
 * therefore never remounts. That was true about *mounting* and wrong about
 * everything else: a page is matched per URL, so every click — Nova to Plan,
 * Plan to Agent — refetched the rail's four reads and re-rendered it, and
 * because the slot had no Suspense boundary of its own the router could not
 * commit the navigation until they came back. Every section click in the
 * product waited on the navigation *beside* the thing being navigated to.
 *
 * A layout is matched by its own segment and preserved while that segment
 * holds. `projectId` is the segment, so the rail is fetched once per product
 * and then simply stays: moving between sections re-renders a `null` page
 * underneath it and nothing else. The active row was already derived from
 * `usePathname` on the client, so it keeps up without a server render.
 *
 * `loading.tsx` beside this file is the boundary that was missing. It is
 * reached only when the *area* changes, which is the one moment the rail has
 * genuinely new work to do.
 */
export default async function ProjectRailLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  return (
    <>
      <RailBrand />
      <ProjectRailSlot projectId={projectId} />
      <RailAccountFooter />
      {children}
    </>
  );
}
