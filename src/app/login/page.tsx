import { Suspense } from "react";
import { LoginForm } from "@/app/login/LoginForm";

export default function LoginPage() {
  return (
    <main className="flex min-h-[70dvh] items-center justify-center">
      <section className="hf-card w-full max-w-md p-6 sm:p-7">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-sky-200/90">
          Owner access
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Hackathon Radar
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Sign in to review candidates, sync Sheets, and ask follow-up questions.
        </p>
        <Suspense
          fallback={
            <div className="mt-6 h-40 rounded-[var(--radius-lg)] bg-inset" />
          }
        >
          <LoginForm />
        </Suspense>
      </section>
    </main>
  );
}
