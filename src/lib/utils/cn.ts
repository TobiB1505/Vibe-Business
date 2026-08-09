export type ClassValue = string | number | null | undefined | false;

/** Joins truthy class names with a space. No dependency on clsx/tailwind-merge. */
export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}
