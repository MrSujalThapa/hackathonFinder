import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyDiscoveryDbError,
  createSupabaseDiscoveryJobStore,
} from "@/jobs/supabaseStore";

type RpcArgs = {
  p_job_id: string;
  p_event_type: string;
  p_level: "info" | "success" | "warning" | "error";
  p_message: string;
  p_id: string;
  p_source: string | null;
  p_metadata: Record<string, unknown>;
  p_created_at: string;
};

function createAtomicRpcClient() {
  const sequences = new Map<string, number>();
  const locks = new Map<string, Promise<void>>();

  return {
    calls: [] as RpcArgs[],
    from() {
      throw new Error("appendEvent should use RPC, not table inserts");
    },
    async rpc(fn: string, raw: Record<string, unknown>) {
      assert.equal(fn, "append_discovery_job_event");
      const args = raw as RpcArgs;
      this.calls.push(args);

      const prior = locks.get(args.p_job_id) ?? Promise.resolve();
      let release!: () => void;
      const current = new Promise<void>((resolve) => {
        release = resolve;
      });
      locks.set(args.p_job_id, prior.then(() => current));
      await prior;

      try {
        const sequence = (sequences.get(args.p_job_id) ?? 0) + 1;
        sequences.set(args.p_job_id, sequence);
        return {
          data: {
            id: args.p_id,
            job_id: args.p_job_id,
            sequence,
            event_type: args.p_event_type,
            level: args.p_level,
            source: args.p_source,
            message: args.p_message,
            metadata: args.p_metadata,
            created_at: args.p_created_at,
          },
          error: null,
        };
      } finally {
        release();
      }
    },
  };
}

describe("Supabase discovery job event append", () => {
  it("uses atomic RPC appends so 25 concurrent events on one job get sequences 1..25", async () => {
    const client = createAtomicRpcClient();
    const store = createSupabaseDiscoveryJobStore(client);

    const events = await Promise.all(
      Array.from({ length: 25 }, (_, index) =>
        store.appendEvent("job-a", {
          type: "source_progress",
          level: "info",
          message: `event ${index}`,
        }),
      ),
    );

    assert.deepEqual(
      events.map((event) => event.sequence).sort((a, b) => a - b),
      Array.from({ length: 25 }, (_, index) => index + 1),
    );
    assert.equal(client.calls.length, 25);
  });

  it("keeps concurrent appends across different jobs independent", async () => {
    const client = createAtomicRpcClient();
    const store = createSupabaseDiscoveryJobStore(client);

    const events = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        store.appendEvent(index % 2 === 0 ? "job-a" : "job-b", {
          type: "source_progress",
          level: "info",
          message: `event ${index}`,
        }),
      ),
    );

    for (const jobId of ["job-a", "job-b"]) {
      const sequences = events
        .filter((event) => event.runId === jobId)
        .map((event) => event.sequence)
        .sort((a, b) => a - b);
      assert.deepEqual(sequences, Array.from({ length: 10 }, (_, index) => index + 1));
    }
  });

  it("retries bounded unique conflicts without calling the old table insert path", async () => {
    let calls = 0;
    const client = {
      from() {
        throw new Error("appendEvent should use RPC, not table inserts");
      },
      async rpc(_fn: string, args: Record<string, unknown>) {
        calls += 1;
        if (calls === 1) {
          return {
            data: null,
            error: {
              code: "23505",
              message:
                'duplicate key value violates unique constraint "discovery_job_events_job_id_sequence_key"',
            },
          };
        }
        return {
          data: {
            id: args.p_id,
            job_id: args.p_job_id,
            sequence: 1,
            event_type: args.p_event_type,
            level: args.p_level,
            source: args.p_source,
            message: args.p_message,
            metadata: args.p_metadata,
            created_at: args.p_created_at,
          },
          error: null,
        };
      },
    };
    const store = createSupabaseDiscoveryJobStore(client);

    const event = await store.appendEvent("job-a", {
      type: "source_progress",
      level: "info",
      message: "retried",
    });

    assert.equal(event.sequence, 1);
    assert.equal(calls, 2);
  });

  it("classifies missing schema separately from unique conflicts", async () => {
    assert.equal(
      classifyDiscoveryDbError({
        code: "42P01",
        message: 'relation "public.discovery_job_events" does not exist',
      }),
      "schema_unavailable",
    );
    assert.equal(
      classifyDiscoveryDbError({
        code: "23505",
        message:
          'duplicate key value violates unique constraint "discovery_job_events_job_id_sequence_key"',
      }),
      "unique_conflict",
    );
    assert.equal(
      classifyDiscoveryDbError({
        code: "42501",
        message: "new row violates row-level security policy",
      }),
      "authorization",
    );
    assert.equal(
      classifyDiscoveryDbError({
        message: "fetch failed: ECONNRESET",
      }),
      "temporary",
    );
  });

  it("does not report 23505 as a missing migration", async () => {
    const client = {
      from() {
        throw new Error("appendEvent should use RPC, not table inserts");
      },
      async rpc() {
        return {
          data: null,
          error: {
            code: "23505",
            message:
              'duplicate key value violates unique constraint "discovery_job_events_job_id_sequence_key"',
          },
        };
      },
    };
    const store = createSupabaseDiscoveryJobStore(client);

    await assert.rejects(
      () =>
        store.appendEvent("job-a", {
          type: "source_progress",
          level: "info",
          message: "conflict",
        }),
      (error) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /unique conflict/i);
        assert.doesNotMatch(error.message, /migration 006|tables unavailable/i);
        return true;
      },
    );
  });
});
