import { ThreadListSkeleton } from "@/features/nova/thread/thread-skeleton";

/** Shown while the conversations index reads this project's threads. */
export default function Loading() {
  return <ThreadListSkeleton />;
}
