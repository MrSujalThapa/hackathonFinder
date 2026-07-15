import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  selectDiscoverySources,
  DISCOVERY_DEFAULT_SOURCES,
} from "@/discovery/selectSources";
import { reconcileSourcePlan } from "@/discovery/sourcePlan";
import {
  createEventEmitter,
  formatDiscoveryEventForCli,
  sanitizeEventMetadata,
} from "@/discovery/events";
import { runDiscovery } from "@/discovery/runDiscovery";
import { setHakkuStatusProviderForTests } from "@/discovery/hakkuStatus";

describe("selectDiscoverySources", () => {
  it("can produce all six effective sources when Hakku is connected and enabled", () => {
    const result = selectDiscoverySources({
      enabledSources: ["mlh", "web", "hacklist", "devpost", "luma", "hakku"],
      hakkuConnected: true,
    });
    assert.deepEqual(result.effectiveSources, [
      "mlh",
      "web",
      "hacklist",
      "devpost",
      "luma",
      "hakku",
    ]);
    assert.ok(!result.effectiveSources.includes("x"));
  });

  it("uses enabled defaults without X", () => {
    const result = selectDiscoverySources({
      hakkuConnected: false,
      enabledSources: [...DISCOVERY_DEFAULT_SOURCES],
    });
    assert.deepEqual(result.effectiveSources, DISCOVERY_DEFAULT_SOURCES);
    assert.ok(!result.effectiveSources.includes("x"));
    assert.ok(result.effectiveSources.includes("hacklist"));
    assert.ok(result.effectiveSources.includes("devpost"));
    assert.ok(result.effectiveSources.includes("luma"));
  });

  it("skips disconnected Hakku with a visible reason", () => {
    const result = selectDiscoverySources({
      enabledSources: [...DISCOVERY_DEFAULT_SOURCES, "hakku"],
      hakkuConnected: false,
    });
    assert.ok(!result.effectiveSources.includes("hakku"));
    assert.ok(result.skipped.some((item) => item.source === "hakku"));
    assert.ok(result.warnings.some((warning) => /hakku/i.test(warning)));
    // Must not collapse to MLH+web only while others remain enabled.
    assert.ok(result.effectiveSources.includes("hacklist"));
    assert.ok(result.effectiveSources.includes("devpost"));
    assert.ok(result.effectiveSources.includes("luma"));
  });

  it("includes Hakku when connected", () => {
    const result = selectDiscoverySources({
      enabledSources: [...DISCOVERY_DEFAULT_SOURCES, "hakku"],
      hakkuConnected: true,
    });
    assert.ok(result.effectiveSources.includes("hakku"));
  });

  it("runs explicit Luma only when requested", () => {
    const result = selectDiscoverySources({
      requestedSources: ["luma"],
      enabledSources: ["mlh", "web", "hacklist", "devpost", "luma", "hakku"],
      hakkuConnected: true,
    });
    assert.deepEqual(result.effectiveSources, ["luma"]);
  });

  it("runs explicit Hakku only when requested and connected", () => {
    const result = selectDiscoverySources({
      requestedSources: ["hakku"],
      enabledSources: ["mlh", "web", "hacklist", "devpost", "luma", "hakku"],
      hakkuConnected: true,
    });
    assert.deepEqual(result.effectiveSources, ["hakku"]);
  });

  it("keeps Luma public in defaults when enabled", () => {
    const result = selectDiscoverySources({
      enabledSources: ["mlh", "luma", "web"],
      hakkuConnected: false,
    });
    assert.deepEqual(result.effectiveSources, ["mlh", "luma", "web"]);
  });

  it("runs degraded Devpost with a warning", () => {
    const result = selectDiscoverySources({
      enabledSources: ["mlh", "devpost", "web"],
      hakkuConnected: false,
      availability: {
        devpost: {
          source: "devpost",
          enabled: true,
          health: "degraded",
          reason: "parser warnings",
        },
      },
    });
    assert.ok(result.effectiveSources.includes("devpost"));
    assert.ok(result.warnings.some((warning) => /degraded/i.test(warning)));
  });

  it("honors explicit source subset", () => {
    const result = selectDiscoverySources({
      requestedSources: ["mlh", "web"],
      hakkuConnected: false,
    });
    assert.deepEqual(result.effectiveSources, ["mlh", "web"]);
  });

  it("runs no built-ins for an explicit custom-only selection", () => {
    const result = selectDiscoverySources({
      requestedSources: [],
      enabledSources: ["mlh", "web", "hacklist", "devpost", "luma"],
      hakkuConnected: false,
    });
    assert.deepEqual(result.effectiveSources, []);
    assert.equal(result.effectiveSources.some((source) => source === "web"), false);
  });

  it("skips disabled sources", () => {
    const result = selectDiscoverySources({
      requestedSources: ["mlh", "hacklist"],
      availability: {
        hacklist: {
          source: "hacklist",
          enabled: false,
          health: "disabled",
          reason: "Disabled in Settings",
        },
      },
    });
    assert.deepEqual(result.effectiveSources, ["mlh"]);
    assert.ok(result.skipped.some((item) => item.source === "hacklist"));
  });

  it("reports unknown/unconfigured sources without substitution", () => {
    const result = selectDiscoverySources({
      requestedSources: ["mlh", "devpost"],
      availability: {
        devpost: {
          source: "devpost",
          enabled: true,
          health: "unconfigured",
          reason: "Devpost collector unconfigured",
        },
      },
    });
    assert.deepEqual(result.effectiveSources, ["mlh"]);
    assert.equal(result.skipped[0]?.source, "devpost");
  });

  it("skips X by default even when requested in allSources path", () => {
    const result = selectDiscoverySources({
      allSources: true,
      enabledSources: [...DISCOVERY_DEFAULT_SOURCES, "x"],
      hakkuConnected: false,
    });
    assert.ok(!result.effectiveSources.includes("x"));
  });
});

