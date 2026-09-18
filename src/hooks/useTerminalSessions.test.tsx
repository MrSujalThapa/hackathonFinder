import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { cleanupDom, installDom } from "@/test/dom";

const SESSION_A = "11111111-1111-4111-8111-111111111111";
const SESSION_B = "22222222-2222-4222-8222-222222222222";

function persisted(id: string, title: string) {
  return {
    id,
    title,
    status: "open",
    activeJobId: null,
    selectedJobId: null,
    isSelected: id === SESSION_A,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    closedAt: null,
    lastSelectedAt: null,
    sortOrder: 0,
    metadata: null,
  };
}

describe("useTerminalSessions history caching", () => {
  before(() => installDom());
  after(() => cleanupDom());

  it("loads selected history once and never refetches on A -> B -> A", async () => {
    const React = await import("react");
    const { act, render, screen, cleanup, waitFor } = await import("@testing-library/react");
    const historyCalls: Record<string, number> = {};
    const sessionsCalls: string[] = [];

    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: unknown) => {
      const url = String(typeof input === "string" ? input : (input as { url?: string }).url);
      const json = async () => {
        if (url === "/api/terminal/sessions") {
          sessionsCalls.push("list");
          return { data: { sessions: [persisted(SESSION_A, "A"), persisted(SESSION_B, "B")], selectedSession: persisted(SESSION_A, "A") }, error: null };
        }
        const historyMatch = /\/api\/terminal\/sessions\/([^/]+)\/history$/.exec(url);
        if (historyMatch) {
          const id = historyMatch[1]!;
          historyCalls[id] = (historyCalls[id] ?? 0) + 1;
          const session = persisted(id, id === SESSION_A ? "A" : "B");
          return { data: { session, commandHistory: [], jobs: [], events: {} }, error: null };
        }
        if (/\/api\/terminal\/sessions\//.test(url)) {
          const id = url.split("/").at(-1)!;
          return { data: { session: persisted(id, id) }, error: null };
        }
        throw new Error(`unexpected fetch ${url}`);
      };
      return { ok: true, status: 200, json } as unknown as Response;
    }) as typeof fetch;

    try {
      const { useTerminalSessions } = await import("@/hooks/useTerminalSessions");
      let api: ReturnType<typeof useTerminalSessions> | null = null;
      function Harness() {
        const result = useTerminalSessions();
        api = result;
        return React.createElement("div", null, `active:${result.activeId}`);
      }
      render(React.createElement(Harness));
      await waitFor(() => assert.match(screen.getByText(/^active:/).textContent ?? "", new RegExp(SESSION_A)));
      await waitFor(() => assert.equal(historyCalls[SESSION_A], 1));

      await act(async () => { api!.switchSession(SESSION_B); });
      await waitFor(() => assert.match(screen.getByText(/^active:/).textContent ?? "", new RegExp(SESSION_B)));
      await waitFor(() => assert.equal(historyCalls[SESSION_B], 1));

      await act(async () => { api!.switchSession(SESSION_A); });
      await waitFor(() => assert.match(screen.getByText(/^active:/).textContent ?? "", new RegExp(SESSION_A)));
      // Let any stray refetch land before asserting counts.
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });

      assert.equal(sessionsCalls.length, 1, `expected 1 sessions list, got ${sessionsCalls.length}`);
      assert.equal(historyCalls[SESSION_A], 1, `A history refetched: ${JSON.stringify(historyCalls)}`);
      assert.equal(historyCalls[SESSION_B], 1, `B history refetched: ${JSON.stringify(historyCalls)}`);
      cleanup();
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
