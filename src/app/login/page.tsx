import { Suspense } from "react";
import { LoginForm } from "@/app/login/LoginForm";

export default function LoginPage() {
  return (
    <main className="flex min-h-[70dvh] items-center justify-center">
      <section className="w-full max-w-md rounded-2xl border border-border bg-card/85 p-6 shadow-2xl shadow-black/30">
        <p className="font-mono text-xs uppercase text-sky-200">Owner access</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Sign in to Hackathon Radar
        </h1>
        <p className="mt-2 text-sm text-muted">
          Review candidates, sync Sheets, and ask follow-up questions from a private session.
        </p>
        <Suspense fallback={<div className="mt-6 h-40 rounded-xl bg-background/70" />}>
          <LoginForm />
        </Suspense>
      </section>
    </main>
  );
}
