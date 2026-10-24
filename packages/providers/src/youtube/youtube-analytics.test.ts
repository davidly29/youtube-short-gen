import { describe, expect, it } from "vitest";
import { cassette } from "../testing/cassette";
import {
  AnalyticsScopeMissing,
  daysBetween,
  FakeYouTubeAnalytics,
  hasAnalyticsScope,
  HttpYouTubeAnalytics,
  ReconnectRequired,
  YOUTUBE_ANALYTICS_SCOPE,
  YOUTUBE_SCOPES,
} from ".";

const URL_V1 =
  "https://youtubeanalytics.googleapis.com/v2/reports?ids=channel%3D%3DMINE&startDate=2026-10-01&endDate=2026-10-03" +
  "&metrics=views%2CaverageViewPercentage%2Clikes%2Ccomments%2CsubscribersGained&dimensions=day&filters=video%3D%3Dv1&sort=day";
const q = { accessToken: "at", videoId: "v1", startDate: "2026-10-01", endDate: "2026-10-03" };

describe("YouTube Analytics adapter (E10-01)", () => {
  it("asks for the read-only analytics scope at connect time", () => {
    expect(YOUTUBE_SCOPES).toContain(YOUTUBE_ANALYTICS_SCOPE);
    expect(hasAnalyticsScope(YOUTUBE_SCOPES.join(" "))).toBe(true);
    expect(hasAnalyticsScope("youtube.upload yt-analytics.readonly")).toBe(true);
    expect(hasAnalyticsScope("https://www.googleapis.com/auth/youtube.upload")).toBe(false);
    expect(hasAnalyticsScope(null)).toBe(false);
  });

  it("reads one video's daily views, retention, likes, comments and subs by column name", async () => {
    const c = cassette([
      {
        request: { method: "GET", url: URL_V1, headers: { authorization: "Bearer at" } },
        response: {
          status: 200,
          body: {
            kind: "youtubeAnalytics#resultTable",
            columnHeaders: [
              { name: "day" },
              { name: "views" },
              { name: "averageViewPercentage" },
              { name: "likes" },
              { name: "comments" },
              { name: "subscribersGained" },
            ],
            rows: [
              ["2026-10-01", 1200, 87.5, 40, 3, 2],
              ["2026-10-03", 300, 61.25, 5, 0, 0],
            ],
          },
        },
      },
    ]);
    const rows = await new HttpYouTubeAnalytics(c.fetch).videoDaily(q);
    expect(rows).toEqual([
      {
        videoId: "v1",
        date: "2026-10-01",
        views: 1200,
        avgViewPct: 87.5,
        likes: 40,
        comments: 3,
        subsGained: 2,
      },
      {
        videoId: "v1",
        date: "2026-10-03",
        views: 300,
        avgViewPct: 61.25,
        likes: 5,
        comments: 0,
        subsGained: 0,
      },
    ]);
    c.assertDone();
  });

  it("returns nothing for a video with no data yet", async () => {
    const c = cassette([
      { request: { method: "GET", url: URL_V1 }, response: { status: 200, body: { columnHeaders: [] } } },
    ]);
    expect(await new HttpYouTubeAnalytics(c.fetch).videoDaily(q)).toEqual([]);
  });

  it("tells a missing analytics grant apart from an expired one", async () => {
    const forbidden = cassette([
      {
        request: { method: "GET", url: URL_V1 },
        response: {
          status: 403,
          body: {
            error: { code: 403, message: "Forbidden", errors: [{ reason: "insufficientPermissions" }] },
          },
        },
      },
    ]);
    await expect(new HttpYouTubeAnalytics(forbidden.fetch).videoDaily(q)).rejects.toBeInstanceOf(
      AnalyticsScopeMissing,
    );
    const expired = cassette([
      {
        request: { method: "GET", url: URL_V1 },
        response: { status: 401, body: { error: { code: 401, message: "Invalid Credentials" } } },
      },
    ]);
    await expect(new HttpYouTubeAnalytics(expired.fetch).videoDaily(q)).rejects.toBeInstanceOf(
      ReconnectRequired,
    );
  });

  it("fake: one deterministic row per day, and can simulate an old grant", async () => {
    const fake = new FakeYouTubeAnalytics();
    const a = await fake.videoDaily(q);
    expect(a.map((r) => r.date)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(await fake.videoDaily(q)).toEqual(a);
    fake.noScope = true;
    await expect(fake.videoDaily(q)).rejects.toBeInstanceOf(AnalyticsScopeMissing);
    expect(daysBetween("2026-10-03", "2026-10-01")).toEqual([]);
  });
});
