import Link from "next/link";
import type { ReactNode } from "react";

const TABS = [
  { href: "/settings/keys", label: "API keys" },
  { href: "/settings/voice", label: "Channel voice" },
];

/** Settings sections. */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-6">
      <nav
        className="mx-auto flex max-w-3xl gap-1 border-b border-line text-sm font-medium"
        aria-label="Settings"
      >
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="-mb-px border-b-2 border-transparent px-3 py-2 text-ink-soft hover:border-line hover:text-ink"
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
