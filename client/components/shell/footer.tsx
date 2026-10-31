import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-6 text-xs text-subtle sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>Play-money chips only. No real-money gambling.</p>
        <nav aria-label="Footer" className="flex gap-4">
          <Link href="/lobby" className="hover:text-fg">
            Lobby
          </Link>
          <Link href="/leaderboard" className="hover:text-fg">
            Leaderboard
          </Link>
        </nav>
      </div>
    </footer>
  );
}
