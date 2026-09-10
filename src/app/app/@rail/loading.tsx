import { RailSkeleton } from "@/components/layout/app-frame";

/**
 * The boundary the rail was missing (UI-14).
 *
 * Without one, the slot's reads had no Suspense boundary of their own and the
 * nearest ancestor was the `/app` layout, which has none either — so the
 * router could not commit *any* navigation under `/app` until the rail's
 * queries came back. Every click in the product waited on the chrome beside
 * the thing being navigated to, which is exactly what "it does not feel
 * fluid" describes.
 *
 * It is reached only on an area change now, because each area's navigation is
 * a layout and a layout is preserved while its segment holds. A route with no
 * rail at all — onboarding, the connect flow — renders `default.tsx`, which is
 * synchronous, suspends nothing, and never sees this.
 */
export default function RailLoading() {
  return <RailSkeleton />;
}
