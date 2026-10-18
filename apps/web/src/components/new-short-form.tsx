"use client";
import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createProjectAction } from "../../app/(app)/actions";
import { Button, Card, ErrorText, Input, Label, Select, Textarea } from "./ui";

const LENGTHS = [30, 45, 60] as const;
const TONES = ["curious", "energetic", "calm", "funny", "dramatic", "authoritative"];

export function NewShortForm() {
  const router = useRouter();
  const [length, setLength] = useState<(typeof LENGTHS)[number]>(45);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(undefined);
    const f = new FormData(e.currentTarget);
    const res = await createProjectAction({
      topic: String(f.get("topic") ?? ""),
      angle: String(f.get("angle") ?? "") || undefined,
      targetSeconds: length,
      tone: String(f.get("tone") ?? "curious"),
    });
    if (!res.ok) {
      setLoading(false);
      setError(res.error);
      return;
    }
    router.push(`/projects/${res.data}`);
  }

  return (
    <Card className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold tracking-tight">What’s your Short about?</h1>
      <p className="mt-1 text-sm text-ink-soft">
        A topic is enough. Add an angle if you want a specific take.
      </p>
      <form className="mt-6 space-y-5" onSubmit={onSubmit}>
        <div>
          <Label htmlFor="topic">Topic</Label>
          <Textarea
            id="topic"
            name="topic"
            placeholder="Why octopuses have three hearts"
            required
            minLength={3}
            maxLength={300}
          />
        </div>
        <div>
          <Label htmlFor="angle">Angle (optional)</Label>
          <Input
            id="angle"
            name="angle"
            placeholder="e.g. what happens to the hearts when they swim"
            maxLength={300}
          />
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <Label>Length</Label>
            <div className="flex gap-2" role="radiogroup" aria-label="Length">
              {LENGTHS.map((s) => (
                <button
                  type="button"
                  key={s}
                  role="radio"
                  aria-checked={length === s}
                  onClick={() => setLength(s)}
                  className={`flex-1 rounded-lg border px-3 py-2.5 text-sm font-semibold transition ${length === s ? "border-brand bg-brand-soft text-brand-deep" : "border-line bg-white text-ink-soft hover:border-brand/40"}`}
                >
                  {s}s
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label htmlFor="tone">Tone</Label>
            <Select id="tone" name="tone" defaultValue="curious">
              {TONES.map((t) => (
                <option key={t} value={t}>
                  {t[0]?.toUpperCase()}
                  {t.slice(1)}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end">
          <Button type="submit" loading={loading}>
            Continue to script <ArrowRight className="size-4" aria-hidden />
          </Button>
        </div>
      </form>
    </Card>
  );
}
