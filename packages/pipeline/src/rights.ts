import type { Asset, Timeline } from "@shortloop/contracts";

/** Sources we can publish from. Anything else (e.g. a future "imported_url") is refused. */
const ALLOWED_SOURCES = new Set<Asset["source"]>([
  "upload",
  "own_channel",
  "stock",
  "ai_generated",
  "library_music",
]);

export interface RightsEntry {
  assetId: string;
  kind: Asset["kind"];
  source: Asset["source"] | "missing";
  licence: Asset["licence"] | null;
  attribution?: string;
  usedOn: ("video" | "audio")[];
}

export interface RightsManifest {
  timelineId: string;
  generatedAt: string;
  entries: RightsEntry[];
}

export class NotPublishableError extends Error {
  constructor(readonly problems: string[]) {
    super(`not publishable: ${problems.join("; ")}`);
  }
}

/** One entry per distinct asset in the timeline, with its source, licence and attribution. */
export function buildRightsManifest(timeline: Timeline, assets: Asset[], now = new Date()): RightsManifest {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const usage = new Map<string, Set<"video" | "audio">>();
  for (const c of timeline.video)
    (usage.get(c.assetId) ?? usage.set(c.assetId, new Set()).get(c.assetId))?.add("video");
  for (const c of timeline.audio)
    (usage.get(c.assetId) ?? usage.set(c.assetId, new Set()).get(c.assetId))?.add("audio");
  const entries = [...usage.entries()].map(([assetId, used]): RightsEntry => {
    const a = byId.get(assetId);
    return {
      assetId,
      kind: a?.kind ?? "image",
      source: a?.source ?? "missing",
      licence: a?.licence ?? null,
      attribution: a?.licence.attribution,
      usedOn: [...used].sort(),
    };
  });
  return { timelineId: timeline.id, generatedAt: now.toISOString(), entries };
}

/** Throws NotPublishableError listing every asset without a licence or from a disallowed source. */
export function assertPublishable(manifest: RightsManifest): void {
  const problems: string[] = [];
  for (const e of manifest.entries) {
    if (e.source === "missing" || !e.licence) problems.push(`asset ${e.assetId} has no licence record`);
    else if (!ALLOWED_SOURCES.has(e.source))
      problems.push(`asset ${e.assetId} comes from a disallowed source (${e.source})`);
    else if (e.source === "upload" && !e.licence.attestedByUserAt)
      problems.push(`asset ${e.assetId} was uploaded without an ownership attestation`);
    else if (e.source === "stock" && (!e.licence.licenceUrl || !e.licence.attribution))
      problems.push(`stock asset ${e.assetId} is missing its licence URL or attribution`);
  }
  if (problems.length > 0) throw new NotPublishableError(problems);
}

/** Credits line(s) to append to a publish description, deduplicated, in timeline order. */
export function attributionText(manifest: RightsManifest): string {
  const lines = [
    ...new Set(manifest.entries.map((e) => e.attribution).filter((a): a is string => Boolean(a))),
  ];
  return lines.length ? `Credits:\n${lines.join("\n")}` : "";
}

/** Append attributions to a description without duplicating them on re-publish. */
export function withAttribution(description: string, manifest: RightsManifest): string {
  const credits = attributionText(manifest);
  if (!credits || description.includes(credits)) return description;
  return description ? `${description.trimEnd()}\n\n${credits}` : credits;
}
