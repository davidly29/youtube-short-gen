/** Upload rules shared by the browser (fail fast) and the server (the real check). E2-01. */
export const MAX_UPLOAD_BYTES = 2 * 1024 ** 3;

export const UPLOAD_TYPES = {
  mp4: { kind: "video", mime: ["video/mp4"] },
  mov: { kind: "video", mime: ["video/quicktime"] },
  png: { kind: "image", mime: ["image/png"] },
  jpg: { kind: "image", mime: ["image/jpeg"] },
  jpeg: { kind: "image", mime: ["image/jpeg"] },
  mp3: { kind: "audio", mime: ["audio/mpeg", "audio/mp3"] },
  wav: { kind: "audio", mime: ["audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"] },
} as const;

export type UploadExt = keyof typeof UPLOAD_TYPES;
export type UploadKind = (typeof UPLOAD_TYPES)[UploadExt]["kind"];

export const ATTESTATION_TEXT = "I own or have rights to this media";
export const ACCEPT_ATTR = ".mp4,.mov,.png,.jpg,.jpeg,.mp3,.wav";

export type UploadCheck = { ok: true; ext: UploadExt; kind: UploadKind } | { ok: false; error: string };

export function checkUpload(
  file: { name: string; size: number; type?: string },
  attested: boolean,
): UploadCheck {
  if (!attested) return { ok: false, error: `Please confirm: "${ATTESTATION_TEXT}".` };
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  if (!(ext in UPLOAD_TYPES)) {
    return { ok: false, error: `"${file.name}" isn't a supported file. Use MP4, MOV, PNG, JPG, MP3 or WAV.` };
  }
  const rule = UPLOAD_TYPES[ext as UploadExt];
  if (file.type && !(rule.mime as readonly string[]).includes(file.type)) {
    return {
      ok: false,
      error: `"${file.name}" says it's ${file.type}, which doesn't match its .${ext} extension.`,
    };
  }
  if (file.size <= 0) return { ok: false, error: `"${file.name}" is empty.` };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: `"${file.name}" is over the 2 GB limit.` };
  return { ok: true, ext: ext as UploadExt, kind: rule.kind };
}
