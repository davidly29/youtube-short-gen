import { NewShortForm } from "../../../src/components/new-short-form";
import { requireUser } from "../../../src/server/auth";
import { voiceOptions } from "../../../src/server/style";

const one = (v: string | string[] | undefined, max: number) =>
  (Array.isArray(v) ? v[0] : v)?.trim().slice(0, max) || undefined;

/** `/new?topic=…&angle=…&topicId=…` prefills the form from a daily-brief item (E3-03b). */
export default async function NewShortPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const [q, voices] = await Promise.all([searchParams, voiceOptions(user.id)]);
  const topicId = one(q.topicId, 80);
  return (
    <NewShortForm
      voices={voices}
      defaults={{
        topic: one(q.topic, 300),
        angle: one(q.angle, 300),
        topicId: topicId && /^top_[A-Za-z0-9_]{1,60}$/.test(topicId) ? topicId : undefined,
      }}
    />
  );
}
