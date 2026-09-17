import { ThreadSkeleton } from "@/features/nova/thread/thread-skeleton";

/** Shown while the thread resolves its three reads. */
export default function Loading() {
  return <ThreadSkeleton />;
}
