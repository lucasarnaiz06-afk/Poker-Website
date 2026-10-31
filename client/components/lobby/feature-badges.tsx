import type { LobbyTableSummary } from "@poker-platform/shared/types";
import { TABLE_FEATURE_DESCRIPTIONS, TABLE_FEATURE_LABELS } from "@poker-platform/shared/lobbies/client";
import { Bomb, Repeat2, Shield, Target, TrendingUp } from "lucide-react";
import type { ReactNode } from "react";
import { Badge, type BadgeTone } from "@/components/ui/badge";

type Feature = LobbyTableSummary["features"][number];

const FEATURE_STYLE: Record<Feature, { tone: BadgeTone; icon: ReactNode }> = {
  BOMB_POT: { tone: "danger", icon: <Bomb aria-hidden /> },
  NIT_GAME: { tone: "info", icon: <Shield aria-hidden /> },
  BOUNTY_GAME: { tone: "gold", icon: <Target aria-hidden /> },
  STRADDLE: { tone: "neutral", icon: <TrendingUp aria-hidden /> },
  RUN_IT_TWICE: { tone: "neutral", icon: <Repeat2 aria-hidden /> },
};

export function FeatureBadge({ feature }: { feature: Feature }) {
  const style = FEATURE_STYLE[feature];

  return (
    <Badge tone={style.tone} icon={style.icon} title={TABLE_FEATURE_DESCRIPTIONS[feature]}>
      {TABLE_FEATURE_LABELS[feature]}
    </Badge>
  );
}

export function FeatureBadges({ features, className }: { features: readonly Feature[]; className?: string }) {
  if (features.length === 0) {
    return null;
  }

  return (
    <ul className={className ?? "flex flex-wrap gap-1"} aria-label="Table features">
      {features.map((feature) => (
        <li key={feature}>
          <FeatureBadge feature={feature} />
        </li>
      ))}
    </ul>
  );
}
