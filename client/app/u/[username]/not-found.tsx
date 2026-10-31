import { UserX } from "lucide-react";
import Link from "next/link";
import { NotFoundState } from "@/components/shell/route-states";
import { Button } from "@/components/ui/button";

export default function PlayerNotFound() {
  return (
    <NotFoundState
      icon={<UserX />}
      title="Player not found"
      description="No one uses that username. It may be mistyped, or the player changed it."
      action={
        <Button asChild>
          <Link href="/leaderboard">Browse the leaderboard</Link>
        </Button>
      }
    />
  );
}
