import { ArrowRight, Captions, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { getSession } from "../src/server/auth";

export const dynamic = "force-dynamic";

const FEATURES = [
  {
    icon: Sparkles,
    title: "Original scripts",
    body: "Hook-first scripts written for your topic and checked so your channel stays monetisable.",
  },
  {
    icon: Captions,
    title: "Finished in minutes",
    body: "Narration, licensed stock or AI visuals, and animated captions, cut to 9:16 automatically.",
  },
  {
    icon: ShieldCheck,
    title: "Rights-clean",
    body: "Every clip carries its licence. Nothing ships without a rights manifest you can show anyone.",
  },
];

export default async function Home() {
  const session = await getSession();
  return (
    <main className="mx-auto max-w-5xl px-6 py-16 sm:py-24">
      <header className="mb-16 flex items-center justify-between">
        <span className="text-lg font-bold tracking-tight">
          Short<span className="text-brand">Loop</span>
        </span>
        <nav className="flex items-center gap-3 text-sm font-semibold">
          {session ? (
            <Link className="rounded-lg bg-brand px-4 py-2 text-white hover:bg-brand-deep" href="/projects">
              Open studio
            </Link>
          ) : (
            <>
              <Link className="text-ink-soft hover:text-ink" href="/sign-in">
                Sign in
              </Link>
              <Link className="rounded-lg bg-brand px-4 py-2 text-white hover:bg-brand-deep" href="/sign-up">
                Start free
              </Link>
            </>
          )}
        </nav>
      </header>
      <section className="max-w-3xl">
        <p className="mb-4 inline-flex rounded-full bg-brand-soft px-3 py-1 text-xs font-semibold text-brand-deep">
          Beta · 5 free Shorts
        </p>
        <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-6xl">
          Turn an idea into a finished, original Short.
        </h1>
        <p className="mt-6 text-lg leading-relaxed text-ink-soft">
          Type a topic. ShortLoop writes the script, voices it, finds licensed visuals, adds captions and
          hands you a ready-to-post 9:16 video.
        </p>
        <Link
          href={session ? "/new" : "/sign-up"}
          className="mt-8 inline-flex items-center gap-2 rounded-lg bg-brand px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-brand-deep"
        >
          Make your first Short <ArrowRight className="size-4" />
        </Link>
      </section>
      <section className="mt-20 grid gap-4 sm:grid-cols-3">
        {FEATURES.map(({ icon: Icon, title, body }) => (
          <div key={title} className="rounded-[var(--radius-card)] border border-line bg-white p-6">
            <Icon className="mb-4 size-6 text-brand" aria-hidden />
            <h2 className="font-semibold">{title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">{body}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
