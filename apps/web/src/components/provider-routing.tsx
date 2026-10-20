"use client";
import type { ProviderRouting } from "@shortloop/contracts";
import { Check } from "lucide-react";
import { useState } from "react";
import { saveRoutingAction } from "../../app/(app)/actions";
import { Button, Card, ErrorText, Label, Select } from "./ui";

export interface RoutingOption {
  value: string;
  label: string;
}

export interface RoutingJob {
  id: "llm" | "image" | "tts";
  label: string;
  /** What "Automatic" currently resolves to, shown in its label. */
  automatic: string;
  options: RoutingOption[];
  hint?: string;
}

/** Settings → API keys: pick which provider does each job (ADR 0007). "Automatic" keeps the default. */
export function ProviderRoutingForm({ jobs, initial }: { jobs: RoutingJob[]; initial: ProviderRouting }) {
  const [value, setValue] = useState<Record<string, string>>({
    llm: initial.llm ?? "",
    image: initial.image ?? "",
    tts: initial.tts ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string>();

  async function save() {
    setBusy(true);
    setError(undefined);
    setSaved(false);
    const r = await saveRoutingAction({
      llm: value.llm || undefined,
      image: value.image || undefined,
      tts: value.tts || undefined,
    });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setSaved(true);
  }

  return (
    <Card data-testid="routing">
      <h2 className="text-sm font-semibold">Which provider does each job</h2>
      <p className="mt-1 text-xs text-ink-soft">
        If a provider fails or runs out of quota, images and voices switch to the free ones so your Short
        still finishes, and the review screen tells you.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {jobs.map((job) => (
          <div key={job.id}>
            <Label htmlFor={`routing-${job.id}`}>{job.label}</Label>
            <Select
              id={`routing-${job.id}`}
              data-testid={`routing-${job.id}`}
              value={value[job.id]}
              onChange={(e) => {
                setValue({ ...value, [job.id]: e.target.value });
                setSaved(false);
              }}
            >
              <option value="">Automatic ({job.automatic})</option>
              {job.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            {job.hint && <p className="mt-1 text-xs text-ink-soft">{job.hint}</p>}
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-end gap-3">
        <ErrorText>{error}</ErrorText>
        {saved && (
          <span className="inline-flex items-center gap-1 text-sm text-good" data-testid="routing-saved">
            <Check className="size-4" aria-hidden /> Saved
          </span>
        )}
        <Button onClick={() => void save()} loading={busy} data-testid="routing-save">
          Save choices
        </Button>
      </div>
    </Card>
  );
}
