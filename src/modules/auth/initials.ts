/**
 * Two characters where a label has two parts, otherwise the first two of its
 * single token. Pure and client-safe: product tiles and account identity both
 * use this without pulling server-only GitHub access into a browser bundle.
 */
export function initialsFrom(label: string): string {
  const parts = label
    .split(/[^\p{L}\p{N}]+/u)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();

  return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
}
