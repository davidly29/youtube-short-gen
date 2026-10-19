import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cassette, type CassetteEntry } from "../testing/cassette";
import { HttpYouTube, QuotaExceeded, type VideoMetadata } from ".";

const config = { clientId: "c", clientSecret: "s", redirectUri: "https://app.test/cb" };
const START = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";
const SESSION = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=S1";
const meta: VideoMetadata = {
  title: "Why octopuses have three hearts",
  description: "#Shorts",
  tags: ["octopus"],
  categoryId: "22",
  privacyStatus: "private",
  publishAt: "2026-10-20T09:00:00.000Z",
  containsSyntheticMedia: true,
  selfDeclaredMadeForKids: false,
};

let dir: string;
let file: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "yt-"));
  file = join(dir, "short.mp4");
  await writeFile(file, Buffer.alloc(1000, 7));
});
afterAll(() => rm(dir, { recursive: true, force: true }));

describe("resumable upload (E8-02)", () => {
  it("plays the recorded happy path: token -> session -> bytes -> video id", async () => {
    const rec = JSON.parse(
      await readFile(new URL("./cassettes/upload-happy.json", import.meta.url), "utf8"),
    ) as { entries: CassetteEntry[] };
    const c = cassette(rec.entries);
    const yt = new HttpYouTube(config, c.fetch);
    const sessions: string[] = [];
    const token = await yt.accessToken("rt");
    const { videoId } = await yt.upload({
      accessToken: token,
      filePath: file,
      metadata: meta,
      onSession: (s) => void sessions.push(s),
    });
    expect(videoId).toBe("dQw4recorded");
    expect(sessions).toHaveLength(1); // persisted before any bytes were sent
    const startBody = JSON.parse(String(c.calls[1]?.body)) as {
      status: Record<string, unknown>;
      snippet: Record<string, unknown>;
    };
    expect(startBody.status).toMatchObject({
      privacyStatus: "private",
      publishAt: meta.publishAt,
      containsSyntheticMedia: true,
      selfDeclaredMadeForKids: false,
    });
    expect(c.calls[1]?.headers["x-upload-content-length"]).toBe("1000");
    expect(c.calls[2]?.headers["content-range"]).toBe("bytes 0-999/1000");
    c.assertDone();
  });

  it("resumes an interrupted session from where YouTube says it stopped", async () => {
    const c = cassette([
      {
        request: { method: "PUT", url: SESSION },
        response: { status: 308, headers: { range: "bytes=0-399" } },
      },
      { request: { method: "PUT", url: SESSION }, response: { status: 201, body: { id: "resumed1" } } },
    ]);
    const { videoId } = await new HttpYouTube(config, c.fetch).upload({
      accessToken: "at",
      filePath: file,
      metadata: meta,
      sessionUrl: SESSION,
    });
    expect(videoId).toBe("resumed1");
    expect(c.calls[0]?.headers["content-range"]).toBe("bytes */1000");
    expect(c.calls[1]?.headers["content-range"]).toBe("bytes 400-999/1000");
    c.assertDone();
  });

  it("a session that already finished returns its video instead of uploading again", async () => {
    const c = cassette([
      { request: { method: "PUT", url: SESSION }, response: { status: 200, body: { id: "alreadyDone" } } },
    ]);
    expect(
      await new HttpYouTube(config, c.fetch).upload({
        accessToken: "at",
        filePath: file,
        metadata: meta,
        sessionUrl: SESSION,
      }),
    ).toEqual({ videoId: "alreadyDone" });
    c.assertDone();
  });

  it("maps quota errors to QuotaExceeded", async () => {
    const c = cassette([
      {
        request: { method: "POST", url: START },
        response: {
          status: 403,
          body: { error: { code: 403, message: "quota", errors: [{ reason: "quotaExceeded" }] } },
        },
      },
    ]);
    await expect(
      new HttpYouTube(config, c.fetch).upload({ accessToken: "at", filePath: file, metadata: meta }),
    ).rejects.toBeInstanceOf(QuotaExceeded);
  });
});
