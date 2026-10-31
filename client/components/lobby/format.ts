import type { LobbyTableSummary } from "@poker-platform/shared/types";
import { formatChips } from "@/components/ui/chips";

export function formatBlinds(table: Pick<LobbyTableSummary, "smallBlind" | "bigBlind" | "ante">) {
  const blinds = `${formatChips(table.smallBlind, { compact: true })}/${formatChips(table.bigBlind, { compact: true })}`;

  return table.ante ? `${blinds} (${formatChips(table.ante, { compact: true })} ante)` : blinds;
}

export function formatBuyInRange(table: Pick<LobbyTableSummary, "minBuyIn" | "maxBuyIn">) {
  return `${formatChips(table.minBuyIn, { compact: true })} – ${formatChips(table.maxBuyIn, { compact: true })}`;
}

export function formatBuyInBB(table: Pick<LobbyTableSummary, "minBuyIn" | "maxBuyIn" | "bigBlind">) {
  const min = Math.round(table.minBuyIn / table.bigBlind);
  const max = Math.round(table.maxBuyIn / table.bigBlind);

  return `${min}–${max} BB`;
}

export const VARIANT_SHORT: Record<LobbyTableSummary["variant"], string> = { NLHE: "Hold'em", PLO: "Omaha" };
