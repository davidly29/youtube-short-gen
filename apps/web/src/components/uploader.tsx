"use client";
import { CheckCircle2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ACCEPT_ATTR, ATTESTATION_TEXT, checkUpload } from "../lib/upload-rules";
import { Button, Card, ErrorText, Progress } from "./ui";

type Item = { name: string; progress: number; done?: boolean; error?: string };

function put(url: string, file: File, contentType: string, onProgress: (p: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", contentType);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error("Upload failed. Check your connection."));
    xhr.send(file);
  });
}

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? "Something went wrong");
  return body;
}

export function Uploader() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [attested, setAttested] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState<string>();

  const update = (name: string, patch: Partial<Item>) =>
    setItems((xs) => xs.map((x) => (x.name === name ? { ...x, ...patch } : x)));

  async function upload(files: FileList | null) {
    setError(undefined);
    if (!files?.length) return;
    const list = [...files];
    for (const f of list) {
      const c = checkUpload(f, attested);
      if (!c.ok) {
        setError(c.error);
        return;
      }
    }
    setItems(list.map((f) => ({ name: f.name, progress: 0 })));
    for (const f of list) {
      try {
        const pre = await json<{ key: string; url: string; contentType: string }>(
          await fetch("/api/uploads", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ filename: f.name, contentType: f.type, size: f.size, attested }),
          }),
        );
        await put(pre.url, f, pre.contentType, (p) => update(f.name, { progress: p * 0.95 }));
        await json(
          await fetch("/api/uploads/complete", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ key: pre.key, filename: f.name, attested }),
          }),
        );
        update(f.name, { progress: 1, done: true });
      } catch (e) {
        update(f.name, { error: e instanceof Error ? e.message : "Upload failed" });
      }
    }
    if (input.current) input.current.value = "";
    router.refresh();
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold">Upload your media</h2>
      <p className="mt-1 text-sm text-ink-soft">
        Your own clips, photos and audio. ShortLoop uses them before stock or AI on beats they match.
      </p>
      <label className="mt-4 flex items-start gap-3 rounded-lg border border-line bg-paper p-3 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 size-4 accent-brand"
          checked={attested}
          onChange={(e) => setAttested(e.target.checked)}
          data-testid="attest"
        />
        <span>
          <strong>{ATTESTATION_TEXT}.</strong>{" "}
          <span className="text-ink-soft">
            No downloads from YouTube, TikTok or other people’s posts. We record this confirmation with each
            file.
          </span>
        </span>
      </label>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input
          ref={input}
          type="file"
          multiple
          accept={ACCEPT_ATTR}
          className="sr-only"
          id="file"
          data-testid="file-input"
          onChange={(e) => void upload(e.target.files)}
        />
        <Button
          onClick={() =>
            attested ? input.current?.click() : setError(`Please confirm: "${ATTESTATION_TEXT}".`)
          }
        >
          <Upload className="size-4" aria-hidden /> Choose files
        </Button>
        <span className="text-xs text-ink-soft">MP4, MOV, PNG, JPG, MP3, WAV · up to 2 GB each</span>
      </div>
      <ErrorText>{error}</ErrorText>
      {items.length > 0 && (
        <ul className="mt-4 space-y-2" data-testid="upload-list">
          {items.map((it) => (
            <li key={it.name} className="text-sm">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="truncate">{it.name}</span>
                {it.done ? (
                  <CheckCircle2 className="size-4 text-good" aria-label="Uploaded" />
                ) : it.error ? (
                  <span className="text-xs text-bad">{it.error}</span>
                ) : (
                  <span className="text-xs text-ink-soft">{Math.round(it.progress * 100)}%</span>
                )}
              </div>
              {!it.done && !it.error && <Progress value={it.progress} />}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
