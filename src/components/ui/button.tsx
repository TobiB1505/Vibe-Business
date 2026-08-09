import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils/cn";

export const buttonClassName =
  "inline-flex items-center justify-center rounded-md bg-zinc-50 px-5 py-2.5 text-sm font-medium text-zinc-950 transition-colors hover:bg-white disabled:pointer-events-none disabled:opacity-40";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, ...props },
  ref,
) {
  return <button ref={ref} className={cn(buttonClassName, className)} {...props} />;
});
