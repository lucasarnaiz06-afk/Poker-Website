import type { ReactNode } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui";

/** One settings block: titled card. */
export function Section({
  title,
  description,
  actions,
  children,
  tone,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  tone?: "danger";
}) {
  return (
    <Card as="section" className={tone === "danger" ? "border-danger/40" : undefined}>
      <CardHeader title={title} description={description} actions={actions} />
      <CardBody>{children}</CardBody>
    </Card>
  );
}
