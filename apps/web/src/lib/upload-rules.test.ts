import { describe, expect, it } from "vitest";
import { checkUpload, MAX_UPLOAD_BYTES } from "./upload-rules";

describe("checkUpload (E2-01)", () => {
  it("accepts MP4, MOV, PNG, JPG, MP3 and WAV", () => {
    for (const [name, type] of [
      ["a.mp4", "video/mp4"],
      ["a.MOV", "video/quicktime"],
      ["a.png", "image/png"],
      ["a.jpg", "image/jpeg"],
      ["a.jpeg", "image/jpeg"],
      ["a.mp3", "audio/mpeg"],
      ["a.wav", "audio/wav"],
    ] as const) {
      expect(checkUpload({ name, size: 10, type }, true)).toMatchObject({ ok: true });
    }
  });
  it("rejects other types with a clear error", () => {
    expect(checkUpload({ name: "a.gif", size: 10 }, true)).toEqual({
      ok: false,
      error: expect.stringMatching(/Use MP4, MOV, PNG, JPG, MP3 or WAV/),
    });
    expect(checkUpload({ name: "a.mp4", size: 10, type: "text/html" }, true)).toMatchObject({ ok: false });
  });
  it("rejects without attestation", () => {
    expect(checkUpload({ name: "a.mp4", size: 10 }, false)).toEqual({
      ok: false,
      error: expect.stringMatching(/own or have rights/),
    });
  });
  it("rejects files over 2 GB before upload, and empty files", () => {
    expect(checkUpload({ name: "a.mp4", size: MAX_UPLOAD_BYTES + 1 }, true)).toEqual({
      ok: false,
      error: expect.stringMatching(/2 GB/),
    });
    expect(checkUpload({ name: "a.mp4", size: MAX_UPLOAD_BYTES }, true)).toMatchObject({ ok: true });
    expect(checkUpload({ name: "a.mp4", size: 0 }, true)).toMatchObject({ ok: false });
  });
});
