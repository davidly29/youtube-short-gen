import { Clapperboard, Plus } from "lucide-react";
import Link from "next/link";
import { Badge, Card, STATUS_LABEL } from "../../../src/components/ui";
import { PerformanceCard } from "../../../src/components/performance";
import { performanceFor } from "../../../src/server/analytics";
import { requireUser } from "../../../src/server/auth";
import { listProjects } from "../../../src/server/projects";

export default async function ProjectsPage() {
  const user = await requireUser();
  const [projects, performance] = await Promise.all([listProjects(user.id), performanceFor(user.id)]);
  return (
    <div>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Your Shorts</h1>
          <p className="mt-1 text-sm text-ink-soft">Every project, from idea to approved video.</p>
        </div>
      </div>
      {(performance.shorts.length > 0 || performance.reconnect.length > 0) && (
        <PerformanceCard shorts={performance.shorts} reconnect={performance.reconnect} />
      )}
      {projects.length === 0 ? (
        <Card className="flex flex-col items-center py-16 text-center" data-testid="empty-projects">
          <Clapperboard className="mb-4 size-10 text-brand" aria-hidden />
          <h2 className="text-lg font-semibold">No projects yet</h2>
          <p className="mt-1 max-w-sm text-sm text-ink-soft">
            Start with a topic you care about. We’ll write, voice and edit it into a 9:16 Short.
          </p>
          <Link
            href="/new"
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-deep"
          >
            <Plus className="size-4" aria-hidden /> Make your first Short
          </Link>
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="project-list">
          {projects.map((p) => {
            const s = STATUS_LABEL[p.status] ?? { label: p.status, tone: "neutral" as const };
            return (
              <li key={p.id}>
                <Link
                  href={`/projects/${p.id}`}
                  className="block rounded-[var(--radius-card)] border border-line bg-white p-5 transition hover:border-brand/40 hover:shadow-sm"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <Badge tone={s.tone}>{s.label}</Badge>
                    <span className="text-xs text-ink-soft">
                      {new Date(p.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <h2 className="line-clamp-2 font-semibold">{p.title}</h2>
                  {p.topic && p.topic !== p.title && (
                    <p className="mt-1 line-clamp-1 text-sm text-ink-soft">{p.topic}</p>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