describe("reconcileSourcePlan", () => {
  it("restores healthy Luma and Hakku omitted by planner output", () => {
    const result = reconcileSourcePlan({
      effectiveSources: ["mlh", "web", "hacklist", "devpost", "luma", "hakku"],
      plannerSources: ["mlh", "web", "hacklist", "devpost"],
      availabilityBySource: {
        luma: { source: "luma", enabled: true, health: "healthy" },
        hakku: { source: "hakku", enabled: true, health: "healthy" },
      },
    });

    assert.deepEqual(result.sources, ["mlh", "web", "hacklist", "devpost", "luma", "hakku"]);
    assert.equal(new Set(result.items.map((item) => item.source)).size, 6);
    assert.ok(result.items.every((item) => item.state === "execute"));
    assert.ok(result.warnings.some((warning) => /omitted effective source luma/i.test(warning)));
    assert.ok(result.warnings.some((warning) => /omitted effective source hakku/i.test(warning)));
  });

  it("does not let the planner silently drop a healthy source with enabled false", () => {
    const result = reconcileSourcePlan({
      effectiveSources: ["luma"],
      plannerSources: ["luma"],
      plannerIntents: [
        { source: "luma", enabled: false, reason: "Planner did not prioritize it." },
      ],
      availabilityBySource: {
        luma: { source: "luma", enabled: true, health: "healthy" },
      },
    });

    assert.deepEqual(result.sources, ["luma"]);
    assert.equal(result.items[0]?.state, "execute");
    assert.ok(result.warnings.some((warning) => /tried to skip healthy/i.test(warning)));
  });
});

describe("discovery events", () => {
  it("sanitizes secret metadata keys", () => {
    const clean = sanitizeEventMetadata({
      leadsFound: 3,
      apiKey: "secret",
      cookie: "abc",
      profilePath: "/home/user/.data",
      ok: true,
    });
    assert.deepEqual(clean, { leadsFound: 3, ok: true });
  });

  it("formats CLI-compatible event lines", () => {
    const line = formatDiscoveryEventForCli({
      id: "1",
      runId: "run",
      sequence: 1,
      timestamp: new Date().toISOString(),
      type: "source_completed",
      level: "success",
      source: "mlh",
      message: "25 leads found",
    });
    assert.equal(line, "[mlh] 25 leads found");
  });

  it("emits ordered sequences", async () => {
    const sequences: number[] = [];
    const emitter = createEventEmitter("run-1", {
      emit(event) {
        sequences.push(event.sequence ?? -1);
      },
    });
    await emitter.emit("run_started", "start");
    await emitter.emit("planning_started", "plan");
    await emitter.emit("run_completed", "done");
    assert.deepEqual(sequences, [1, 2, 3]);
  });
});

describe("runDiscovery shared service", () => {
  it("runs dry-run mock discovery and emits completion", async () => {
    setHakkuStatusProviderForTests({
      getStatus: () => ({ connected: false, safeMessage: "disconnected" }),
    });
    const events: string[] = [];
    const result = await runDiscovery({
      command: "find upcoming hackathons",
      sources: ["mock"],
      dryRun: true,
      mode: "deterministic",
      eventSink: {
        emit(event) {
          events.push(event.type);
        },
      },
    });
    assert.equal(result.cancelled, false);
    assert.ok(result.summary.accepted >= 1);
    assert.ok(result.summary.sourceAccounting.executedSources.includes("mock"));
    assert.ok(events.includes("run_started"));
    assert.ok(events.includes("run_completed"));
    setHakkuStatusProviderForTests(null);
  });

  it("isolates source failure into warnings without total collapse", async () => {
    setHakkuStatusProviderForTests({
      getStatus: () => ({ connected: false, safeMessage: "disconnected" }),
    });
    const result = await runDiscovery({
      command: "find hackathons from mock",
      sources: ["mock"],
      dryRun: true,
      mode: "deterministic",
      availability: {
        hakku: {
          source: "hakku",
          enabled: true,
          health: "disconnected",
          reason: "disconnected",
        },
      },
    });
    assert.ok(result.summary.accepted >= 1);
    setHakkuStatusProviderForTests(null);
  });
});
