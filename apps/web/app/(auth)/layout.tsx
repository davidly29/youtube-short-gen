import Link from "next/link";
import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
      <Link href="/" className="mb-8 text-lg font-bold tracking-tight">
        Short<span className="text-brand">Loop</span>
      </Link>
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
