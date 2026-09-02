/**
 * The one name a product row is about.
 *
 * Every surface that shows, searches or orders a product must agree on this,
 * or the screen and its controls describe different lists: a founder reading
 * "Payflow" would search for "Payflow" and get nothing back, and a name sort
 * would order rows by a label that is not on screen. Both were true the moment
 * the cards started leading with the derived name.
 *
 * ## Why it lives in a module of its own
 *
 * Because its callers are on both sides of the server boundary. The read model
 * that produces these two fields is `server-only` and reaches Supabase; the
 * search box and the sort control are a client component. Structural typing
 * rather than an import of `DashboardProject` keeps this file free of any
 * import at all, so neither side pulls the other in.
 */
export function productDisplayName(project: {
  /** The label the founder typed at connection time — often a repository slug. */
  name: string;
  /** What Vibe read the product calling itself, when it read one. */
  productName: string | null;
}): string {
  return project.productName ?? project.name;
}
