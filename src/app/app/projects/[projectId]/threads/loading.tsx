import { ThreadSkeleton } from "@/features/nova/thread/thread-skeleton";

/** Shown while `/threads` resolves which thread is open. */
export default function Loading() {
  return <ThreadSkeleton />;
}
