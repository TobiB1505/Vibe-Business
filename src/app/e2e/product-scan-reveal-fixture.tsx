"use client";

import { useEffect, useState } from "react";
import { ProductScanExperience } from "@/components/product-scan/product-scan-experience";
import type { OperationView } from "@/modules/operations/view";
import type { ProductScanPresentation } from "@/modules/product-scan/presentation";
import type { ProductScanEvent } from "@/modules/product-scan/schema";

export function ProductScanRevealFixture({
  operation,
  events,
  presentation,
  /**
   * Where it is being drawn. `block` is Nova's thread, and the reveal is the
   * whole reason it is worth showing there: the scan plays and then settles
   * into its own finished state, which is what a founder watching a run sees.
   */
  variant = "workspace",
}: {
  operation: OperationView;
  events: readonly ProductScanEvent[];
  presentation: ProductScanPresentation;
  variant?: "workspace" | "block";
}) {
  const [visibleCount, setVisibleCount] = useState(1);

  useEffect(() => {
    let intervalId: number | null = null;
    const startId = window.setTimeout(() => {
      intervalId = window.setInterval(() => {
        setVisibleCount((current) => {
          if (current >= events.length) {
            if (intervalId !== null) window.clearInterval(intervalId);
            return current;
          }
          return current + 1;
        });
      }, 120);
    }, 650);

    return () => {
      window.clearTimeout(startId);
      if (intervalId !== null) window.clearInterval(intervalId);
    };
  }, [events.length]);

  return (
    <ProductScanExperience
      projectId="project_e2e"
      productName={presentation.name}
      variant={variant}
      initialOperation={operation}
      initialEvents={events.slice(0, visibleCount)}
      initialPresentation={presentation}
      hasProfile
      canStart
    />
  );
}
