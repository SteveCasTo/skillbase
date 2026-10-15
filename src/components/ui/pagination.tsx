import * as React from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  MoreHorizontalIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { buttonVariants, type Button } from "@/components/ui/button";

// Adapted from @shadcn/pagination (new-york-v4): Spanish labels, touch targets
// and non-actionable disabled links. These primitives also support SSR-only use.
function Pagination({ className, ...props }: React.ComponentProps<"nav">) {
  return (
    <nav
      aria-label="Paginación"
      data-slot="pagination"
      className={cn("mx-auto flex w-full justify-center", className)}
      {...props}
    />
  );
}

function PaginationContent({
  className,
  ...props
}: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="pagination-content"
      className={cn("flex flex-row items-center gap-1", className)}
      {...props}
    />
  );
}

function PaginationItem(props: React.ComponentProps<"li">) {
  return <li data-slot="pagination-item" {...props} />;
}

type PaginationLinkProps = {
  isActive?: boolean;
  disabled?: boolean;
} & Pick<React.ComponentProps<typeof Button>, "size"> &
  React.ComponentProps<"a">;

function PaginationLink({
  className,
  isActive,
  disabled,
  size = "icon",
  href,
  ...props
}: PaginationLinkProps) {
  const classes = cn(
    buttonVariants({ variant: isActive ? "outline" : "ghost", size }),
    "min-h-11 min-w-11 tabular-nums",
    className,
  );
  if (disabled) {
    return (
      <span
        {...props}
        role="link"
        aria-disabled="true"
        data-slot="pagination-link"
        className={cn(classes, "pointer-events-none opacity-50")}
      />
    );
  }
  return (
    <a
      aria-current={isActive ? "page" : undefined}
      data-slot="pagination-link"
      data-active={isActive}
      className={classes}
      href={href}
      {...props}
    />
  );
}

function PaginationPrevious(props: PaginationLinkProps) {
  return (
    <PaginationLink aria-label="Anterior" size="default" {...props}>
      <ChevronLeftIcon aria-hidden="true" data-icon="inline-start" />
      <span className="hidden @[42rem]/pagination:block">Anterior</span>
    </PaginationLink>
  );
}

function PaginationNext(props: PaginationLinkProps) {
  return (
    <PaginationLink aria-label="Siguiente" size="default" {...props}>
      <span className="hidden @[42rem]/pagination:block">Siguiente</span>
      <ChevronRightIcon aria-hidden="true" data-icon="inline-end" />
    </PaginationLink>
  );
}

function PaginationEllipsis({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="pagination-ellipsis"
      className={cn("flex size-11 items-center justify-center", className)}
      {...props}
    >
      <MoreHorizontalIcon aria-hidden="true" className="size-4" />
      <span className="sr-only">Más páginas</span>
    </span>
  );
}

export {
  Pagination,
  PaginationContent,
  PaginationLink,
  PaginationItem,
  PaginationPrevious,
  PaginationNext,
  PaginationEllipsis,
};
