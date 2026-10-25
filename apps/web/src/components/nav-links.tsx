"use client";
import { FolderOpen, ImageIcon, KeyRound, MonitorPlay, ShieldCheck, Sunrise } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "../lib/cn";

const NAV = [
  { href: "/today", label: "Today", icon: Sunrise },
  { href: "/projects", label: "Projects", icon: FolderOpen },
  { href: "/library", label: "Library", icon: ImageIcon },
  { href: "/channels", label: "Channels", icon: MonitorPlay },
  { href: "/settings/keys", label: "API keys", icon: KeyRound },
];

/** Main navigation; the current section is highlighted. */
export function NavLinks({ admin }: { admin: boolean }) {
  const path = usePathname() ?? "";
  const items = admin ? [...NAV, { href: "/admin", label: "Admin", icon: ShieldCheck }] : NAV;
  return (
    <nav className="flex items-center gap-1 overflow-x-auto text-sm font-medium">
      {items.map(({ href, label, icon: Icon }) => {
        const active = path === href || path.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            data-testid={href === "/admin" ? "admin-link" : undefined}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 transition",
              active ? "bg-brand-soft text-brand-deep" : "text-ink-soft hover:bg-paper hover:text-ink",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
