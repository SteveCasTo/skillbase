import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// shadcn's Skeleton primitive, kept local to the private loading surface.
export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("bg-accent animate-pulse rounded-md", className)}
      {...props}
    />
  );
}
