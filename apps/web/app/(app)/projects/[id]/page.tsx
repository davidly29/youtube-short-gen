import { notFound } from "next/navigation";
import { Studio } from "../../../../src/components/studio";
import { requireUser } from "../../../../src/server/auth";
import { listLibrary } from "../../../../src/server/library";
import { capabilities, credits, projectView, UserError } from "../../../../src/server/projects";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  try {
    const [view, caps, balance, library] = await Promise.all([
      projectView(user.id, id),
      capabilities(user.id),
      credits(user.id),
      listLibrary(user.id),
    ]);
    return (
      <Studio
        initial={JSON.parse(JSON.stringify(view))}
        caps={caps}
        creditsLeft={balance.shorts}
        library={library}
      />
    );
  } catch (e) {
    if (e instanceof UserError) notFound();
    throw e;
  }
}
