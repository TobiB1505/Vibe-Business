import { Surface } from "@/components/ui/surface";

function Pulse({ className }: { className: string }) {
  return <div className={`bg-surface-hover animate-pulse rounded-nav ${className}`} />;
}

export default function ProductsLoading() {
  return (
    <div className="flex flex-col gap-7" aria-label="Loading products">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="space-y-3">
          <Pulse className="h-9 w-44" />
          <Pulse className="h-4 w-64" />
        </div>
        <div className="flex gap-2">
          <Pulse className="h-11 w-56" />
          <Pulse className="h-11 w-28" />
          <Pulse className="h-11 w-32" />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Surface key={index} level="panel" padding="sm" className="flex min-h-24 items-center gap-4">
            <Pulse className="size-9" />
            <div className="space-y-2">
              <Pulse className="h-5 w-14" />
              <Pulse className="h-3 w-24" />
            </div>
          </Surface>
        ))}
      </div>

      <div className="flex flex-col gap-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Surface key={index} level="panel" padding="md" className="min-h-48">
            <div className="flex gap-4">
              <Pulse className="size-16 shrink-0" />
              <div className="flex-1 space-y-3">
                <Pulse className="h-5 w-48" />
                <Pulse className="h-4 w-2/3" />
                <Pulse className="h-4 w-1/2" />
              </div>
            </div>
          </Surface>
        ))}
      </div>
    </div>
  );
}
