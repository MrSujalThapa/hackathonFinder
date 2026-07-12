"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        setError(response.status === 429 ? "Try again later." : "Invalid credentials.");
        return;
      }
      const next = searchParams.get("next") || "/queue";
      router.replace(next.startsWith("/") ? next : "/queue");
      router.refresh();
    } catch {
      setError("Login failed. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4" aria-describedby="login-help">
      <div>
        <label htmlFor="owner-password" className="text-sm font-medium">
          Owner password
        </label>
        <input
          id="owner-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          className="hf-input mt-2 text-base"
          required
        />
      </div>
      <p id="login-help" className="text-xs text-muted">
        Access is limited to the owner. Your session is stored in a secure HTTP-only cookie.
      </p>
      {error ? (
        <p
          role="alert"
          className="rounded-[var(--radius-lg)] border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-100"
        >
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={busy} className="hf-btn hf-btn-primary w-full">
        {busy ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
