import "server-only";
import { randomUUID } from "node:crypto";
import { Brief, DEFAULT_NICHES, NicheId, type BriefItem } from "@shortloop/contracts";
import { and, desc, eq, inArray, ne, schema } from "@shortloop/db";
import { UserError } from "./errors";
import { runtime } from "./runtime";

export const NICHE_OPTIONS = DEFAULT_NICHES.map((n) => ({ id: n.id, name: n.name }));

export interface ChannelBrief {
  channel: { id: string; title: string; avatarUrl: string | null };
  niche?: { id: string; name: string };
  brief?: { date: string; items: BriefItem[]; partial: boolean; generatedWith: "llm" | "template" };
  /** Brief topics the user already made a project from: topicId -> projectId. */
  started: Record<string, string>;
}

/**
 * Each of the user's connected channels with its niche and latest daily brief (E3-03b). With a
 * `channelId`, only that channel, and only if the user owns it.
 */
export async function getTodayBrief(userId: string, channelId?: string): Promise<ChannelBrief[]> {
  const { db } = await runtime();
  const channels = await db
    .select()
    .from(schema.channels)
    .where(
      and(
        eq(schema.channels.ownerId, userId),
        ne(schema.channels.status, "disconnected"),
        ...(channelId ? [eq(schema.channels.id, channelId)] : []),
      ),
    )
    .orderBy(desc(schema.channels.updatedAt));
  if (channelId && channels.length === 0) throw new UserError("Channel not found");

  const out: ChannelBrief[] = [];
  for (const c of channels) {
    const niche = DEFAULT_NICHES.find((n) => n.id === c.nicheId);
    const [row] = await db
      .select()
      .from(schema.briefs)
      .where(eq(schema.briefs.channelId, c.id))
      .orderBy(desc(schema.briefs.date))
      .limit(1);
    const topicIds = row?.items.map((i) => i.topicId) ?? [];
    const projects = topicIds.length
      ? await db
          .select({ id: schema.projects.id, topicId: schema.projects.topicId })
          .from(schema.projects)
          .where(and(eq(schema.projects.ownerId, userId), inArray(schema.projects.topicId, topicIds)))
      : [];
    out.push({
      channel: { id: c.id, title: c.title, avatarUrl: c.avatarUrl },
      niche: niche ? { id: niche.id, name: niche.name } : undefined,
      brief: row
        ? { date: row.date, items: row.items, partial: row.partial, generatedWith: row.generatedWith }
        : undefined,
      started: Object.fromEntries(projects.flatMap((p) => (p.topicId ? [[p.topicId, p.id]] : []))),
    });
  }
  return out;
}

/** Set the niche a channel's daily brief covers. Only the channel's owner can, and only to a listed niche. */
export async function setChannelNiche(userId: string, channelId: string, nicheId: string): Promise<void> {
  const id = NicheId.safeParse(nicheId);
  if (!id.success || !DEFAULT_NICHES.some((n) => n.id === id.data))
    throw new UserError("Pick a niche from the list");
  const { db } = await runtime();
  const updated = await db
    .update(schema.channels)
    .set({ nicheId: id.data, updatedAt: new Date().toISOString() })
    .where(and(eq(schema.channels.id, channelId), eq(schema.channels.ownerId, userId)))
    .returning();
  if (updated.length === 0) throw new UserError("Channel not found");
}

/**
 * Fake mode only (SHORTLOOP_FAKE_PROVIDERS=1, e2e and demos): store today's brief for the user's first
 * channel with a niche, as the 05:00 UTC job would. Never available with real providers.
 */
export async function seedFakeBrief(userId: string): Promise<string> {
  const rt = await runtime();
  if (!rt.fake) throw new UserError("Not available");
  const [channel] = (await getTodayBrief(userId)).filter((c) => c.niche);
  if (!channel?.niche) throw new UserError("Pick a niche for a channel first");
  const label = ["Viking Shipwreck Discovered", "Medieval Coin Hoard", "Roman Road Traced"];
  const brief = Brief.parse({
    id: `brief_${randomUUID()}`,
    channelId: channel.channel.id,
    date: new Date().toISOString().slice(0, 10),
    generatedWith: "template",
    partial: false,
    items: label.map((l, i) => ({
      topicId: `top_fake_${i}`,
      angle: `Why "${l}" is trending`,
      hook: `${l}: here's what changed this week`,
      format: i === 0 ? "news-in-60s" : "trend-explainer",
      whyNow: `${12 - i * 3} signals in 24 h, ${40 - i * 10}× the weekly average`,
      sources: [{ url: `https://news.example.com/${i}`, title: `${l} (example source)`, source: "rss" }],
    })),
  });
  await rt.db
    .insert(schema.briefs)
    .values({
      id: brief.id,
      channelId: brief.channelId,
      date: brief.date,
      items: brief.items,
      generatedWith: brief.generatedWith,
      partial: brief.partial,
    })
    .onConflictDoUpdate({
      target: [schema.briefs.channelId, schema.briefs.date],
      set: { items: brief.items, generatedWith: brief.generatedWith, partial: brief.partial },
    });
  return brief.id;
}
