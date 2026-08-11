/**
 * Structural measurement of a JSON Schema, for grammar-size diagnosis.
 *
 * Anthropic publishes limits on optional parameters and union-typed
 * parameters, but the failure we hit — "the compiled grammar is too large" —
 * comes from an *internal* budget with no published number. Nothing here
 * predicts that budget; these counts exist so a reduction can be reported as
 * a measured before/after instead of an assertion.
 *
 * Pure and dependency-free: safe to unit-test, and used by the dev-only probe
 * as well as by any documentation of a candidate schema.
 */

export type SchemaMetrics = {
  /** Serialized size of the schema as sent on the wire. */
  byteSize: number;
  objectCount: number;
  propertyCount: number;
  /** Properties absent from their object's `required` list. */
  optionalPropertyCount: number;
  arrayCount: number;
  enumCount: number;
  enumMemberCount: number;
  /** `anyOf` / `oneOf` nodes — what the docs call union-typed parameters. */
  unionCount: number;
  unionMemberCount: number;
  maxDepth: number;
  /** Objects missing `additionalProperties: false`, which the subset requires. */
  objectsMissingAdditionalPropertiesFalse: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function measureSchema(schema: unknown): SchemaMetrics {
  const metrics: SchemaMetrics = {
    byteSize: Buffer.byteLength(JSON.stringify(schema) ?? "", "utf8"),
    objectCount: 0,
    propertyCount: 0,
    optionalPropertyCount: 0,
    arrayCount: 0,
    enumCount: 0,
    enumMemberCount: 0,
    unionCount: 0,
    unionMemberCount: 0,
    maxDepth: 0,
    objectsMissingAdditionalPropertiesFalse: 0,
  };

  const visit = (node: unknown, depth: number): void => {
    if (!isRecord(node)) return;
    metrics.maxDepth = Math.max(metrics.maxDepth, depth);

    if (Array.isArray(node.enum)) {
      metrics.enumCount += 1;
      metrics.enumMemberCount += node.enum.length;
    }

    for (const keyword of ["anyOf", "oneOf"] as const) {
      const branches = node[keyword];
      if (Array.isArray(branches)) {
        metrics.unionCount += 1;
        metrics.unionMemberCount += branches.length;
        for (const branch of branches) visit(branch, depth + 1);
      }
    }

    if (node.type === "object" || isRecord(node.properties)) {
      metrics.objectCount += 1;
      if (node.additionalProperties !== false) {
        metrics.objectsMissingAdditionalPropertiesFalse += 1;
      }

      const properties = isRecord(node.properties) ? node.properties : {};
      const required = new Set(
        Array.isArray(node.required) ? node.required.filter((key): key is string => typeof key === "string") : [],
      );

      for (const [name, child] of Object.entries(properties)) {
        metrics.propertyCount += 1;
        if (!required.has(name)) metrics.optionalPropertyCount += 1;
        visit(child, depth + 1);
      }
    }

    if (node.type === "array" || node.items !== undefined) {
      metrics.arrayCount += 1;
      if (Array.isArray(node.items)) {
        for (const item of node.items) visit(item, depth + 1);
      } else {
        visit(node.items, depth + 1);
      }
    }

    for (const container of ["$defs", "definitions"] as const) {
      const defs = node[container];
      if (isRecord(defs)) for (const def of Object.values(defs)) visit(def, depth + 1);
    }
  };

  visit(schema, 1);
  return metrics;
}

/** One-line rendering for probe output and reports. */
export function formatSchemaMetrics(metrics: SchemaMetrics): string {
  return [
    `${metrics.byteSize} B`,
    `${metrics.objectCount} objects`,
    `${metrics.propertyCount} props (${metrics.optionalPropertyCount} optional)`,
    `${metrics.arrayCount} arrays`,
    `${metrics.enumCount} enums/${metrics.enumMemberCount} members`,
    `${metrics.unionCount} unions/${metrics.unionMemberCount} members`,
    `depth ${metrics.maxDepth}`,
  ].join(" · ");
}
