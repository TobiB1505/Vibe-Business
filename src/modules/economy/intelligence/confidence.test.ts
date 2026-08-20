import { describe, expect, it } from "vitest";
import {
  CONFIDENCE_LEVELS,
  capConfidence,
  combineConfidence,
  confidenceFromSampleSize,
  isAtLeast,
  weakestConfidence,
} from "./confidence";

describe("confidence is a weakest link", () => {
  it("reports the weakest axis, not the average", () => {
    // Vibe knows its provider prices exactly and always will. Letting that
    // certainty average away "we have never executed against this project"
    // is the whole failure mode.
    const confidence = combineConfidence({
      historicalData: "none",
      repositorySignal: "high",
      providerPricing: "high",
      sampleSize: 0,
    });

    expect(confidence.overall).toBe("none");
  });

  it("only reaches high when every axis does", () => {
    expect(
      combineConfidence({
        historicalData: "high",
        repositorySignal: "high",
        providerPricing: "high",
        sampleSize: 40,
      }).overall,
    ).toBe("high");

    expect(
      combineConfidence({
        historicalData: "high",
        repositorySignal: "medium",
        providerPricing: "high",
        sampleSize: 40,
      }).overall,
    ).toBe("medium");
  });

  it("treats no evidence at all as none, never high", () => {
    expect(weakestConfidence([])).toBe("high");
    expect(
      combineConfidence({
        historicalData: "none",
        repositorySignal: "none",
        providerPricing: "none",
        sampleSize: 0,
      }).overall,
    ).toBe("none");
  });

  it("carries the sample size, so an answer can name its evidence", () => {
    const confidence = combineConfidence({
      historicalData: "medium",
      repositorySignal: "medium",
      providerPricing: "high",
      sampleSize: 148,
    });

    expect(confidence.sampleSize).toBe(148);
  });
});

describe("sample size buys confidence conservatively", () => {
  it("gives nothing for no observations", () => {
    expect(confidenceFromSampleSize(0)).toBe("none");
  });

  /** Seven runs against one repository is low, and saying so is the point. */
  it("keeps today's dataset at low", () => {
    expect(confidenceFromSampleSize(7)).toBe("low");
  });

  it("climbs with evidence", () => {
    expect(confidenceFromSampleSize(10)).toBe("medium");
    expect(confidenceFromSampleSize(30)).toBe("high");
  });
});

describe("confidence ordering helpers", () => {
  it("orders the levels", () => {
    expect(CONFIDENCE_LEVELS).toEqual(["none", "low", "medium", "high"]);
    expect(isAtLeast("medium", "low")).toBe(true);
    expect(isAtLeast("low", "medium")).toBe(false);
  });

  it("caps a level without ever raising it", () => {
    expect(capConfidence("high", "low")).toBe("low");
    expect(capConfidence("none", "high")).toBe("none");
  });
});
