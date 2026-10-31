import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageContainer, PageHeader } from "@/components/shell/page";
import { UiShowcase } from "./showcase";

export const metadata: Metadata = { title: "UI kit", robots: { index: false } };

export default function UiKitPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return (
    <PageContainer>
      <PageHeader title="UI kit" description="Every component in client/components/ui. Development only." />
      <UiShowcase />
    </PageContainer>
  );
}
