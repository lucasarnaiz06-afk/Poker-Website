import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export type CardProps = HTMLAttributes<HTMLDivElement> & {
  /** "panel" adds the default 20px padding. */
  padded?: boolean;
  /** Element to render (section, article...). */
  as?: "div" | "section" | "article" | "aside";
};

export function Card({ padded = false, as: Tag = "div", className, ...props }: CardProps) {
  return <Tag className={cn("rounded-xl border border-line bg-surface", padded && "p-5", className)} {...props} />;
}

/** A padded Card. */
export function Panel(props: Omit<CardProps, "padded">) {
  return <Card padded {...props} />;
}

export function CardHeader({
  title,
  description,
  actions,
  className,
  titleAs: Title = "h2",
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  titleAs?: "h2" | "h3" | "h4";
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4 border-b border-line px-5 py-4", className)}>
      <div className="min-w-0">
        <Title className="text-[15px] font-semibold text-fg">{title}</Title>
        {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 py-4", className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex items-center justify-end gap-2 border-t border-line px-5 py-3", className)} {...props} />
  );
}
