"use client";
import type { ApiKeyInfo } from "@shortloop/contracts";
import { CheckCircle2, ExternalLink, KeyRound, ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";
import { deleteKeyAction, saveKeyAction } from "../../app/(app)/actions";
import { cn } from "../lib/cn";
import { PROVIDERS, type ProviderMeta } from "../lib/provider-meta";
import { Badge, Button, Card, ErrorText, Input, Label } from "./ui";

export function ApiKeys({ initial }: { initial: ApiKeyInfo[] }) {
  const [keys, setKeys] = useState(initial);
  const byProvider = new Map(keys.map((k) => [k.provider, k]));
  return (
    <div className="space-y-4">
      {PROVIDERS.map((p) => (
        <ProviderCard
          key={p.id}
          meta={p}
          saved={byProvider.get(p.id)}
          onSaved={(info) => setKeys([...keys.filter((k) => k.provider !== p.id), info])}
          onRemoved={() => setKeys(keys.filter((k) => k.provider !== p.id))}
        />
      ))}
    </div>
  );
}

function ProviderCard({
  meta,
  saved,
  onSaved,
  onRemoved,
}: {
  meta: ProviderMeta;
  saved?: ApiKeyInfo;
  onSaved: (info: ApiKeyInfo) => void;
  onRemoved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [key, setKey] = useState("");
  const [model, setModel] = useState(saved?.model ?? "");
  const [imageModel, setImageModel] = useState(saved?.imageModel ?? "");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [busy, setBusy] = useState<"save" | "remove">();
  const [error, setError] = useState<string>();

  async function save() {
    setBusy("save");
    setError(undefined);
    const r = await saveKeyAction({
      provider: meta.id,
      key,
      model: meta.textModel ? model || undefined : undefined,
      imageModel: meta.imageModel ? imageModel || undefined : undefined,
    });
    setBusy(undefined);
    if (!r.ok) return setError(r.error);
    setKey("");
    setEditing(false);
    onSaved(r.data);
  }

  async function remove() {
    setBusy("remove");
    const r = await deleteKeyAction(meta.id);
    setBusy(undefined);
    if (!r.ok) return setError(r.error);
    onRemoved();
  }

  return (
    <Card data-testid={`key-${meta.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 font-semibold">
            {meta.name}
            {meta.uses.map((u) => (
              <Badge key={u} tone="neutral">
                {u}
              </Badge>
            ))}
          </h3>
          <p className="mt-1 text-sm text-ink-soft">{meta.blurb}</p>
        </div>
        {saved ? (
          <span
            className="inline-flex items-center gap-1.5 text-sm font-medium text-good"
            data-testid={`key-${meta.id}-status`}
          >
            <CheckCircle2 className="size-4" aria-hidden />
            Connected ••••{saved.last4}
            {!saved.verifiedAt && <span className="text-xs font-normal text-ink-soft">(not checked)</span>}
          </span>
        ) : (
          <span className="text-sm text-ink-soft" data-testid={`key-${meta.id}-status`}>
            Not connected
          </span>
        )}
      </div>

      {editing ? (
        <div className="mt-4 space-y-3">
          <div>
            <Label htmlFor={`${meta.id}-key`}>{meta.name} API key</Label>
            <Input
              id={`${meta.id}-key`}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={meta.placeholder}
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <a
              href={meta.getKeyUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-brand"
            >
              Get a key <ExternalLink className="size-3" aria-hidden />
            </a>
          </div>
          {(meta.textModel || meta.imageModel) && (
            <div>
              <button
                type="button"
                className="text-xs font-medium text-ink-soft underline"
                onClick={() => setShowAdvanced(!showAdvanced)}
              >
                {showAdvanced ? "Hide" : "Choose"} model
              </button>
              {showAdvanced && (
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  {meta.textModel && (
                    <div>
                      <Label htmlFor={`${meta.id}-model`}>Script model</Label>
                      <Input
                        id={`${meta.id}-model`}
                        placeholder={meta.textModel}
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                      />
                    </div>
                  )}
                  {meta.imageModel && (
                    <div>
                      <Label htmlFor={`${meta.id}-image-model`}>Image model</Label>
                      <Input
                        id={`${meta.id}-image-model`}
                        placeholder={meta.imageModel}
                        value={imageModel}
                        onChange={(e) => setImageModel(e.target.value)}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          <ErrorText>{error}</ErrorText>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => (setEditing(false), setError(undefined), setKey(""))}>
              Cancel
            </Button>
            <Button
              onClick={() => void save()}
              loading={busy === "save"}
              disabled={key.trim().length < 8}
              data-testid={`key-${meta.id}-save`}
            >
              <ShieldCheck className="size-4" aria-hidden /> Check and save
            </Button>
          </div>
        </div>
      ) : (
        <div className={cn("mt-4 flex flex-wrap items-center gap-2")}>
          <Button variant="secondary" onClick={() => setEditing(true)} data-testid={`key-${meta.id}-add`}>
            <KeyRound className="size-4" aria-hidden /> {saved ? "Replace key" : "Add key"}
          </Button>
          {saved && (
            <Button
              variant="ghost"
              onClick={() => void remove()}
              loading={busy === "remove"}
              data-testid={`key-${meta.id}-remove`}
            >
              <Trash2 className="size-4" aria-hidden /> Remove
            </Button>
          )}
          {saved?.model && <span className="text-xs text-ink-soft">Model: {saved.model}</span>}
          <ErrorText>{error}</ErrorText>
        </div>
      )}
    </Card>
  );
}
