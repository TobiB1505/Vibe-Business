/**
 * No rail here (UI-13).
 *
 * The slot's fallback for every `/app` route that is not a product workspace
 * or Settings: onboarding, the GitHub connect flow, the internal console and
 * `/app` itself, which resolves a destination and redirects.
 *
 * Returning `null` leaves the `<aside>` in `AppFrame` with no children, and an
 * empty rail is hidden by CSS rather than by a conditional the layout would
 * have to reason its way to. A focused setup flow with a full navigation
 * beside it is an invitation to abandon the flow.
 */
export default function RailDefault() {
  return null;
}
