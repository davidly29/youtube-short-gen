"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient, oauthContinueUrl } from "../lib/auth-client";
import { Button, Card, ErrorText, Input, Label } from "./ui";

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(undefined);
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    const res =
      mode === "sign-up"
        ? await authClient.signUp.email({
            email,
            password,
            name: String(form.get("name") || email.split("@")[0]),
          })
        : await authClient.signIn.email({ email, password });
    setLoading(false);
    if (res.error) {
      setError(res.error.message ?? "Something went wrong");
      return;
    }
    // Signing in for an app (e.g. Claude via MCP)? Continue that authorization instead of opening the studio.
    const next = new URLSearchParams(window.location.search).has("client_id")
      ? oauthContinueUrl(res.data)
      : undefined;
    if (next) {
      window.location.href = next;
      return;
    }
    router.push("/projects");
    router.refresh();
  }

  return (
    <Card>
      <h1 className="text-xl font-bold">{mode === "sign-up" ? "Create your account" : "Welcome back"}</h1>
      <p className="mt-1 text-sm text-ink-soft">
        {mode === "sign-up" ? "5 free Shorts to start. No card needed." : "Sign in to your studio."}
      </p>
      <form className="mt-6 space-y-4" onSubmit={onSubmit}>
        {mode === "sign-up" && (
          <div>
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" autoComplete="name" placeholder="Your name" />
          </div>
        )}
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            minLength={8}
            autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
            required
          />
        </div>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" className="w-full" loading={loading}>
          {mode === "sign-up" ? "Create account" : "Sign in"}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-ink-soft">
        {mode === "sign-up" ? (
          <>
            Already have an account?{" "}
            <Link className="font-semibold text-brand" href="/sign-in">
              Sign in
            </Link>
          </>
        ) : (
          <>
            New here?{" "}
            <Link className="font-semibold text-brand" href="/sign-up">
              Create an account
            </Link>
          </>
        )}
      </p>
    </Card>
  );
}
