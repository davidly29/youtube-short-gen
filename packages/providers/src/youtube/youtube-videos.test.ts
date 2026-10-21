import { describe, expect, it } from "vitest";
import { cassette } from "../testing/cassette";
import { FakeYouTube, HttpYouTube, ReconnectRequired } from ".";

const config = { clientId: "cid", clientSecret: "cs", redirectUri: "https://app.test/cb" };
const API = "https://www.googleapis.com/youtube/v3";
const auth = { authorization: "Bearer at" };

describe("YouTube own videos (E4-03)", () => {
  it("reads the uploads playlist, then titles + descriptions, newest first, with readonly calls only", async () => {
    const c = cassette([
      {
        request: { method: "GET", url: `${API}/channels?part=contentDetails&mine=true`, headers: auth },
        response: {
          status: 200,
          body: { items: [{ contentDetails: { relatedPlaylists: { uploads: "UU123" } } }] },
        },
      },
      {
        request: {
          method: "GET",
          url: `${API}/playlistItems?part=contentDetails&playlistId=UU123&maxResults=3`,
          headers: auth,
        },
        response: {
          status: 200,
          body: {
            items: [
              { contentDetails: { videoId: "v3" } },
              { contentDetails: { videoId: "v2" } },
              { contentDetails: { videoId: "v1" } },
            ],
          },
        },
      },
      {
        request: { method: "GET", url: `${API}/videos?part=snippet%2Cstatus&id=v3%2Cv2%2Cv1`, headers: auth },
        response: {
          status: 200,
          body: {
            items: [
              {
                id: "v1",
                snippet: { title: "Old", description: "d1", publishedAt: "2026-01-01T00:00:00Z" },
                status: { privacyStatus: "public" },
              },
              {
                id: "v3",
                snippet: { title: "New", description: "d3", publishedAt: "2026-03-01T00:00:00Z" },
                status: { privacyStatus: "private" },
              },
              // v2 deleted between the two calls: skipped
            ],
          },
        },
      },
    ]);
    const vids = await new HttpYouTube(config, c.fetch).myVideos("at", 3);
    expect(vids).toEqual([
      {
        id: "v3",
        title: "New",
        description: "d3",
        publishedAt: "2026-03-01T00:00:00Z",
        privacyStatus: "private",
      },
      {
        id: "v1",
        title: "Old",
        description: "d1",
        publishedAt: "2026-01-01T00:00:00Z",
        privacyStatus: "public",
      },
    ]);
    c.assertDone();
    // Text metadata only: no media, caption or download endpoints are ever touched.
    expect(c.calls.every((x) => !/captions|download|googlevideo/.test(x.url))).toBe(true);
  });

  it("returns nothing for a channel without uploads and asks to reconnect on 401", async () => {
    const empty = cassette([
      {
        request: { method: "GET", url: `${API}/channels?part=contentDetails&mine=true` },
        response: { status: 200, body: { items: [] } },
      },
    ]);
    expect(await new HttpYouTube(config, empty.fetch).myVideos("at")).toEqual([]);
    const expired = cassette([
      {
        request: { method: "GET", url: `${API}/channels?part=contentDetails&mine=true` },
        response: { status: 401, body: { error: { code: 401, message: "Invalid Credentials" } } },
      },
    ]);
    await expect(new HttpYouTube(config, expired.fetch).myVideos("at")).rejects.toBeInstanceOf(
      ReconnectRequired,
    );
  });

  it("the fake has a dozen public uploads for fake mode", async () => {
    const vids = await new FakeYouTube().myVideos("access-fake");
    expect(vids).toHaveLength(12);
    expect(vids.every((v) => v.privacyStatus === "public" && v.title)).toBe(true);
  });
});
