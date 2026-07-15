import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyCollectorResult } from "@/collectors/types";
import type { RawLead } from "@/core/discovery/types";
import {
  aggregateCollectorResults,
  normalizeCollectorResult,
} from "@/discovery/collectorAggregation";

function lead(id: string): RawLead {
  return {
    id,
    source: "luma",
    title: id,
    url: `https://luma.com/${id}`,
    links: [`https://luma.com/${id}`],
    postedAt: "2026-07-13T00:00:00.000Z",
    metadata: { provenance: "luma_public" },
  };
}

describe("collector aggregation", () => {
  it("aggregates from result.leads and preserves per-source diagnostics", () => {
    const luma = emptyCollectorResult("luma");
    luma.leads = [lead("one"), lead("two")];
    luma.diagnostics = {
      discovered: 3,
      returned: 2,
      enriched: 1,
      partial: 1,
      dropped: 1,
      stopReason: "no_additional_cards",
    };

    const hakku = emptyCollectorResult("hakku");
    hakku.leads = [];
    hakku.status = "auth_required";
    hakku.errors.push("auth_required: reconnect");
    hakku.diagnostics = {
      discovered: 0,
      returned: 0,
      enriched: 0,
      partial: 0,
      dropped: 0,
      stopReason: "auth_required",
    };

    const aggregation = aggregateCollectorResults([luma, hakku]);
    assert.equal(aggregation.leads.length, 2);
    assert.equal(aggregation.discoveredTotal, 3);
    assert.equal(aggregation.returnedTotal, 2);
    assert.deepEqual(
      aggregation.sourceReturns.map((item) => [item.source, item.status, item.returned]),
      [
        ["luma", "completed", 2],
        ["hakku", "auth_required", 0],
      ],
    );
  });

  it("rejects malformed collector results visibly", () => {
    assert.throws(
      () => normalizeCollectorResult({ source: "luma", errors: [], warnings: [] }),
      /without leads\[\]/,
    );
  });

  it("accepts custom source ids in collector accounting", () => {
    const custom = emptyCollectorResult("custom:hackathonmap");
    custom.leads = [{ ...lead("map"), source: "web" }];
    custom.diagnostics.discovered = 1;

    const aggregation = aggregateCollectorResults([custom]);
    assert.equal(aggregation.sourceReturns[0]?.source, "custom:hackathonmap");
    assert.equal(aggregation.returnedTotal, 1);
  });

  it("warns when discovered cards return zero leads", () => {
    const devpost = emptyCollectorResult("devpost");
    devpost.status = "degraded";
    devpost.diagnostics = {
      discovered: 18,
      returned: 0,
      enriched: 0,
      partial: 0,
      dropped: 18,
      stopReason: "parser_failure",
    };

    const aggregation = aggregateCollectorResults([devpost]);
    assert.equal(aggregation.leads.length, 0);
    assert.match(aggregation.warnings[0] ?? "", /reported 18 discovered leads/);
  });

  it("fails the invariant when returned leads disappear from leads[]", () => {
    const devpost = emptyCollectorResult("devpost");
    devpost.diagnostics = {
      discovered: 18,
      returned: 18,
      enriched: 0,
      partial: 0,
      dropped: 0,
      stopReason: "completed",
    };

    assert.throws(
      () => aggregateCollectorResults([devpost]),
      /returned=18, but leads\[\] is empty/,
    );
  });
});
