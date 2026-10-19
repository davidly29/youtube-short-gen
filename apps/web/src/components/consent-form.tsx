"use client";
import { ShieldCheck } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { authClient, oauthContinueUrl } from "../lib/auth-client";
import { Button, Card, ErrorText } from "./ui";

const SCOPE_TEXT: Record<string, string> = {
  openid: "Know it's you",
  profile: "See your name",
  email: "See your email address",
  offline_access: "Stay connected when you're not using it",
};

function clientLabel(clientId: string) {
  try {
    return new URL(clientId).host; // Client ID Metadata Document: the client id is its URL
  } catch {
    return clientId;
  }
}

function Consent() {
  const q = useSearchParams();
  const clientId = q.get("client_id") ?? "an app";
  const scopes = (q.get("scope") ?? "").split(" ").filter(Boolean);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<"allow" | "deny">();
  const [name, setName] = useState<string>();
  const verified = /^https:\/\//.test(clientId); // CIMD clients are identified by a URL on their own domain

  useEffect(() => {
    void authClient
      .$fetch<{ client_name?: string }>("/oauth2/public-client", {
        method: "GET",
        query: { client_id: clientId },
      })
      .then((r) => setName(r.data?.client_name));
  }, [clientId]);

  async function answer(accept: boolean) {
    setBusy(accept ? "allow" : "deny");
    setError(undefined);
    const res = await authClient.$fetch("/oauth2/consent", { method: "POST", body: { accept } });
    setBusy(undefined);
    const next = oauthContinueUrl(res.data);
    if (res.error || !next)
      return setError(res.error?.message ?? "Couldn't finish connecting. Please try again.");
    window.location.href = next;
  }

  return (
    <Card data-testid="consent">
      <h1 className="flex items-center gap-2 text-xl font-bold">
        <ShieldCheck className="size-5 text-brand" aria-hidden /> Connect to ShortLoop
      </h1>
      <p className="mt-2 text-sm">
        <strong data-testid="consent-client">{name ?? clientLabel(clientId)}</strong>
        {verified ? (
          ` (${clientLabel(clientId)})`
        ) : (
          <span className="text-ink-soft"> (name given by the app, not verified)</span>
        )}{" "}
        wants to use ShortLoop for you. It will be able to:
      </p>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
        <li>Make Shorts with your credits and your own AI keys</li>
        <li>Publish Shorts you’ve approved to your connected channels</li>
        {scopes.map((s) => SCOPE_TEXT[s] && <li key={s}>{SCOPE_TEXT[s]}</li>)}
      </ul>
      <p className="mt-3 text-xs text-ink-soft">
        It can’t see your API keys or channel passwords. You can disconnect it any time.
      </p>
      <ErrorText>{error}</ErrorText>
      <div className="mt-5 flex gap-2">
        <Button
          variant="secondary"
          className="flex-1"
          loading={busy === "deny"}
          onClick={() => void answer(false)}
        >
          Deny
        </Button>
        <Button
          className="flex-1"
          loading={busy === "allow"}
          onClick={() => void answer(true)}
          data-testid="consent-allow"
        >
          Allow
        </Button>
      </div>
    </Card>
  );
}

export function ConsentForm() {
  return (
    <Suspense>
      <Consent />
    </Suspense>
  );
}
