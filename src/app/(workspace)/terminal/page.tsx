import { Suspense } from "react";
import { DiscoveryTerminal } from "@/components/terminal/DiscoveryTerminal";

export default function TerminalPage() {
  return (
    <Suspense
      fallback={
        <div className="font-mono text-sm text-muted">Loading terminal…</div>
      }
    >
      <DiscoveryTerminal />
    </Suspense>
  );
}
