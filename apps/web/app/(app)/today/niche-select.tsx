"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, ErrorText, Label, Select } from "../../../src/components/ui";
import { setNicheAction } from "./actions";

/** Pick the niche a channel's daily brief covers. */
export function NicheSelect({
  channelId,
  current,
  options,
}: {
  channelId: string;
  current?: string;
  options: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [value, setValue] = useState(current ?? "");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const id = `niche-${channelId}`;

  async function save() {
    setSaving(true);
    setError(undefined);
    const res = await setNicheAction(channelId, value);
    setSaving(false);
    if (!res.ok) setError(res.error);
    else router.refresh();
  }

  return (
    <div className="flex flex-wrap items-end gap-3" data-testid={`niche-select-${channelId}`}>
      <div className="min-w-48 flex-1">
        <Label htmlFor={id}>Niche</Label>
        <Select id={id} value={value} onChange={(e) => setValue(e.target.value)}>
          <option value="" disabled>
            Choose a niche…
          </option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
      </div>
      <Button
        type="button"
        variant="secondary"
        disabled={!value || value === current}
        loading={saving}
        onClick={() => void save()}
        data-testid="save-niche"
      >
        Save niche
      </Button>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
