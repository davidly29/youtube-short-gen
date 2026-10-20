import { readFileSync } from "node:fs";
import { DEFAULT_NICHES, Topic, TrendSignal, type Niche } from "@shortloop/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  averageLinkage,
  CLUSTER_DISTANCE_THRESHOLD,
  clusterTopics,
  MAX_TOPICS,
  nicheMatcher,
} from "./cluster";

interface Fixture {
  now: string;
  niches: string[];
  spikes: { niche: string; keyword: string }[];
  signals: TrendSignal[];
}
const fx = JSON.parse(
  readFileSync(new URL("../../test/fixtures/trends-7d.json", import.meta.url), "utf8"),
) as Fixture;
const NOW = new Date(fx.now);
const niche = (id: string): Niche => {
  const n = DEFAULT_NICHES.find((x) => x.id === id);
  if (!n) throw new Error(`no niche ${id}`);
  return n;
};

/** Deterministic Fisher–Yates shuffle. */
function shuffled<T>(xs: readonly T[], seed: number): T[] {
  const out = [...xs];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

describe("clusterTopics on trends-7d.json (E3-02)", () => {
  it("the fixture signals are valid", () => {
    for (const s of fx.signals) expect(TrendSignal.safeParse(s).success).toBe(true);
    expect(fx.spikes).toHaveLength(6);
    expect(fx.niches).toHaveLength(3);
  });

  for (const id of fx.niches) {
    it(`puts every labelled ${id} spike in the niche's top 5`, () => {
      const topics = clusterTopics(fx.signals, niche(id), { now: NOW, seed: 1 });
      const top5 = topics.slice(0, 5);
      for (const spike of fx.spikes.filter((s) => s.niche === id)) {
        const hit = top5.find(
          (t) => t.keywords.includes(spike.keyword) || t.label.toLowerCase().includes(spike.keyword),
        );
        expect(hit, `${spike.keyword} not in top 5: ${top5.map((t) => t.label).join(" | ")}`).toBeDefined();
      }
    });
  }

  it("returns valid topics with 2–6 word labels, at most 20, sorted by velocity", () => {
    for (const id of fx.niches) {
      const topics = clusterTopics(fx.signals, niche(id), { now: NOW });
      expect(topics.length).toBeGreaterThan(0);
      expect(topics.length).toBeLessThanOrEqual(MAX_TOPICS);
      for (const t of topics) {
        const parsed = Topic.safeParse(t);
        expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
        const words = t.label.split(/\s+/).length;
        expect(words).toBeGreaterThanOrEqual(2);
        expect(words).toBeLessThanOrEqual(6);
        expect(t.nicheId).toBe(id);
        expect(t.signals24h).toBeGreaterThan(0);
      }
      const v = topics.map((t) => t.velocity);
      expect(v).toEqual([...v].sort((a, b) => b - a));
      expect(new Set(topics.map((t) => t.id)).size).toBe(topics.length);
    }
  });

  it("ranks a spike far above a steady topic", () => {
    const topics = clusterTopics(fx.signals, niche("history"), { now: NOW });
    const spike = topics.find((t) => t.keywords.includes("shipwreck"));
    const steady = topics.find((t) => t.keywords.includes("roman") && t.keywords.includes("empire"));
    expect(spike && steady).toBeTruthy();
    expect(spike?.velocity ?? 0).toBeGreaterThan((steady?.velocity ?? 0) * 10);
  });

  it("gives deeply equal output for the same input, seed and now, whatever the input order", () => {
    const n = niche("tech");
    const a = clusterTopics(fx.signals, n, { now: NOW, seed: 7 });
    const b = clusterTopics(fx.signals, n, { now: NOW, seed: 7 });
    const c = clusterTopics(shuffled(fx.signals, 42), n, { now: NOW, seed: 7 });
    const d = clusterTopics([...fx.signals].reverse(), n, { now: NOW, seed: 7 });
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    expect(d).toEqual(a);
  });

  it("ignores signals outside the 8-day window or in the future", () => {
    const old = {
      ...fx.signals[0],
      id: "old",
      title: "Ancient quantum outage asteroid",
      observedAt: "2026-09-01T00:00:00Z",
    } as TrendSignal;
    const future = { ...old, id: "future", observedAt: "2026-10-21T00:00:00Z" };
    const n = niche("tech");
    expect(clusterTopics([...fx.signals, old, future], n, { now: NOW })).toEqual(
      clusterTopics(fx.signals, n, { now: NOW }),
    );
    expect(clusterTopics([], n, { now: NOW })).toEqual([]);
  });

  it("is pure: no network, no LLM, and uses an injected embedding", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const embed = vi.fn((text: string) => {
      const v = new Array<number>(26).fill(0);
      for (const ch of text.toLowerCase())
        if (ch >= "a" && ch <= "z") v[ch.charCodeAt(0) - 97] = (v[ch.charCodeAt(0) - 97] ?? 0) + 1;
      return v;
    });
    clusterTopics(fx.signals, niche("science"), { now: NOW, embed });
    expect(embed).toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("niche matching", () => {
  const base = fx.signals[0] as TrendSignal;
  it("matches by category, feed niche or whole-word keyword", () => {
    const tech = nicheMatcher(niche("tech"));
    const finance = nicheMatcher(niche("finance"));
    expect(tech({ ...base, categoryId: "28" })).toBe(true);
    const plain = { ...base, categoryId: undefined, niche: undefined, keywords: [] };
    expect(tech({ ...plain, niche: "tech" })).toBe(true);
    expect(tech({ ...plain, title: "Why AI agents are everywhere" })).toBe(true);
    expect(tech({ ...plain, title: "Said the captain" })).toBe(false); // "ai" only inside a word
    expect(finance({ ...plain, title: "Bitcoin hits a new high" })).toBe(true);
    expect(finance({ ...plain, title: "Gardening tips" })).toBe(false);
  });
});

describe("averageLinkage", () => {
  it("merges only below the threshold", () => {
    // Points on a line: {0, 0.1} and {1, 1.05} are two clusters at threshold 0.35.
    const pts = [0, 0.1, 1, 1.05];
    const n = pts.length;
    const d = new Float32Array(n * n);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) d[i * n + j] = Math.abs((pts[i] ?? 0) - (pts[j] ?? 0));
    const c = averageLinkage(d, n, CLUSTER_DISTANCE_THRESHOLD);
    expect(c[0]).toBe(c[1]);
    expect(c[2]).toBe(c[3]);
    expect(c[0]).not.toBe(c[2]);
  });
});
