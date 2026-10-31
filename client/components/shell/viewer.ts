/** What the app shell knows about the signed-in user. Serializable (passed from server to client). */
export type ShellViewer = {
  id: string;
  name: string;
  email: string | null;
  username: string | null;
  avatar: string | null;
  image: string | null;
  /** Wallet balance, or null when unavailable. */
  chipBalance: number | null;
  /** Today's daily bonus when it can still be claimed, else null. */
  dailyBonus: { amount: number; streak: number } | null;
};
