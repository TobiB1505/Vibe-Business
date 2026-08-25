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
}: {
  operation: OperationView;
  events: readonly ProductScanEvent[];
  presentation: ProductScanPresentation;
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
      variant="workspace"
      initialOperation={operation}
      initialEvents={events.slice(0, visibleCount)}
      initialPresentation={presentation}
      hasProfile
      canStart
    />
  );
}
