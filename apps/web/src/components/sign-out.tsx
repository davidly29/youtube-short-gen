"use client";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { authClient } from "../lib/auth-client";

export function SignOutButton({ email }: { email: string }) {
  const router = useRouter();
  return (
    <button
      className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-ink-soft hover:bg-paper hover:text-ink"
      title={`Signed in as ${email}`}
      onClick={async () => {
        await authClient.signOut();
        router.push("/");
        router.refresh();
      }}
    >
      <LogOut className="size-4" aria-hidden />
      <span className="sr-only">Sign out</span>
    </button>
  );
}
