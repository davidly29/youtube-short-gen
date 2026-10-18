import { openDb, schema, seed, SEED, type DbHandle } from "@shortloop/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkVariation, listOverrides, recordVariationOverride, similarity } from "./variation";

let h: DbHandle;
beforeEach(async () => {
  h = openDb("memory://");
  await h.migrate();
  await seed(h.db);
});
afterEach(async () => {
  await h.close();
});

const base = {
  hook: "Why do octopuses have three hearts?",
  beats: [
    { text: "Why do octopuses have three hearts? Two hearts pump blood through the gills." },
    { text: "The third heart pushes blood around the rest of the body." },
    { text: "And when they swim, that heart stops beating, which is why they prefer to crawl." },
  ],
  cta: "Follow for more ocean facts.",
};

async function saveScript(id: string, s: typeof base, createdAt = new Date().toISOString()) {
  await h.db.insert(schema.scripts).values({
    id,
    projectId: SEED.projectId,
    title: id,
    hook: s.hook,
    cta: s.cta,
    language: "en",
    wordCount: 40,
    createdAt,
    beats: s.beats.map((b, i) => ({ id: `b${i}`, text: b.text, visualQuery: "x", estDurationMs: 1000 })),
  });
}

describe("variation guard", () => {
  it("scores near-identical scripts ≥ 0.9 and unrelated ones low", () => {
    const reworded = { ...base, cta: "Follow for more facts about the ocean." };
    const unrelated = {
      hook: "How do bees make honey?",
      beats: [{ text: "Bees collect nectar and dry it in wax cells until it thickens." }],
      cta: "",
    };
    expect(similarity(reworded, [base])).toBeGreaterThanOrEqual(0.9);
    expect(similarity(unrelated, [base])).toBeLessThan(0.3);
  });

  it("blocks a near-duplicate of one of the owner's last 50 scripts, with a readable reason", async () => {
    await saveScript("old", base);
    const r = await checkVariation(h.db, SEED.userId, { ...base, cta: "Follow for more!" });
    expect(r.ok).toBe(false);
    expect(r.nearest?.scriptId).toBe("old");
    expect(r.reasons[0]).toMatch(/Too similar/);
  });

  it("flags a hook reused word-for-word within 30 days, but not an older one", async () => {
    await saveScript("recent", {
      ...base,
      beats: [{ text: "A completely different body about deep sea anglerfish lights." }],
    });
    const fresh = {
      hook: base.hook,
      beats: [{ text: "Totally new content about squid ink and camouflage tricks." }],
      cta: "",
    };
    expect((await checkVariation(h.db, SEED.userId, fresh)).reasons.join()).toMatch(/Hook reused/);
    const later = new Date(Date.now() + 31 * 86_400_000);
    expect((await checkVariation(h.db, SEED.userId, fresh, later)).reasons.join()).not.toMatch(/Hook reused/);
  });

  it("records an explicit override in the append-only audit log", async () => {
    await saveScript("old", base);
    const r = await checkVariation(h.db, SEED.userId, base);
    await recordVariationOverride(h.db, SEED.userId, "new_script", r);
    const events = await listOverrides(h.db, SEED.userId);
    expect(events).toHaveLength(1);
    expect(events[0]?.subjectId).toBe("new_script");
    await expect(h.db.delete(schema.auditEvents)).rejects.toThrow();
  });
});
