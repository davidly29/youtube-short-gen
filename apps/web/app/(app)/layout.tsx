import { Coins, FolderOpen, ImageIcon, KeyRound, Plus } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { SignOutButton } from "../../src/components/sign-out";
import { requireUser } from "../../src/server/auth";
import { credits } from "../../src/server/projects";

export const dynamic = "force-dynamic";

const NAV = [
  { href: "/projects", label: "Projects", icon: FolderOpen },
  { href: "/library", label: "Library", icon: ImageIcon },
  { href: "/settings/keys", label: "API keys", icon: KeyRound },
];

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const balance = await credits(user.id);
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-line bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-6">
          <Link href="/projects" className="font-bold tracking-tight">
            Short<span className="text-brand">Loop</span>
          </Link>
          <nav className="flex items-center gap-1 text-sm font-medium">
            {NAV.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-ink-soft hover:bg-paper hover:text-ink"
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span
              data-testid="credits"
              className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1 text-xs font-semibold text-brand-deep"
              title="Short credits"
            >
              <Coins className="size-3.5" aria-hidden />
              {balance.shorts} Shorts left
            </span>
            <Link
              href="/new"
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-deep"
            >
              <Plus className="size-4" aria-hidden /> New Short
            </Link>
            <SignOutButton email={user.email} />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
