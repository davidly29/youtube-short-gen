import { NewShortForm, type IdeaChip } from "../../../src/components/new-short-form";
import { requireUser } from "../../../src/server/auth";
import { getTodayBrief } from "../../../src/server/brief";
import { capabilities } from "../../../src/server/projects";
import { voiceOptions } from "../../../src/server/style";

const one = (v: string | string[] | undefined, max: number) =>
  (Array.isArray(v) ? v[0] : v)?.trim().slice(0, max) || undefined;

/** Up to four ideas from today's briefs that the user hasn't made a Short from yet. */
async function ideasFor(userId: string): Promise<IdeaChip[]> {
  const briefs = await getTodayBrief(userId).catch(() => []);
  return briefs
    .flatMap((b) =>
      (b.brief?.items ?? [])
        .filter((i) => !b.started[i.topicId])
        .map((i) => ({
          topic: (i.sources[0]?.title ?? i.hook).slice(0, 300),
          angle: i.angle.slice(0, 300),
          topicId: i.topicId,
          channel: b.channel.title,
        })),
    )
    .slice(0, 4);
}

/** `/new?topic=…&angle=…&topicId=…` prefills the form from a daily-brief item (E3-03b). */
export default async function NewShortPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const [q, voices, caps, ideas] = await Promise.all([
    searchParams,
    voiceOptions(user.id),
    capabilities(user.id),
    ideasFor(user.id),
  ]);
  const topicId = one(q.topicId, 80);
  return (
    <NewShortForm
      voices={voices}
      narrators={caps.voices.map((v) => ({ id: v.id, label: v.label }))}
      aiScripts={caps.aiScripts}
      ideas={ideas}
      defaults={{
        topic: one(q.topic, 300),
        angle: one(q.angle, 300),
        topicId: topicId && /^top_[A-Za-z0-9_]{1,60}$/.test(topicId) ? topicId : undefined,
      }}
    />
  );
}
