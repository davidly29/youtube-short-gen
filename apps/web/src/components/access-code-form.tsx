"use client";
import { Ticket } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { redeemCodeAction } from "../../app/(app)/actions";
import { Button, Card, ErrorText, Input, Label } from "./ui";

export function AccessCodeForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  return (
    <Card data-testid="access-code">
      <h2 className="flex items-center gap-2 font-semibold">
        <Ticket className="size-4 text-brand" aria-hidden /> Have a beta access code?
      </h2>
      <p className="mt-1 text-sm text-ink-soft">
        Beta testers make unlimited Shorts for free. You still use your own AI keys.
      </p>
      <form
        className="mt-3 flex flex-wrap items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setLoading(true);
          setError(undefined);
          const r = await redeemCodeAction(code);
          setLoading(false);
          if (!r.ok) return setError(r.error);
          router.refresh();
        }}
      >
        <div className="min-w-48 flex-1">
          <Label htmlFor="access-code">Access code</Label>
          <Input id="access-code" value={code} autoComplete="off" onChange={(e) => setCode(e.target.value)} />
        </div>
        <Button type="submit" loading={loading} disabled={!code.trim()}>
          Redeem
        </Button>
      </form>
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}
