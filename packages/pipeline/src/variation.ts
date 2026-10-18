import { schema, and, desc, eq, inArray, type Db } from "@shortloop/db";

/** Above this cosine similarity a new script counts as a near-duplicate of a recent one. */
export const SIMILARITY_LIMIT = 0.9;
export const RECENT_SCRIPTS = 50;
export const HOOK_REUSE_DAYS = 30;

type ScriptText = { hook: string; beats: { text: string }[]; cta?: string };

const DIM = 2048;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % DIM;
}

/**
 * Local text embedding: hashed word unigrams + bigrams, L2-normalised. Deterministic and free; a
 * provider embedding can replace it behind the same signature.
 */
export function embed(text: string): Float64Array {
  const v = new Float64Array(DIM);
  const words = text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
  words.forEach((w, i) => {
    const a = hash(w);
    v[a] = (v[a] ?? 0) + 1;
    const next = words[i + 1];
    if (next) {
      const b = hash(`${w} ${next}`);
      v[b] = (v[b] ?? 0) + 1;
    }
  });
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  return v.map((x) => x / norm);
}

export function cosine(a: Float64Array, b: Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] ?? 0) * (b[i] ?? 0);
  return s;
}

const scriptText = (s: ScriptText) => [s.hook, ...s.beats.map((b) => b.text), s.cta ?? ""].join(" ");

/** Highest cosine similarity between `script` and any of `recent` (0 when there are none). */
export function similarity(script: ScriptText, recent: ScriptText[]): number {
  const e = embed(scriptText(script));
  return recent.reduce((best, r) => Math.max(best, cosine(e, embed(scriptText(r)))), 0);
}

export interface VariationResult {
  ok: boolean;
  score: number;
  nearest?: { scriptId: string; title: string };
  reasons: string[];
}

/**
 * Compare a draft with the owner's last 50 scripts: block at cosine ≥ 0.9, and flag a hook reused
 * word-for-word within 30 days. (Scoped per owner until channels own projects, E8-01/E11-01.)
 */
export async function checkVariation(
  db: Db,
  ownerId: string,
  script: ScriptText & { id?: string },
  now = new Date(),
): Promise<VariationResult> {
  const projects = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(eq(schema.projects.ownerId, ownerId));
  if (projects.length === 0) return { ok: true, score: 0, reasons: [] };
  const recent = await db
    .select()
    .from(schema.scripts)
    .where(
      inArray(
        schema.scripts.projectId,
        projects.map((p) => p.id),
      ),
    )
    .orderBy(desc(schema.scripts.createdAt))
    .limit(RECENT_SCRIPTS + 1);
  const others = recent.filter((r) => r.id !== script.id).slice(0, RECENT_SCRIPTS);
  const e = embed(scriptText(script));
  let score = 0;
  let nearest: VariationResult["nearest"];
  for (const r of others) {
    const c = cosine(e, embed(scriptText(r)));
    if (c > score) {
      score = c;
      nearest = { scriptId: r.id, title: r.title };
    }
  }
  const reasons: string[] = [];
  if (score >= SIMILARITY_LIMIT && nearest)
    reasons.push(
      `Too similar to "${nearest.title}" (${Math.round(score * 100)}% match). Change the angle or the beats.`,
    );
  const cutoff = now.getTime() - HOOK_REUSE_DAYS * 86_400_000;
  const norm = (h: string) => h.trim().toLowerCase().replace(/\s+/g, " ");
  const reused = others.find(
    (r) => norm(r.hook) === norm(script.hook) && new Date(r.createdAt).getTime() >= cutoff,
  );
  if (reused)
    reasons.push(`Hook reused word-for-word from "${reused.title}" within ${HOOK_REUSE_DAYS} days.`);
  return { ok: reasons.length === 0, score, nearest, reasons };
}

/** Record that a user deliberately overrode a variation block (only allowed via explicit user action). */
export async function recordVariationOverride(
  db: Db,
  ownerId: string,
  scriptId: string,
  result: VariationResult,
): Promise<void> {
  await db.insert(schema.auditEvents).values({
    ownerId,
    type: "variation_override",
    subjectId: scriptId,
    data: { score: result.score, nearest: result.nearest ?? null, reasons: result.reasons },
  });
}

export async function listOverrides(db: Db, ownerId: string) {
  return db
    .select()
    .from(schema.auditEvents)
    .where(and(eq(schema.auditEvents.ownerId, ownerId), eq(schema.auditEvents.type, "variation_override")));
}
