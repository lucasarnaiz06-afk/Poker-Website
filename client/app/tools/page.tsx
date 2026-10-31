import type { Metadata } from "next";
import { PageContainer, PageHeader } from "@/components/shell/page";
import { EquityCalculator } from "@/components/tools/equity-calculator";
import { PotOdds } from "@/components/tools/pot-odds";

export const metadata: Metadata = { title: "Poker tools" };

export default function ToolsPage() {
  return (
    <PageContainer width="narrow">
      <PageHeader title="Tools" description="Work out the odds. Calculations run in your browser." />
      <div className="space-y-6">
        <EquityCalculator />
        <PotOdds />
      </div>
    </PageContainer>
  );
}
