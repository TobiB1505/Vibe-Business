import { describe, expect, it } from "vitest";

import { formatSchemaMetrics, measureSchema } from "./schema-metrics";

describe("measureSchema", () => {
  it("counts objects, properties, required-ness, arrays, enums and unions", () => {
    const metrics = measureSchema({
      type: "object",
      properties: {
        status: { type: "string", enum: ["a", "b", "c"] },
        score: { anyOf: [{ type: "integer" }, { type: "null" }] },
        notes: { type: "array", items: { type: "string" } },
        nested: {
          type: "object",
          properties: { deep: { type: "string" } },
          required: ["deep"],
          additionalProperties: false,
        },
      },
      // `notes` deliberately omitted from required.
      required: ["status", "score", "nested"],
      additionalProperties: false,
    });

    expect(metrics.objectCount).toBe(2);
    expect(metrics.propertyCount).toBe(5);
    expect(metrics.optionalPropertyCount).toBe(1);
    expect(metrics.arrayCount).toBe(1);
    expect(metrics.enumCount).toBe(1);
    expect(metrics.enumMemberCount).toBe(3);
    expect(metrics.unionCount).toBe(1);
    expect(metrics.unionMemberCount).toBe(2);
    expect(metrics.objectsMissingAdditionalPropertiesFalse).toBe(0);
  });

  it("measures depth through arrays of objects", () => {
    const metrics = measureSchema({
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { tags: { type: "array", items: { type: "string" } } },
            required: ["tags"],
            additionalProperties: false,
          },
        },
      },
      required: ["items"],
      additionalProperties: false,
    });

    // root → items → item object → tags → string
    expect(metrics.maxDepth).toBe(5);
    expect(metrics.arrayCount).toBe(2);
  });

  it("flags an object that omits additionalProperties: false", () => {
    const metrics = measureSchema({ type: "object", properties: { a: { type: "string" } } });
    expect(metrics.objectsMissingAdditionalPropertiesFalse).toBe(1);
  });

  it("reports byte size of the serialized schema", () => {
    const schema = { type: "object", properties: {}, required: [], additionalProperties: false };
    expect(measureSchema(schema).byteSize).toBe(Buffer.byteLength(JSON.stringify(schema), "utf8"));
  });

  it("renders a one-line summary", () => {
    const line = formatSchemaMetrics(measureSchema({ type: "object", properties: {} }));
    expect(line).toContain("objects");
    expect(line).toContain("depth");
  });
});
